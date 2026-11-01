#!/usr/bin/env python3
"""Single Linux upload conversion, fenced across web-worker restarts."""
import argparse
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import subprocess
import sys
import zipfile

ID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
LABEL = 'org.geo.upload-job'
DIRECTORY_LABEL = 'org.geo.upload-dir'
BUSY = 75
INPUT_LIMIT = 200 * 1024 ** 2
OUTPUT_LIMIT = 4 * 1024 ** 3
MIN_FREE = 10 * 1024 ** 3


class UploadRejected(RuntimeError):
    def __init__(self, message, code=64):
        super().__init__(message)
        self.code = code


def check_free(directory):
    disk = os.statvfs(directory)
    if disk.f_bavail * disk.f_frsize < MIN_FREE:
        raise UploadRejected('업로드 저장 공간이 부족합니다. 운영자에게 문의하세요.', 73)


def input_preflight(directory):
    files = list((directory / 'raw').iterdir())
    if len(files) != 1 or not files[0].is_file() or files[0].is_symlink():
        raise UploadRejected('올바른 원본 파일 하나가 필요합니다.')
    source = files[0]
    if source.stat().st_size > INPUT_LIMIT:
        raise UploadRejected('파일 크기 한도를 넘었습니다.')
    if source.suffix.lower() != '.zip':
        return
    try:
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            if len(entries) > 50_000 or sum(e.file_size for e in entries) > 2 * 1024 ** 3:
                raise UploadRejected('ZIP은 파일 50,000개·압축 해제 크기 2GiB 이하여야 합니다.')
            for entry in entries:
                name = entry.filename.replace('\\', '/')
                mode = stat.S_IFMT(entry.external_attr >> 16)
                if (name.startswith('/') or re.match(r'^[A-Za-z]:', name)
                        or '..' in PurePosixPath(name).parts
                        or mode not in (0, stat.S_IFREG, stat.S_IFDIR)):
                    raise UploadRejected('ZIP의 외부 경로·링크·특수 파일은 허용하지 않습니다.')
    except zipfile.BadZipFile as error:
        raise UploadRejected('유효한 ZIP 파일이 아닙니다.') from error


def working_bytes(directory):
    size = 0
    for current, _directories, files in os.walk(directory, followlinks=False):
        for name in files:
            try:
                info = (Path(current) / name).lstat()
            except FileNotFoundError:
                continue
            if stat.S_ISREG(info.st_mode):
                size += info.st_size
                if size > OUTPUT_LIMIT:
                    return size
    return size


def need(condition, message):
    if not condition:
        raise RuntimeError(message)


def save(path, value):
    temporary = path.with_name(path.name + '.worker.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.chmod(0o600)
    os.replace(temporary, path)


def metadata(job_dir):
    path = job_dir / 'job.json'
    need(path.is_file() and not path.is_symlink(), '작업 메타데이터를 확인할 수 없습니다.')
    body = json.loads(path.read_text())
    need(body.get('id') == job_dir.name, '작업 식별자가 일치하지 않습니다.')
    return body


def inspect(kind, name):
    result = subprocess.run(['docker', kind, 'inspect', name], capture_output=True, timeout=20)
    if result.returncode:
        missing = b'No such' in result.stderr or b'not found' in result.stderr
        need(missing, '변환 Docker 엔진에 접근할 수 없습니다.')
        return None
    values = json.loads(result.stdout)
    need(len(values) == 1, '변환 리소스 식별자가 일치하지 않습니다.')
    return values[0]


def remove_owned(job_dir):
    job_id = job_dir.name
    for name, database in [('geo-job-' + job_id, False), ('geo-job-db-' + job_id, True)]:
        container = inspect('container', name)
        if container is None:
            continue
        labels = container.get('Config', {}).get('Labels') or {}
        need(labels.get(LABEL) == job_id and labels.get(DIRECTORY_LABEL) == str(job_dir),
             '이 작업 소유인지 확인되지 않은 컨테이너를 보존했습니다.')
        if not database:
            need(any(m.get('Destination') == '/raw' and m.get('Source') == str(job_dir / 'raw')
                     and not m.get('RW', True) for m in container.get('Mounts', [])),
                 '원본 마운트가 확인되지 않은 컨테이너를 보존했습니다.')
        result = subprocess.run(['docker', 'rm', '-f', *(['-v'] if database else []), name],
                                capture_output=True, timeout=25)
        need(result.returncode == 0, '중단된 작업 컨테이너를 정리하지 못했습니다.')
    name = 'geo-job-net-' + job_id
    network = inspect('network', name)
    if network is not None:
        labels = network.get('Labels') or {}
        need(labels.get(LABEL) == job_id and labels.get(DIRECTORY_LABEL) == str(job_dir),
             '이 작업 소유인지 확인되지 않은 네트워크를 보존했습니다.')
        result = subprocess.run(['docker', 'network', 'rm', name], capture_output=True, timeout=20)
        need(result.returncode == 0, '중단된 작업 네트워크를 정리하지 못했습니다.')


def fail_unfinished(job_dir, message):
    job = metadata(job_dir)
    if job.get('state') == 'running':
        save(job_dir / 'job.json', {**job, 'state': 'failed', 'error': message})


def run(args):
    os.umask(0o077)
    source = Path(__file__).resolve().parent.parent
    data = Path(os.environ.get('GEO_DATA_DIR', str(source / '.data')))
    jobs = Path(os.environ.get('GEO_JOBS_DIR', str(data / 'jobs'))).resolve()
    directory = Path(args.job)
    need(directory.resolve() == directory and directory.parent == jobs and ID.fullmatch(directory.name),
         '허용된 업로드 작업 경로가 아닙니다.')
    metadata(directory)
    jobs.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_path = jobs / '.conversion.lock'
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    child = None
    stopped = False
    claimed = False

    def stop(_signum, _frame):
        nonlocal stopped
        stopped = True
        if child is not None and child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1,
             '변환 잠금 파일을 확인할 수 없습니다.')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('GEO_UPLOAD_BUSY', file=sys.stderr)
            return BUSY
        previous = os.read(fd, 16_384)
        if previous:
            stored = json.loads(previous)
            previous_id = stored.get('id', '')
            need(ID.fullmatch(previous_id), '기존 변환 잠금 기록을 확인할 수 없습니다.')
            previous_dir = jobs / previous_id
            need(previous_dir.resolve() == previous_dir, '기존 작업 경로를 확인할 수 없습니다.')
            remove_owned(previous_dir)
            fail_unfinished(previous_dir, '작업자 재시작으로 중단된 변환입니다. 원본 파일은 보존했습니다.')
        need(not stopped, '작업자 종료 중에는 변환을 시작하지 않습니다.')
        check_free(jobs)
        input_preflight(directory)
        record = json.dumps({'id': directory.name, 'directory': str(directory), 'supervisorPid': os.getpid()}).encode()
        os.lseek(fd, 0, os.SEEK_SET)
        os.ftruncate(fd, 0)
        os.write(fd, record)
        os.fsync(fd)
        claimed = True
        with (directory / 'worker.log').open('ab', buffering=0) as log:
            child = subprocess.Popen([args.node, str(source / 'scripts/pipeline.ts'), '--job', str(directory)],
                                     cwd=source, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                     pass_fds=(fd,))
            print('GEO_UPLOAD_ACCEPTED', flush=True)
            while True:
                try:
                    status = child.wait(timeout=1)
                    break
                except subprocess.TimeoutExpired:
                    check_free(jobs)
                    if working_bytes(directory) > OUTPUT_LIMIT:
                        raise UploadRejected('변환 작업 저장 공간 4GiB 한도를 넘어 중단했습니다.')
        remove_owned(directory)
        check_free(jobs)
        if working_bytes(directory) > OUTPUT_LIMIT:
            raise UploadRejected('변환 작업 저장 공간 4GiB 한도를 넘어 중단했습니다.')
        fail_unfinished(directory, '작업자 종료로 변환이 중단되었습니다. 원본 파일은 보존했습니다.'
                        if stopped else '변환 프로세스가 결과를 남기지 못했습니다. 원본 파일은 보존했습니다.')
        return status if status >= 0 else 1
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                remove_owned(directory)
            except (OSError, RuntimeError, subprocess.SubprocessError):
                print('GEO_UPLOAD_ERROR: 중단된 리소스 소유 확인이 필요합니다.', file=sys.stderr)
            try:
                child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        if isinstance(error, UploadRejected):
            job = metadata(directory)
            save(directory / 'job.json', {**job, 'state': 'failed', 'error': str(error)})
        elif claimed:
            fail_unfinished(directory, '변환 작업자가 중단되었습니다. 원본 파일은 보존했습니다.')
        prefix = 'GEO_UPLOAD_REJECTED: ' if isinstance(error, UploadRejected) else 'GEO_UPLOAD_ERROR: '
        print(prefix + str(error), file=sys.stderr)
        return error.code if isinstance(error, UploadRejected) else 1
    finally:
        os.close(fd)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True)
    parser.add_argument('--node', required=True)
    sys.exit(run(parser.parse_args()))
