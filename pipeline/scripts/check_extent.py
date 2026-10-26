"""위경도로 정리한 벡터를 검사한다: 도형 수, 좌표가 위경도 범위 안인지. 문제면 이유와 함께 중단.

사용: python3 check_extent.py <벡터 파일> [--zoom <줌 하한 파일>] [--bounds <범위 파일>]
- 도형 0건, 또는 위경도 범위 안 도형 0건 → 종료 코드 1 (좌표계 표기가 없거나 틀린 파일이 끝 단계까지 가서 엉뚱한 오류로 실패하지 않게)
- 범위 밖 도형·도형 없는 피처(빈 좌표 행)는 지우고 계속 (뒤바뀐 위도·경도 등)
- --zoom: 범위 폭으로 정한 PMTiles·MVT 최대 줌 하한 (도시 12 ~ 국가 9 ~ 세계 6)
- --bounds: 범위 [서, 남, 동, 북] JSON (서버 결과의 확인 요청·처음 시점)
"""
import json
import math
import sys
from osgeo import ogr

ogr.UseExceptions()
path, args = sys.argv[1], sys.argv[2:]
opt = lambda name: args[args.index(name) + 1] if name in args else None
ds = ogr.Open(path, update=1)
total = with_geom = 0
bad, empty, box = [], [], [180.0, 90.0, -180.0, -90.0]
sample = None
for layer in ds:
    for f in layer:
        total += 1
        g = f.GetGeometryRef()
        if g is None or g.IsEmpty():
            empty.append((layer, f.GetFID()))
            continue
        with_geom += 1
        x0, x1, y0, y1 = g.GetEnvelope()
        if -180 <= x0 and x1 <= 180 and -90 <= y0 and y1 <= 90:
            box = [min(box[0], x0), min(box[1], y0), max(box[2], x1), max(box[3], y1)]
        else:
            bad.append((layer, f.GetFID()))
            sample = sample or (round(x0, 2), round(y0, 2))
print(f'피처 {total:,}개 · 도형 있음 {with_geom:,}개 · 위경도 범위 밖 {len(bad):,}개')
if not with_geom:
    sys.exit('도형 0건 → 중단. CSV면 좌표 열 이름(경도·위도, lon·lat, x·y, X좌표·Y좌표 …)과 값 확인. 평면 좌표(TM)면 판별 화면에서 좌표계 선택')
if len(bad) == with_geom:
    sys.exit(f'좌표가 모두 위경도 범위 밖(예: {sample}) → 중단. 파일에 좌표계 표기가 없거나 틀림 → 판별 화면에서 좌표계를 골라 다시')
for layer, fid in bad + empty:
    layer.DeleteFeature(fid)
if bad or empty:
    print(f'제외: 위경도 범위 밖 {len(bad):,}개 · 도형 없음 {len(empty):,}개')
print(f'범위: {box[0]:.5f}, {box[1]:.5f} ~ {box[2]:.5f}, {box[3]:.5f}')
if opt('--bounds'):
    open(opt('--bounds'), 'w').write(json.dumps(box))
if opt('--zoom'):
    span = max(box[2] - box[0], box[3] - box[1], 1e-6)
    zoom = max(4, min(12, round(math.log2(360 / span)) + 6))
    open(opt('--zoom'), 'w').write(str(zoom))
    print(f'범위 기준 최대 줌 하한: {zoom}')
