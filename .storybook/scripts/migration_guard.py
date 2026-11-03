"""Read-only protection for reviewed initial Markdown-to-Storybook snapshots."""
import hashlib
import difflib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

STATE = ".storybook/migration-state.json"
ROOT = Path(__file__).resolve().parents[2]
DIGEST = re.compile(r"^[a-f0-9]{64}$")
REVISION = re.compile(r"^[a-f0-9]{40}$")


class MigrationConflict(Exception):
    """A source conflict requires explicit review, never automatic recapture."""


def need(condition, code):
    if not condition:
        raise MigrationConflict(code)


def checked_file(root, relative, derived=False):
    need(isinstance(relative, str) and relative and not any(ord(c) < 32 for c in relative), "invalid_relative_path")
    path = PurePosixPath(relative)
    need(not path.is_absolute() and ".." not in path.parts and str(path) == relative, "invalid_relative_path")
    if derived:
        need(relative.startswith(("ui-specs/", ".storybook/docs/", ".storybook/source-data/")), "invalid_snapshot_path")
        need(path.suffix in (".json", ".mdx"), "invalid_snapshot_path")
    else:
        need(path.suffix.lower() == ".md", "invalid_original_markdown_path")
    candidate = root / relative
    need(candidate.is_file() and candidate.resolve() == candidate, "missing_or_symlinked_file")
    return candidate


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def inspect(root):
    root = root.resolve()
    state_file = root / STATE
    need(state_file.is_file() and state_file.resolve() == state_file, "migration_state_missing_or_symlinked")
    try:
        state = json.loads(state_file.read_text())
    except (ValueError, UnicodeError):
        raise MigrationConflict("invalid_migration_state") from None
    need(isinstance(state, dict) and set(state) == {"schemaVersion", "projectId", "phase", "approval", "dkbReference", "sourceRevision", "planningSourceRevision", "sources", "snapshots"}, "invalid_migration_state")
    need(type(state["schemaVersion"]) is int and state["schemaVersion"] == 2, "unsupported_migration_schema")
    need(state["phase"] == "snapshot-protected" and state["approval"] == "unknown" and state["dkbReference"] == "pending-permission", "unsupported_migration_phase")
    need(isinstance(state["projectId"], str) and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", state["projectId"]), "invalid_project_id")
    need(isinstance(state["planningSourceRevision"], str) and REVISION.fullmatch(state["planningSourceRevision"]), "invalid_planning_revision")
    revision = state["sourceRevision"]
    need(isinstance(revision, str) and REVISION.fullmatch(revision), "invalid_source_revision")
    need(isinstance(state["sources"], list) and state["sources"] and len(state["sources"]) <= 4096, "invalid_source_inventory")
    need(isinstance(state["snapshots"], list) and state["snapshots"] and len(state["snapshots"]) <= 4096, "invalid_snapshot_inventory")
    seen = set()
    non_ui_changes = []
    for source in state["sources"]:
        need(isinstance(source, dict) and set(source) == {"path", "sha256", "uiRanges"}, "invalid_source_reference")
        relative, expected = source["path"], source["sha256"]
        file = checked_file(root, relative)
        need(relative not in seen, "duplicate_source_reference")
        seen.add(relative)
        need(isinstance(expected, str) and DIGEST.fullmatch(expected), "invalid_source_digest")
        original = subprocess.run(["git", "--no-replace-objects", "show", f"{revision}:{relative}"], cwd=root, capture_output=True)
        need(original.returncode == 0, "original_git_source_unavailable")
        need(digest(original.stdout) == expected, "original_git_digest_mismatch")
        original_lines = original.stdout.decode("utf-8-sig").splitlines()
        current = file.read_bytes()
        current_lines = current.decode("utf-8-sig").splitlines()
        ranges = source["uiRanges"]
        need(isinstance(ranges, list) and ranges and len(ranges) <= 20_000, "invalid_ui_ranges")
        boundaries = []
        for section in ranges:
            need(isinstance(section, dict) and set(section) == {"startLine", "endLine", "sha256"}, "invalid_ui_range")
            start, end, checksum = section["startLine"], section["endLine"], section["sha256"]
            need(type(start) is int and type(end) is int and 1 <= start <= end <= len(original_lines), "invalid_ui_range")
            need(isinstance(checksum, str) and DIGEST.fullmatch(checksum), "invalid_ui_range_digest")
            need(digest("\n".join(original_lines[start - 1:end]).encode()) == checksum, "original_ui_range_digest_mismatch")
            boundaries.append((start - 1, end))
        for operation, begin, end, _, _ in difflib.SequenceMatcher(None, original_lines, current_lines, autojunk=False).get_opcodes():
            if operation == "equal":
                continue
            touches_ui = any((low < begin < high) if begin == end else (begin < high and end > low) for low, high in boundaries)
            need(not touches_ui, "original_ui_section_changed_review_required")
        if digest(current) != expected:
            non_ui_changes.append(relative)
    changed = []
    seen = set()
    for snapshot in state["snapshots"]:
        need(isinstance(snapshot, dict) and set(snapshot) == {"path", "initialSha256"}, "invalid_snapshot_reference")
        relative, initial = snapshot["path"], snapshot["initialSha256"]
        file = checked_file(root, relative, derived=True)
        need(relative not in seen, "duplicate_snapshot_reference")
        seen.add(relative)
        need(isinstance(initial, str) and DIGEST.fullmatch(initial), "invalid_snapshot_digest")
        raw = file.read_bytes()
        if file.suffix == ".json":
            try:
                json.loads(raw)
            except (ValueError, UnicodeError):
                raise MigrationConflict("invalid_snapshot_json") from None
        if digest(raw) != initial:
            changed.append(relative)
    need("ui-specs/manifest.json" in seen, "snapshot_manifest_required")
    return {"projectId": state["projectId"], "phase": state["phase"], "reconcile": "no-write", "sourceCount": len(state["sources"]),
            "planningSourceRevision": state["planningSourceRevision"], "preservedSourceRevision": revision, "snapshotCount": len(state["snapshots"]), "editedSnapshots": changed, "nonUiSourceChanges": non_ui_changes, "approval": "unknown", "dkbReference": "pending-permission"}


def reconcile(root):
    """Existing initial generation commands become read-only after migration."""
    print(json.dumps(inspect(root), ensure_ascii=False))
    return True


def main():
    need(sys.argv[1:] in (["check"], ["reconcile"]), "unsupported_migration_operation")
    reconcile(ROOT)


if __name__ == "__main__":
    try:
        main()
    except (MigrationConflict, OSError) as error:
        print(json.dumps({"status": "conflict", "code": str(error), "writes": 0}), file=sys.stderr)
        sys.exit(1)
