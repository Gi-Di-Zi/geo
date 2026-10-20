"""quantized-mesh 지형 서비스에서 범위 안 타일만 받아, 받은 범위만 있다고 적은 layer.json과 함께 저장한다.

서버의 layer.json에서 타일 주소 규칙을 읽고, 위경도 TMS 격자(줌 0에서 2×1장, y는 남쪽부터)로 범위에 걸치는 타일을 줌마다 받는다.
타일 안의 metadata 확장은 서버 전체에 있는 하위 타일을 알려 주므로, 받은 일부만 올릴 때는 쓰지 않게 layer.json에서 뺀다.

사용: python qm_fetch.py <서비스 주소/> <서> <남> <동> <북> <최대 줌> <저장 폴더>
"""
import json
import math
import os
import sys
import urllib.request

base, west, south, east, north, maxzoom, out = sys.argv[1], *map(float, sys.argv[2:6]), int(sys.argv[6]), sys.argv[7]
get = lambda url: urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'geo-web-showcase'}), timeout=60).read()

layer = json.loads(get(base + 'layer.json'))
template = layer['tiles'][0].replace('{version}', layer.get('version', ''))
available, count, size = [], 0, 0
for z in range(maxzoom + 1):
    deg = 180 / 2 ** z  # 타일 한 장의 경위도 폭
    x0, x1 = math.floor((west + 180) / deg), math.floor((east + 180) / deg)
    y0, y1 = math.floor((south + 90) / deg), math.floor((north + 90) / deg)
    if z == 0:  # Cesium은 줌 0 타일(동·서 반구 2장)이 모두 있어야 지구를 그리기 시작한다
        x0, x1, y0, y1 = 0, 1, 0, 0
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            data = get(base + template.format(z=z, x=x, y=y))
            os.makedirs(f'{out}/{z}/{x}', exist_ok=True)
            open(f'{out}/{z}/{x}/{y}.terrain', 'wb').write(data)
            count, size = count + 1, size + len(data)
    available.append([{'startX': x0, 'startY': y0, 'endX': x1, 'endY': y1}])
    print(f'줌 {z:2d}: x {x0}~{x1}, y {y0}~{y1}')

layer.update(tiles=['{z}/{x}/{y}.terrain'], maxzoom=maxzoom, available=available, bounds=[west, south, east, north],
             extensions=[e for e in layer.get('extensions', []) if e != 'metadata'])
layer.pop('metadataAvailability', None)
json.dump(layer, open(f'{out}/layer.json', 'w'), indent=1)
print(f'타일 {count}장, {size / 1024:.0f}KB')
