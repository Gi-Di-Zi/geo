"""Regression tests execute real Git provenance and read-only reconciliation."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

MODULE = Path(__file__).with_name("migration_guard.py")
spec = importlib.util.spec_from_file_location("migration_guard", MODULE)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class MigrationProtection(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "original.md"
        self.source.write_text("# Original\nOriginal approved-source bytes.\nSecond protected UI line.\nNon-UI footer.\n")
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "original.md"], cwd=self.root, check=True)
        subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "original"], cwd=self.root, check=True)
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip()
        (self.root / "ui-specs").mkdir()
        (self.root / ".storybook/docs").mkdir(parents=True)
        self.snapshot = self.root / ".storybook/docs/source.mdx"
        self.snapshot.write_text("# Initial UI snapshot\n")
        manifest = self.root / "ui-specs/manifest.json"
        manifest.write_text('{"screen":"initial"}\n')
        self.state = {"schemaVersion": 2, "projectId": "example", "phase": "snapshot-protected", "approval": "unknown", "dkbReference": "pending-permission", "sourceRevision": revision, "planningSourceRevision": revision,
                      "sources": [{"path": "original.md", "sha256": guard.digest(self.source.read_bytes()), "uiRanges": [{"startLine": 2, "endLine": 3, "sha256": guard.digest("\n".join(self.source.read_text().splitlines()[1:3]).encode())}]}],
                      "snapshots": [{"path": str(p.relative_to(self.root)), "initialSha256": guard.digest(p.read_bytes())} for p in [manifest, self.snapshot]]}
        self.state_file = self.root / guard.STATE
        self.save()

    def save(self):
        self.state_file.write_text(json.dumps(self.state))

    def inventory(self):
        return {str(p.relative_to(self.root)): (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file() and '.git' not in p.parts}

    def test_reconcile_twice_changes_no_bytes_or_mtime(self):
        before = self.inventory()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(guard.reconcile(self.root))
            self.assertTrue(guard.reconcile(self.root))
        self.assertEqual(self.inventory(), before)

    def test_user_ui_change_is_preserved_and_never_recaptured(self):
        self.snapshot.write_text('# Reviewed next UI\nKeep this user change.\n')
        before = self.inventory()
        result = guard.inspect(self.root)
        self.assertEqual(result['editedSnapshots'], ['.storybook/docs/source.mdx'])
        self.assertEqual(result['approval'], 'unknown')
        self.assertEqual(result['dkbReference'], 'pending-permission')
        with contextlib.redirect_stdout(io.StringIO()):
            guard.reconcile(self.root)
        self.assertEqual(self.inventory(), before)

    def test_source_change_conflicts_before_any_write(self):
        self.source.write_text('# Changed original\n')
        before = self.inventory()
        with self.assertRaisesRegex(guard.MigrationConflict, 'original_ui_section_changed'):
            guard.reconcile(self.root)
        self.assertEqual(self.inventory(), before)

    def test_updating_hash_cannot_silently_recapture_changed_source(self):
        self.source.write_text('# Changed original\n')
        self.state['sources'][0]['sha256'] = guard.digest(self.source.read_bytes())
        self.save()
        with self.assertRaisesRegex(guard.MigrationConflict, 'original_git_digest_mismatch'):
            guard.inspect(self.root)

    def test_missing_state_is_not_recreated(self):
        self.state_file.unlink()
        with self.assertRaisesRegex(guard.MigrationConflict, 'migration_state_missing'):
            guard.inspect(self.root)
        self.assertFalse(self.state_file.exists())

    def test_missing_derived_target_blocks(self):
        self.snapshot.unlink()
        with self.assertRaisesRegex(guard.MigrationConflict, 'missing_or_symlinked_file'):
            guard.inspect(self.root)

    def test_original_symlink_is_rejected(self):
        outside = self.root / 'elsewhere.md'
        outside.write_bytes(self.source.read_bytes())
        self.source.unlink()
        self.source.symlink_to(outside)
        with self.assertRaisesRegex(guard.MigrationConflict, 'missing_or_symlinked_file'):
            guard.inspect(self.root)

    def test_unknown_phase_and_forged_completion_are_rejected(self):
        for key, value in [('phase', 'canonical-active'), ('approval', 'approved'), ('dkbReference', 'active'), ('schemaVersion', True)]:
            with self.subTest(key=key):
                original = self.state[key]
                self.state[key] = value
                self.save()
                with self.assertRaises(guard.MigrationConflict):
                    guard.inspect(self.root)
                self.state[key] = original

    def test_duplicate_and_traversal_paths_are_rejected(self):
        self.state['sources'].append(dict(self.state['sources'][0]))
        self.save()
        with self.assertRaisesRegex(guard.MigrationConflict, 'duplicate_source'):
            guard.inspect(self.root)
        self.state['sources'].pop()
        self.state['sources'][0]['path'] = '../outside.md'
        self.save()
        with self.assertRaisesRegex(guard.MigrationConflict, 'invalid_relative_path'):
            guard.inspect(self.root)

    def test_non_ui_readme_edit_and_added_lines_before_ui_are_allowed(self):
        self.source.write_text("# Updated operations heading\nAdded non-UI preface.\nOriginal approved-source bytes.\nSecond protected UI line.\nUpdated operations footer.\n")
        before = self.inventory()
        result = guard.inspect(self.root)
        self.assertEqual(result["nonUiSourceChanges"], ["original.md"])
        with contextlib.redirect_stdout(io.StringIO()):
            guard.reconcile(self.root)
        self.assertEqual(self.inventory(), before)

    def test_overlapping_source_sections_keep_all_existing_ui_ranges(self):
        self.state["sources"][0]["uiRanges"].append({"startLine": 2, "endLine": 2, "sha256": guard.digest(self.source.read_text().splitlines()[1].encode())})
        self.save()
        self.assertEqual(guard.inspect(self.root)["nonUiSourceChanges"], [])
        self.source.write_text(self.source.read_text().replace("Second protected UI line.", "Changed UI."))
        with self.assertRaisesRegex(guard.MigrationConflict, "original_ui_section_changed"):
            guard.inspect(self.root)

    def test_insert_within_protected_ui_is_a_conflict(self):
        self.source.write_text(self.source.read_text().replace("Second protected UI line.", "Inserted changed UI requirement.\nSecond protected UI line."))
        with self.assertRaisesRegex(guard.MigrationConflict, "original_ui_section_changed"):
            guard.inspect(self.root)

    def test_unrelated_new_markdown_is_not_treated_as_adopted_ui(self):
        (self.root / "operations.md").write_text("# New operating procedure\n")
        before = self.inventory()
        self.assertEqual(guard.inspect(self.root)["sourceCount"], 1)
        with contextlib.redirect_stdout(io.StringIO()):
            guard.reconcile(self.root)
        self.assertEqual(self.inventory(), before)

    def test_preserved_source_pin_does_not_depend_on_unavailable_planning_object(self):
        self.state["planningSourceRevision"] = "f" * 40
        self.save()
        missing = subprocess.run(["git", "--no-replace-objects", "cat-file", "-e", self.state["planningSourceRevision"]], cwd=self.root, capture_output=True)
        self.assertNotEqual(missing.returncode, 0)
        result = guard.inspect(self.root)
        self.assertEqual(result["planningSourceRevision"], "f" * 40)
        self.assertEqual(result["preservedSourceRevision"], self.state["sourceRevision"])
        self.assertEqual(result["nonUiSourceChanges"], [])

    def test_missing_original_commit_and_invalid_json_fail_closed(self):
        original = self.state['sourceRevision']
        self.state['sourceRevision'] = '0' * 40
        self.save()
        with self.assertRaisesRegex(guard.MigrationConflict, 'original_git_source_unavailable'):
            guard.inspect(self.root)
        self.state['sourceRevision'] = original
        self.save()
        (self.root / 'ui-specs/manifest.json').write_text('{broken')
        with self.assertRaisesRegex(guard.MigrationConflict, 'invalid_snapshot_json'):
            guard.inspect(self.root)


if __name__ == '__main__':
    unittest.main()
