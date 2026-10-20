"""3D Tiles 1.0 타일(pnts, b3dm, i3dm, cmpt) 하나의 헤더와 피처·배치 테이블을 보여준다.

공통 구조: 28바이트 헤더(i3dm은 32바이트) → 피처 테이블(JSON + 이진) → 배치 테이블(JSON + 이진) → (b3dm, i3dm) glTF
cmpt(복합 타일)는 16바이트 헤더 뒤에 다른 타일 여러 개를 이어 붙인 것이라 안쪽 타일을 하나씩 보여준다.
사용: python tile_header.py <tile.pnts|b3dm|i3dm|cmpt>
"""
import json
import struct
import sys


def describe(data, indent=''):
    magic = data[:4].decode()
    if magic == 'cmpt':
        version, length, count = struct.unpack_from('<3I', data, 4)
        print(f'{indent}종류: cmpt v{version} (복합 타일), 전체 {length:,}바이트, 안쪽 타일 {count}개')
        pos = 16
        for i in range(count):
            inner = struct.unpack_from('<I', data, pos + 8)[0]
            print(f'{indent}── 안쪽 타일 {i + 1}')
            describe(data[pos:pos + inner], indent + '   ')
            pos += inner
        return
    version, length, ft_json, ft_bin, bt_json, bt_bin = struct.unpack_from('<6I', data, 4)
    header = 32 if magic == 'i3dm' else 28
    print(f'{indent}종류: {magic} v{version}, 전체 {length:,}바이트')
    print(f'{indent}피처 테이블: JSON {ft_json}B + 이진 {ft_bin:,}B, 배치 테이블: JSON {bt_json}B + 이진 {bt_bin:,}B')
    ft = json.loads(data[header:header + ft_json].decode().strip() or '{}')
    print(f'{indent}피처 테이블:', json.dumps(ft, ensure_ascii=False))
    if bt_json:
        start = header + ft_json + ft_bin
        bt = json.loads(data[start:start + bt_json].decode().strip() or '{}')
        print(f'{indent}배치 테이블:', json.dumps(bt, ensure_ascii=False)[:600])
    if magic == 'i3dm':
        body = header + ft_json + ft_bin + bt_json + bt_bin
        if struct.unpack_from('<I', data, 28)[0] == 1:
            print(f'{indent}glTF: 파일 안에 GLB를 통째로 담음')
        else:
            print(f'{indent}glTF: 바깥 glb 주소만 담음 → {data[body:length].decode().strip(" " + chr(0))}')


path = sys.argv[1]
print(f'파일: {path}')
describe(open(path, 'rb').read())
