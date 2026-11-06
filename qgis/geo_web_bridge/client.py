# geo-web-bridge 서버 HTTP 호출. 표준 라이브러리(urllib)만 써서 추가 설치가 없고, 시스템 프록시 설정을 따른다
import json
import os
import urllib.error
import urllib.request
import uuid

AGENT = 'geo-web-bridge-qgis'


class ServerError(Exception):
    pass


def _open(request, timeout):
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        detail = ''
        try:
            body = json.loads(error.read().decode('utf-8'))
            detail = body.get('message') or body.get('statusMessage') or ''
        except Exception:
            pass
        raise ServerError(f'서버 응답 {error.code}: {detail or error.reason}') from None
    except urllib.error.URLError as error:
        raise ServerError(f'서버에 연결하지 못함: {error.reason}') from None


def get_json(url, timeout=60):
    request = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': AGENT})
    with _open(request, timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def post_json(url, data, timeout=120):
    request = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), method='POST',
                                     headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': AGENT})
    with _open(request, timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def post_file(url, fields, path, timeout=900):
    """multipart/form-data: 문자열 필드 + 파일 하나(file)"""
    boundary = uuid.uuid4().hex
    head = b''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode('utf-8') for key, value in fields.items())
    name = os.path.basename(path).replace('"', '')
    with open(path, 'rb') as file:
        data = file.read()
    body = head + f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode('utf-8') + data + f'\r\n--{boundary}--\r\n'.encode('utf-8')
    request = urllib.request.Request(url, data=body, method='POST',
                                     headers={'Content-Type': f'multipart/form-data; boundary={boundary}', 'Accept': 'application/json', 'User-Agent': AGENT})
    with _open(request, timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def download(url, path, timeout=900):
    request = urllib.request.Request(url, headers={'User-Agent': AGENT})
    with _open(request, timeout) as response, open(path, 'wb') as file:
        while True:
            chunk = response.read(1 << 16)
            if not chunk:
                break
            file.write(chunk)
    return path
