"""공개 3D Tiles 타일셋에서 한 구역만 받아 온다. 받은 타일만 남긴 tileset.json을 함께 쓴다.

경계가 구역 정사각형과 겹치는 타일만 모든 깊이에서 남긴다.
- box: 루트 transform 아래 지역 좌표(미터). 구역 중심·반폭도 미터
- region: 위경도(라디안) 범위. 구역 중심·반폭은 도(°)
refine이 ADD인 타일셋이면 위쪽 타일(넓은 범위의 성긴 내용)은 그대로 남고, 구역 안에서만 촘촘한 타일까지 내려간다.
내용이 다른 tileset.json(외부 타일셋)이면 그것도 받아 같은 규칙으로 줄이고,
i3dm이 바깥 모델(gltfFormat 0)을 가리키면 그 glb도 받는다.

사용: python tiles_subset.py <tileset.json 주소> <구역 중심 x> <구역 중심 y> <반폭> <저장 폴더>
"""
import json
import math
import os
import posixpath
import struct
import sys
import urllib.request

url, cx, cy, half, out = sys.argv[1], *map(float, sys.argv[2:5]), sys.argv[5]
root_dir = url.rsplit('/', 1)[0] + '/'
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'geo-web-showcase'}), timeout=60).read()
saved = {}


def save(path, data):
    """root_dir 기준 상대 경로로 저장한다"""
    os.makedirs(os.path.dirname(f'{out}/{path}') or out, exist_ok=True)
    open(f'{out}/{path}', 'wb').write(data)
    saved[path] = len(data)


def hit(bv):
    if 'box' in bv:
        b = bv['box']
        return abs(b[0] - cx) <= b[3] + half and abs(b[1] - cy) <= b[7] + half
    w, s, e, n = (math.degrees(v) for v in bv['region'][:4])
    return w <= cx + half and e >= cx - half and s <= cy + half and n >= cy - half


def models(data):
    """타일이 가리키는 바깥 glb 주소들 (i3dm gltfFormat 0, cmpt 안의 i3dm)"""
    magic = data[:4]
    if magic == b'cmpt':
        count, pos, found = struct.unpack_from('<I', data, 12)[0], 16, []
        for _ in range(count):
            length = struct.unpack_from('<I', data, pos + 8)[0]
            found += models(data[pos:pos + length])
            pos += length
        return found
    if magic == b'i3dm' and struct.unpack_from('<I', data, 28)[0] == 0:
        _, length, fj, fb, bj, bb = struct.unpack_from('<6I', data, 4)
        return [data[32 + fj + fb + bj + bb:length].decode().strip(' \x00')]
    return []


def prune(node, here):
    """here: 이 노드가 속한 tileset.json의 폴더 (root_dir 기준 상대 경로)"""
    uri = node.get('content', {}).get('uri')
    if uri:
        path = posixpath.normpath(posixpath.join(here, uri))
        data = get(root_dir + path)
        if path.endswith('.json'):
            sub = json.loads(data)
            prune(sub['root'], posixpath.dirname(path))
            save(path, json.dumps(sub).encode())
        else:
            save(path, data)
            for m in models(data):
                mpath = posixpath.normpath(posixpath.join(posixpath.dirname(path), m))
                if mpath not in saved:
                    save(mpath, get(root_dir + mpath))
    node['children'] = [prune(c, here) for c in node.get('children', []) if hit(c['boundingVolume'])]
    if not node['children']:
        del node['children']
    return node


tileset = json.loads(get(url))
prune(tileset['root'], '')
save('tileset.json', json.dumps(tileset).encode())
kinds = {}
for p, n in saved.items():
    ext = p.rsplit('.', 1)[-1]
    kinds[ext] = (kinds.get(ext, (0, 0))[0] + 1, kinds.get(ext, (0, 0))[1] + n)
print(', '.join(f'{k} {c}개 {s / 1024:.0f}KB' for k, (c, s) in sorted(kinds.items())))
