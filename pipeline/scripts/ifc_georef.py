# IFC의 위치 정보 → 모델을 세울 곳과 IfcConvert 배치 인자. IFC는 텍스트(STEP)라 필요한 엔티티만 읽는다
#   1) IfcMapConversion + IfcProjectedCRS(EPSG): 모델 원점의 지도 좌표 → 경위도, X축 방향 → 회전 (IFC4 지리참조)
#   2) 없으면 IfcSite RefLatitude·RefLongitude (도·분·초·백만분의 1초): 대지 원점 기준, 회전 없음
#   3) 둘 다 없으면 기본 위치(인자)
# 높이는 0: 지형 없는 지도의 바닥 = 모델 원점. 원래 표고는 기록만 남긴다
# 쓰는 파일: <anchor.json> [경도, 위도, 0], /work/anchor "경도 위도 0", /work/ifc_place (IfcConvert 배치 인자)
# ponytail: 자오선 수렴각 무시 → UTM 띠 가장자리에서 방위 최대 약 3° 오차. 필요하면 pyproj get_factors로 보정
# 사용: python3 ifc_georef.py <입력.ifc> <anchor.json> <기본 경도> <기본 위도>
import json
import math
import re
import sys

from pyproj import Transformer

src, out, lon0, lat0 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
text = open(src, encoding='utf-8', errors='replace').read()


def entities(name):
    return [m.group(1) for m in re.finditer(rf'=\s*{name}\s*\((.*?)\)\s*;', text, re.S | re.I)]


def place(lon, lat, args, how):
    # 끝 줄바꿈 필수: 셸 read는 줄바꿈 없이 끝나면 값을 읽고도 실패(1)를 돌려준다
    with open('/work/anchor', 'w') as f:
        f.write(f'{lon:.8f} {lat:.8f} 0\n')
    with open('/work/ifc_place', 'w') as f:
        f.write(args)
    with open(out, 'w') as f:
        json.dump([round(lon, 8), round(lat, 8), 0], f)
    print(f'{how} → 경도 {lon:.6f}, 위도 {lat:.6f}')
    sys.exit()


def number(v, default):
    return float(v) if re.fullmatch(r'-?[\d.]+(E-?\d+)?', v.strip(), re.I) else default


conv = entities('IFCMAPCONVERSION')
crs = entities('IFCPROJECTEDCRS')
epsg = re.search(r'EPSG\D{0,3}(\d{4,6})', crs[0] if crs else '', re.I)

if conv and epsg:
    # SourceCRS, TargetCRS, Eastings, Northings, OrthogonalHeight, XAxisAbscissa, XAxisOrdinate, Scale
    v = conv[0].split(',')
    lon, lat = Transformer.from_crs(f'EPSG:{epsg.group(1)}', 'EPSG:4326', always_xy=True).transform(number(v[2], 0), number(v[3], 0))
    turn = math.atan2(number(v[6], 0), number(v[5], 1))
    # 모델 X축이 지도 동쪽에서 turn만큼 돌아 있음 → 모델을 같은 각도로 돌려 동·북에 맞춘다 (Z축 회전 사원수 x;y;z;w)
    place(lon, lat, f'--model-rotation 0;0;{math.sin(turn / 2):.12f};{math.cos(turn / 2):.12f}',
          f'IfcMapConversion (EPSG:{epsg.group(1)}, 원점 표고 {v[4].strip()}m는 0으로, 회전 {math.degrees(turn):.2f}°)')

if conv:
    print('IfcMapConversion 있으나 좌표계(IfcProjectedCRS)의 EPSG 번호를 못 읽음 → 다음 방법으로')

for site in entities('IFCSITE'):
    angles = re.findall(r'\((-?\d+),(-?\d+),(-?\d+)(?:,(-?\d+))?\)', site)

    if len(angles) >= 2:
        lat, lon = (int(d) + int(m) / 60 + (int(s) + int(u or 0) / 1e6) / 3600 for d, m, s, u in angles[:2])
        place(lon, lat, '--site-local-placement', 'IfcSite RefLatitude·RefLongitude (대지 원점, 회전 미적용)')

place(lon0, lat0, '--building-local-placement', '위치 정보 없음 (IfcMapConversion·IfcSite 위경도) → 기본 위치')
