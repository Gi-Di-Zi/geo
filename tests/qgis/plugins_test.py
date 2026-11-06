# QGIS 플러그인(qgis/) 흐름 시험: QGIS Python(화면 없음)으로 내보내기 → 실제 서버 변환 → 결과 레이어, 주소·코드 연계 → 결과·점 레이어, 메뉴·대화상자.
# 실제 변환 작업자가 있는 서버가 필요하다 (docs/ci-cd.md). 사용(Windows): "%PROGRAMFILES%\QGIS 3.44.9\bin\python-qgis-ltr.bat" tests/qgis/plugins_test.py qgis http://localhost:3000 <빈 폴더>
import os
import sys

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
from qgis.core import QgsApplication, QgsFeature, QgsField, QgsGeometry, QgsPointXY, QgsProject, QgsVectorLayer  # noqa: E402

repo, server, work = sys.argv[1:4]
sys.path.insert(0, repo)
app = QgsApplication([], True)
app.initQgis()

from geo_address_link import core as link  # noqa: E402
from geo_web_bridge import core as viz  # noqa: E402

failed = []


def check(name, ok, detail=''):
    print(('OK   ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))
    if not ok:
        failed.append(name)


# 1) 시각화: 점 레이어(EPSG:5186, 한글 속성) → GeoPackage → 변환 → 결과 파일 받기 → QGIS 레이어
points = QgsVectorLayer('Point?crs=EPSG:5186&field=이름:string&field=값:integer', '시험 점', 'memory')
features = []
for i, (x, y) in enumerate([(197000, 552000), (198000, 551500), (199500, 553000)]):
    f = QgsFeature(points.fields())
    f.setAttributes([f'지점{i}', i])
    f.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(x, y)))
    features.append(f)
points.dataProvider().addFeatures(features)
path, fmt = viz.export_layer(points, work)
check('벡터 내보내기 GeoPackage', fmt == 'vector-2d/gpkg' and os.path.getsize(path) > 0, path)
log = []
info, folder, base = viz.convert(server, path, fmt, {'viewer': 'maplibre', 'priority': 'balanced', 'form': 'files'}, os.path.join(work, 'files'), report=lambda t, p=None: log.append(t))
primary = info['primary']
layer = viz.result_layer(primary, base, 'result')
check('파일 결과 받기 + QGIS 레이어', layer is not None and layer.isValid(), f'{primary["kind"]} {folder}')
if layer is not None and primary['kind'] == 'geojson':
    check('GeoJSON 피처 수 = 3', layer.featureCount() == 3, str(layer.featureCount()))
check('적용 코드 있음', bool(info.get('usages')) and 'maplibre' in info['usages'][0]['code'])

# 2) 같은 레이어를 HTML 지도로 (OpenLayers)
info2, folder2, base2 = viz.convert(server, path, fmt, {'viewer': 'ol', 'priority': 'balanced', 'form': 'html'}, os.path.join(work, 'html'))
check('HTML 지도 폴더: index.html·lib·README', all(os.path.exists(os.path.join(folder2, p)) for p in ('index.html', 'lib', 'README.txt', 'data')), folder2)
usage = next(u for u in info2['usages'] if u['site'] == info2['site'])
out2 = next(o for o in info2['outputs'] if o['id'] == usage['output'])
layer2 = viz.result_layer(out2, base2, 'html-result')
check('HTML 지도 data/ → QGIS 레이어', layer2 is not None and layer2.isValid(), out2['kind'])

# 3) 래스터: 작은 GeoTIFF(EPSG:4326) → 원본 그대로 올림 → 결과 → QGIS 레이어
from osgeo import gdal, osr  # noqa: E402

tif = os.path.join(work, '시험영상.tif')
ds = gdal.GetDriverByName('GTiff').Create(tif, 64, 64, 3, gdal.GDT_Byte)
ds.SetGeoTransform([126.97, 0.0005, 0, 37.57, 0, -0.0005])
srs = osr.SpatialReference()
srs.ImportFromEPSG(4326)
ds.SetProjection(srs.ExportToWkt())
for band in range(1, 4):
    ds.GetRasterBand(band).Fill(60 * band)
ds = None
from qgis.core import QgsRasterLayer  # noqa: E402

raster = QgsRasterLayer(tif, '시험영상')
path3, fmt3 = viz.export_layer(raster, work)
check('래스터 원본 GeoTIFF 그대로', path3 == tif and fmt3 == 'raster/tif')
info3, folder3, base3 = viz.convert(server, path3, fmt3, {'viewer': 'ol', 'priority': 'balanced', 'form': 'files'}, os.path.join(work, 'raster'))
layer3 = viz.result_layer(info3['primary'], base3, 'raster-result')
check('래스터 결과 → QGIS 레이어', layer3 is not None and layer3.isValid(), info3['primary']['kind'])

# 4) 주소·코드 연계: 도형 없는 표 → 외부 조회 켬(20줄씩) → 결과 열 + 점 레이어
table = QgsVectorLayer('None?field=입력:string&field=번호:integer', '시험 표', 'memory')
values = ['1111010100100010000', '서울 강남구 테헤란로 152', '경기도 부천시 중동 1156', '중구 태평로1가 31', '4211011200101000000', '', '1111010100100010000']
rows = []
for i, value in enumerate(values):
    f = QgsFeature(table.fields())
    f.setAttributes([value, i])
    rows.append(f)
table.dataProvider().addFeatures(rows)
items = [(f, str(f['입력']).strip() if f['입력'] not in (None, '') else '') for f in table.getFeatures()]
results, stopped = link.resolve(server, [v for _, v in items], 'auto', True)
check('연계: 서로 다른 값만 조회', len(results) == 5 and stopped is None, str(len(results)))
names = link.ALWAYS + [n for _, group, _ in link.GROUPS for n in group]
same, dots, lots = link.build_layers(table, items, results, names, points=True, parcels=True)
by_input = {f['입력']: f for f in same.getFeatures()}
check('연계: PNU는 문자열 그대로', by_input['서울 강남구 테헤란로 152']['g_pnu'] == '1168010100107370000', str(by_input['서울 강남구 테헤란로 152']['g_pnu']))
check('연계: 행정동 확정(역조회)', by_input['서울 강남구 테헤란로 152']['g_hjd_nm'] == '서울특별시 강남구 역삼1동', str(by_input['서울 강남구 테헤란로 152']['g_hjd_nm']))
check('연계: 옛 강원 코드 → 51', by_input['4211011200101000000']['g_pnu'] == '5111011200101000000')
check('연계: 동명이인 후보는 확인 사항에', by_input['중구 태평로1가 31']['g_status'] == 'needs_selection' and '후보' in by_input['중구 태평로1가 31']['g_note'], by_input['중구 태평로1가 31']['g_note'])
check('연계: 빈 값은 empty', by_input[''] ['g_status'] == 'empty' if '' in by_input else True)
check('연계: 원본 행 수 유지', same.featureCount() == len(values), str(same.featureCount()))
check('연계: 위치 점 레이어', dots is not None and dots.featureCount() >= 4, str(dots and dots.featureCount()))
check('연계: 별칭(한글)', same.attributeAlias(same.fields().indexOf('g_pnu')) == 'PNU')
teheran = by_input['서울 강남구 테헤란로 152']
check('연계: 도로명주소·건물 유무', teheran['g_road'] == '서울특별시 강남구 테헤란로 152' and teheran['g_bld'] == '있음' and teheran['g_bld_n'] == 1, f"{teheran['g_road']} {teheran['g_bld']} {teheran['g_bld_n']}")
check('연계: 필지 실재·토지 속성(면적 숫자)', teheran['g_parcel'] == '있음' and teheran['g_jimok'] == '대' and isinstance(teheran['g_area'], float) and teheran['g_area'] > 10000, f"{teheran['g_parcel']} {teheran['g_jimok']} {teheran['g_area']} {teheran['g_zone']}")
check('연계: 필지 경계 레이어', lots is not None and lots.featureCount() >= 3 and all(f.geometry().area() > 0 for f in lots.getFeatures()), str(lots and lots.featureCount()))

# 4-1) 도형 위치 → 그 지점의 필지: EPSG:5186 점 (역삼동 737 안)
from qgis.core import QgsCoordinateReferenceSystem, QgsCoordinateTransform  # noqa: E402

to5186 = QgsCoordinateTransform(QgsCoordinateReferenceSystem('EPSG:4326'), QgsCoordinateReferenceSystem('EPSG:5186'), QgsProject.instance())
spot = QgsVectorLayer('Point?crs=EPSG:5186&field=이름:string', '측량점', 'memory')
feature = QgsFeature(spot.fields())
feature.setAttributes(['점1'])
feature.setGeometry(QgsGeometry.fromPointXY(to5186.transform(QgsPointXY(127.03651, 37.50003))))
spot.dataProvider().addFeatures([feature])
spot_items = [(f, link.geometry_value(f, link.wgs84(spot))) for f in spot.getFeatures()]
spot_results, _ = link.resolve(server, [v for _, v in spot_items], 'location', True)
spot_layer, _, _ = link.build_layers(spot, spot_items, spot_results, names)
spot_row = next(spot_layer.getFeatures())
check('연계: 도형 위치(EPSG:5186 점) → 필지 PNU', spot_row['g_pnu'] == '1168010100107370000' and spot_row['g_bld'] == '있음', f"{spot_items[0][1]} → {spot_row['g_pnu']}")

# 5) 외부 조회 끔: 200줄씩, 위치 없음
many = ['1111010100100010000'] + [f'11110101001{n:08d}' for n in range(1, 30)]
results2, _ = link.resolve(server, many, 'pnu_legal', False)
check('연계(외부 조회 끔): 30개 한 번에, 주소 있음', len(results2) == 30 and results2['1111010100100010000']['output']['address'] == '서울특별시 종로구 청운동 1')

# 6) 화면: 두 플러그인을 가짜 iface로 등록하고 대화상자 생성
from qgis.PyQt.QtWidgets import QMainWindow  # noqa: E402


class Iface:
    def __init__(self):
        self.window, self.menus = QMainWindow(), []

    def mainWindow(self):
        return self.window

    def addPluginToWebMenu(self, menu, action):
        self.menus.append((menu, action.text()))

    def addWebToolBarIcon(self, action):
        pass

    def removePluginWebMenu(self, menu, action):
        pass

    def removeWebToolBarIcon(self, action):
        pass


import geo_address_link  # noqa: E402
import geo_web_bridge  # noqa: E402

iface = Iface()
QgsProject.instance().addMapLayers([points, table])
for package in (geo_web_bridge, geo_address_link):
    plugin = package.classFactory(iface)
    plugin.initGui()
    plugin.run()
    check(f'{package.__name__}: 메뉴 등록·대화상자', plugin.dialog is not None and plugin.dialog.isVisible())
    plugin.unload()
print('메뉴:', iface.menus)
print('실패:', failed)
# QGIS 종료 처리(exitQgis)는 화면 없는 실행에서 0이 아닌 코드로 끝날 수 있다 → 결과를 낸 뒤 바로 끝낸다
sys.stdout.flush()
os._exit(1 if failed else 0)
