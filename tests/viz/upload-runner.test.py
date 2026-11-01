import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
import zipfile

RUNNER = Path(__file__).resolve().parents[2] / 'scripts/upload-runner.py'
FAKE_NODE = '''#!/usr/bin/python3
import json,os,time
from pathlib import Path
import sys
job=Path(sys.argv[sys.argv.index('--job')+1])
(job/'child.pid').write_text(str(os.getpid()))
if os.environ.get('FAKE_GROW'):
 (job/'upload').mkdir(exist_ok=True)
 with (job/'upload'/'large.bin').open('wb') as f:f.truncate(5*1024**3)
time.sleep(float(os.environ.get('FAKE_WAIT','0.05')))
p=job/'job.json';d=json.loads(p.read_text());d['state']='done';p.write_text(json.dumps(d))
'''
FAKE_DOCKER = '''#!/usr/bin/python3
import json,os,sys
from pathlib import Path
p=Path(os.environ['FAKE_DOCKER_STATE']);d=json.loads(p.read_text());a=sys.argv[1:]
if a[:2] in (['container','inspect'],['network','inspect']):
 kind='containers' if a[0]=='container' else 'networks';name=a[2]
 if name not in d[kind]:
  print('Error: No such object',file=sys.stderr);sys.exit(1)
 print(json.dumps([d[kind][name]]))
elif a[0]=='rm' or a[:2]==['network','rm']:
 kind='containers' if a[0]=='rm' else 'networks';name=a[-1]
 d[kind].pop(name,None);d['removed'].append(name);p.write_text(json.dumps(d))
else:
 print('Unexpected mocked Docker command',file=sys.stderr);sys.exit(2)
'''


class UploadRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='geo-upload-runner-test-')
        self.root = Path(self.temporary.name)
        self.jobs = self.root / 'jobs'
        self.jobs.mkdir()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.node = self.bin / 'fake-node'
        self.node.write_text(FAKE_NODE)
        self.node.chmod(0o755)
        docker = self.bin / 'docker'
        docker.write_text(FAKE_DOCKER)
        docker.chmod(0o755)
        self.docker = self.root / 'docker.json'
        self.docker.write_text(json.dumps({'containers': {}, 'networks': {}, 'removed': []}))
        self.env = dict(os.environ, GEO_JOBS_DIR=str(self.jobs), PATH=str(self.bin) + os.pathsep + os.environ['PATH'], FAKE_DOCKER_STATE=str(self.docker))
        self.processes = []

    def tearDown(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            for stream in [process.stdin, process.stdout, process.stderr]:
                if stream:
                    stream.close()
        for pid_file in self.jobs.glob('*/child.pid'):
            pid = int(pid_file.read_text())
            command = Path('/proc') / str(pid) / 'cmdline'
            if command.exists() and str(self.node).encode() in command.read_bytes():
                os.kill(pid, signal.SIGTERM)
        self.temporary.cleanup()

    def job(self, extension='.geojson'):
        directory = self.jobs / str(uuid.uuid4())
        (directory / 'raw').mkdir(parents=True)
        (directory / 'raw' / ('input' + extension)).write_bytes(b'original')
        (directory / 'job.json').write_text(json.dumps({'id': directory.name, 'state': 'running'}))
        return directory

    def start(self, directory, free=100 * 1024 ** 3, **environment):
        # The I/O boundary is mocked; file locking and independent processes are real Linux operations.
        code = ('import runpy,sys;from unittest.mock import patch;from types import SimpleNamespace;'
                f'free={free};path=sys.argv.pop(1);'
                'mock=patch("os.statvfs",return_value=SimpleNamespace(f_bavail=free,f_frsize=1));'
                'mock.start();runpy.run_path(path,run_name="__main__")')
        process = subprocess.Popen([sys.executable, '-c', code, str(RUNNER), '--job', str(directory), '--node', str(self.node)],
                                   env=dict(self.env, **environment), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.processes.append(process)
        return process

    def accepted(self, process):
        self.assertTrue(select.select([process.stdout], [], [], 5)[0], 'Runner did not acknowledge admission')
        self.assertEqual(process.stdout.readline().strip(), 'GEO_UPLOAD_ACCEPTED')

    def test_concurrent_submissions_execute_one(self):
        first, second = self.job(), self.job()
        a = self.start(first, FAKE_WAIT='1.2')
        b = self.start(second, FAKE_WAIT='1.2')
        a.communicate(timeout=8)
        b.communicate(timeout=8)
        self.assertEqual(sorted([a.returncode, b.returncode]), [0, 75])
        completed = [d for d in [first, second] if json.loads((d / 'job.json').read_text())['state'] == 'done']
        self.assertEqual(len(completed), 1)
        self.assertEqual((first / 'raw/input.geojson').read_bytes(), b'original')
        self.assertEqual((second / 'raw/input.geojson').read_bytes(), b'original')

    def test_killed_supervisor_keeps_child_fence_then_reconciles_owned_orphans(self):
        old = self.job()
        supervisor = self.start(old, FAKE_WAIT='10')
        self.accepted(supervisor)
        for _ in range(50):
            if (old / 'child.pid').exists():
                break
            time.sleep(0.02)
        child = int((old / 'child.pid').read_text())
        supervisor.kill()
        supervisor.wait(timeout=3)
        blocked = self.start(self.job())
        blocked.communicate(timeout=3)
        self.assertEqual(blocked.returncode, 75)
        os.kill(child, signal.SIGTERM)
        for _ in range(50):
            try:
                if Path('/proc', str(child), 'stat').read_text().split(') ', 1)[1].startswith('Z'):
                    break
            except FileNotFoundError:
                break
            time.sleep(0.02)
        labels = {'org.geo.upload-job': old.name, 'org.geo.upload-dir': str(old)}
        tool = 'geo-job-' + old.name
        db = 'geo-job-db-' + old.name
        net = 'geo-job-net-' + old.name
        self.docker.write_text(json.dumps({'containers': {tool: {'Config': {'Labels': labels}, 'Mounts': [{'Destination': '/raw', 'Source': str(old / 'raw'), 'RW': False}]}, db: {'Config': {'Labels': labels}, 'Mounts': []}}, 'networks': {net: {'Labels': labels}}, 'removed': []}))
        new = self.job()
        recovered = self.start(new)
        recovered.communicate(timeout=5)
        self.assertEqual(recovered.returncode, 0)
        self.assertEqual(set(json.loads(self.docker.read_text())['removed']), {tool, db, net})
        self.assertEqual(json.loads((old / 'job.json').read_text())['state'], 'failed')
        self.assertEqual(json.loads((new / 'job.json').read_text())['state'], 'done')
        self.assertEqual((old / 'raw/input.geojson').read_bytes(), b'original')

    def test_unknown_container_ownership_is_preserved(self):
        old = self.job()
        (self.jobs / '.conversion.lock').write_text(json.dumps({'id': old.name}))
        name = 'geo-job-' + old.name
        self.docker.write_text(json.dumps({'containers': {name: {'Config': {'Labels': {}}, 'Mounts': []}}, 'networks': {}, 'removed': []}))
        p = self.start(self.job())
        p.communicate(timeout=4)
        self.assertEqual(p.returncode, 1)
        self.assertIn(name, json.loads(self.docker.read_text())['containers'])
        self.assertEqual(json.loads(self.docker.read_text())['removed'], [])

    def test_zip_traversal_and_symlink_are_rejected_without_deleting_raw(self):
        for name, mode in [('../escape.geojson', 0), ('/escape.geojson', 0), ('C:\\escape.geojson', 0), ('link.geojson', 0o120777)]:
            with self.subTest(name=name):
                job = self.job('.zip')
                source = job / 'raw/input.zip'
                with zipfile.ZipFile(source, 'w') as archive:
                    entry = zipfile.ZipInfo(name)
                    entry.external_attr = mode << 16
                    archive.writestr(entry, 'data')
                original = source.read_bytes()
                p = self.start(job)
                p.communicate(timeout=4)
                self.assertEqual(p.returncode, 64)
                self.assertEqual(json.loads((job / 'job.json').read_text())['state'], 'failed')
                self.assertEqual(source.read_bytes(), original)

    def test_zip_declared_uncompressed_limit_is_enforced(self):
        job = self.job('.zip')
        source = job / 'raw/input.zip'
        with zipfile.ZipFile(source, 'w') as archive:
            archive.writestr('data.geojson', 'x')
        body = bytearray(source.read_bytes())
        central = body.index(b'PK\x01\x02')
        struct.pack_into('<I', body, central + 24, 2 * 1024 ** 3 + 1)
        source.write_bytes(body)
        p = self.start(job)
        p.communicate(timeout=4)
        self.assertEqual(p.returncode, 64)
        self.assertTrue(source.exists())

    def test_output_growth_interrupts_child_and_preserves_original(self):
        job = self.job()
        p = self.start(job, FAKE_GROW='1', FAKE_WAIT='10')
        self.accepted(p)
        p.communicate(timeout=5)
        self.assertEqual(p.returncode, 64)
        state = json.loads((job / 'job.json').read_text())
        self.assertEqual(state['state'], 'failed')
        self.assertIn('4GiB', state['error'])
        self.assertEqual((job / 'raw/input.geojson').read_bytes(), b'original')

    def test_fast_output_growth_is_rejected_after_child_exit(self):
        job = self.job()
        p = self.start(job, FAKE_GROW='1')
        self.accepted(p)
        p.communicate(timeout=5)
        self.assertEqual(p.returncode, 64)
        self.assertEqual(json.loads((job / 'job.json').read_text())['state'], 'failed')
        self.assertEqual((job / 'raw/input.geojson').read_bytes(), b'original')

    def test_low_disk_admission_fails_without_launching_node(self):
        job = self.job()
        p = self.start(job, free=5 * 1024 ** 3)
        p.communicate(timeout=4)
        self.assertEqual(p.returncode, 73)
        self.assertFalse((job / 'child.pid').exists())
        self.assertEqual((job / 'raw/input.geojson').read_bytes(), b'original')


if __name__ == '__main__':
    unittest.main()
