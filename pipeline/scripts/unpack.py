"""올린 zip에서 기준 파일(tileset.json, layer.json, *.gltf …)이 있는 폴더를 꺼낸다.

사용: python3 unpack.py <zip> <기준 파일 이름 또는 확장자> <대상 폴더>
- 기준 파일이 여러 개면 가장 얕은 위치의 것을 쓴다 (하위 tileset.json은 바깥 타일셋이 가리키는 자식)
- gzip으로 압축된 타일은 풀어 둔다 (정적 서버는 Content-Encoding을 붙여 주지 않는다)
"""
import gzip
import os
import shutil
import sys
import zipfile

LIMIT = 2 * 1024 ** 3  # 압축을 푼 전체 크기 상한
src, marker, dest = sys.argv[1], sys.argv[2], sys.argv[3]

z = zipfile.ZipFile(src)
if sum(i.file_size for i in z.infolist()) > LIMIT:
    sys.exit('압축을 풀면 2GB가 넘어요.')
hits = sorted((n for n in z.namelist() if os.path.basename(n) == marker or (marker.startswith('.') and n.lower().endswith(marker))),
              key=lambda n: n.count('/'))
if not hits:
    sys.exit(f'zip 안에 {marker}이(가) 없어요.')
top = os.path.dirname(hits[0])
os.makedirs(dest, exist_ok=True)
for info in z.infolist():
    if info.is_dir() or not info.filename.startswith(top):
        continue
    rel = os.path.relpath(info.filename, top) if top else info.filename
    target = os.path.realpath(os.path.join(dest, rel))
    if not target.startswith(os.path.realpath(dest) + os.sep):
        continue  # ../ 같은 경로로 밖에 쓰려는 항목은 건너뛴다
    os.makedirs(os.path.dirname(target), exist_ok=True)
    data = z.read(info)
    if data[:2] == b'\x1f\x8b':
        data = gzip.decompress(data)
    with open(target, 'wb') as f:
        f.write(data)
print(f'{os.path.basename(hits[0])} 기준으로 {top or "(맨 위)"} 폴더를 풀었어요.')
print(os.path.join(dest, os.path.basename(hits[0])))
