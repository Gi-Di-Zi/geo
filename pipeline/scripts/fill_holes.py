"""다각형 안의 작은 구멍(채광창·환기구 같은 몇 ㎡짜리 안뜰)을 메운다. 큰 안뜰은 그대로 둔다.

mago 3DTiler 1.16.3은 아주 작은 구멍이 있는 건물에서 벽 법선을 만들지 못하고 전체 작업을 멈춘다.
사용: python fill_holes.py <입력 GeoJSON> <출력 GeoJSON> <최소 구멍 면적 ㎡>
"""
import json
import math
import sys

from shapely.geometry import Polygon, mapping, shape

src, dst, limit = sys.argv[1], sys.argv[2], float(sys.argv[3])
fc = json.load(open(src, encoding='utf-8'))
filled = 0
for f in fc['features']:
    g = shape(f['geometry'])
    if g.geom_type != 'Polygon' or not g.interiors:
        continue
    m2 = 111320 ** 2 * math.cos(math.radians(g.centroid.y))  # 위경도 면적(도²) → ㎡ 근사
    keep = [r for r in g.interiors if Polygon(r).area * m2 >= limit]
    filled += len(g.interiors) - len(keep)
    f['geometry'] = mapping(Polygon(g.exterior, keep))
json.dump(fc, open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print(f'구멍 {filled}개를 메웠어요 ({limit}㎡ 미만)')
