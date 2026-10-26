"""건물 GeoJSON에 height(m)를 채운다. 어떤 값을 썼는지 height_source에 남긴다.

사용: python3 fill_height.py <입력.geojson> <출력.geojson>
실측 높이 열 → 층수 열 × 3m → 기본값 9m 순서로 찾는다. 열 이름은 흔히 쓰는 것들을 대소문자 구분 없이 본다.
"""
import json
import sys

HEIGHT = ['height', 'hgt_median_m', 'building:height', 'bld_hgt', 'hgt', 'build_height', '높이']
FLOORS = ['num_floors', 'building:levels', 'levels', 'floors', 'grnd_flr', 'gro_flo_co', '지상층수']


def pick(props, names):
    low = {k.lower(): v for k, v in props.items()}
    for n in names:
        try:
            v = float(low[n])
            if v > 0:
                return n, v
        except (KeyError, TypeError, ValueError):
            pass
    return None, None


fc = json.load(open(sys.argv[1], encoding='utf-8'))
count = {}
for f in fc['features']:
    p = f.setdefault('properties', {}) or {}
    n, h = pick(p, HEIGHT)
    if h is not None:
        src = f'실측 높이({n})'
    else:
        n, floors = pick(p, FLOORS)
        h, src = (floors * 3, f'층수({n})×3m') if floors else (9.0, '기본값 9m')
    p['height'], p['height_source'] = round(h, 1), src
    f['properties'] = p
    count[src] = count.get(src, 0) + 1
json.dump(fc, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
for k, v in sorted(count.items(), key=lambda x: -x[1]):
    print(f'{k}: {v}동')
