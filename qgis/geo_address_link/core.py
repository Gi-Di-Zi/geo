# 주소·코드 연계 흐름 (화면 없음 → 시험 가능): 열 값 목록 → 서버 변환(POST /api/link/resolve, target=all) → 값마다 결과 → 원본 속성 표에 열(편집 모드) 또는 새 레이어
# 같은 값은 한 번만 묻는다. 코드는 문자열 열로 (앞자리 0·19자리 PNU가 숫자로 바뀌어 깨지지 않게)
# 직접 검색(레이어 없이): 줄 목록 → 같은 변환, 결과는 패널에 보이고 원하면 점·필지 레이어로
import json
import re

from osgeo import ogr
from qgis.core import (Qgis, QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsFeature, QgsGeometry, QgsPointXY, QgsProject, QgsVectorDataProvider,
                       QgsVectorLayer, QgsWkbTypes)

from .client import ServerError, get_json, post_json

SEARCH_LIMIT = 20
# 직접 검색의 좌표 줄: "경도, 위도" (EPSG:4326, 소수점 필수 → 코드와 헷갈리지 않게)
COORDINATE = re.compile(r'^\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,2}\.\d+\s*$')
STATUS = {'ok': '정상', 'needs_selection': '후보 선택 필요', 'invalid': '형식 오류', 'not_found': '찾지 못함', 'unavailable': '이용 불가', 'empty': '값 없음', 'skipped': '처리 안 함'}
INPUT_TYPES = [('auto', '자동 판별 (줄마다)'), ('pnu_legal', 'PNU·법정동코드'), ('administrative', '행정동코드'), ('address', '주소 (지번·도로명)'), ('geometry', '도형 위치 → 그 지점의 필지 (열 대신)')]

# (열 이름 ≤ 10자: Shapefile로 저장해도 유지, 별칭, 결과 키, 종류)
FIELDS = [
    ('g_status', '처리 상태', 'status', 'string(20)'),
    ('g_addr', '주소(지번)', 'address', 'string(200)'),
    ('g_pnu', 'PNU', 'pnu', 'string(19)'),
    ('g_bjd_cd', '법정동코드', 'legal_code', 'string(10)'),
    ('g_bjd_nm', '법정동', 'legal_name', 'string(100)'),
    ('g_sido_cd', '시도 코드', 'sido_code', 'string(10)'),
    ('g_sido_nm', '시도', 'sido_name', 'string(30)'),
    ('g_sgg_cd', '시군구 코드', 'sigungu_code', 'string(10)'),
    ('g_sgg_nm', '시군구', 'sigungu_name', 'string(30)'),
    ('g_emd_cd', '읍면동 코드', 'eupmyeondong_code', 'string(10)'),
    ('g_emd_nm', '읍면동', 'eupmyeondong_name', 'string(30)'),
    ('g_ri_cd', '리 코드', 'ri_code', 'string(10)'),
    ('g_ri_nm', '리', 'ri_name', 'string(30)'),
    ('g_hjd_cd', '행정동코드', 'administrative_code', 'string(10)'),
    ('g_hjd_nm', '행정동', 'administrative_name', 'string(100)'),
    ('g_zip', '우편번호', 'postcode', 'string(5)'),
    ('g_road', '도로명주소', 'road_address', 'string(254)'),
    ('g_bld', '건물 유무', 'building', 'string(4)'),
    ('g_bld_n', '건물 수', 'building_count', 'integer(10)'),  # 폭 없이면 255라 Shapefile이 열을 거부
    ('g_bld_nm', '건물 이름', 'building_names', 'string(254)'),
    ('g_parcel', '필지 실재', 'parcel_exists', 'string(4)'),
    ('g_jimok', '지목', 'jimok', 'string(10)'),
    ('g_area', '토지 면적(㎡)', 'land_area', 'double'),
    ('g_zone', '용도지역', 'land_zone', 'string(100)'),
    ('g_use', '이용상황', 'land_use', 'string(50)'),
    ('g_price', '공시지가(원/㎡)', 'land_price', 'double'),
    ('g_lyear', '토지 기준연도', 'land_year', 'string(4)'),
    ('g_lon', '경도', 'x', 'double'),
    ('g_lat', '위도', 'y', 'double'),
    ('g_note', '확인 사항', 'note', 'string(500)'),
]
# 화면의 결과 묶음 → 열 이름, 외부 조회가 필요한지. 처리 상태·확인 사항은 항상
GROUPS = [
    ('주소·PNU', ['g_addr', 'g_pnu'], False),
    ('법정동', ['g_bjd_cd', 'g_bjd_nm'], False),
    ('시도·시군구·읍면동·리', ['g_sido_cd', 'g_sido_nm', 'g_sgg_cd', 'g_sgg_nm', 'g_emd_cd', 'g_emd_nm', 'g_ri_cd', 'g_ri_nm'], False),
    ('행정동', ['g_hjd_cd', 'g_hjd_nm'], False),
    ('우편번호·위치', ['g_zip', 'g_lon', 'g_lat'], True),
    ('도로명주소·건물', ['g_road', 'g_bld', 'g_bld_n', 'g_bld_nm'], True),
    ('필지·토지 속성', ['g_parcel', 'g_jimok', 'g_area', 'g_zone', 'g_use', 'g_price', 'g_lyear'], True),
]
# 필지 단위 결과(서버 options.details): 이 열 중 하나라도 고르면 묻는다 (필지마다 원천 3번 더)
DETAIL_FIELDS = {'g_road', 'g_bld', 'g_bld_n', 'g_bld_nm', 'g_parcel', 'g_jimok', 'g_area', 'g_zone', 'g_use', 'g_price', 'g_lyear'}
ALWAYS = ['g_status', 'g_note']
# 결과 경고 중 사용자가 알아야 하는 것 (해석을 바꾼 경우)
NOTICE = ('옛 시도명', '입력에 없는', '폐지 코드', '도로명주소', '역조회한 행정동', '좌표가 들어 있는')


def geometry_value(feature, transform):
    """피처 도형 → '경도, 위도' (EPSG:4326). 면·선은 도형 안쪽의 한 점. 도형이 없으면 빈 값"""
    geometry = feature.geometry()
    if geometry is None or geometry.isEmpty():
        return ''
    point = transform.transform(geometry.pointOnSurface().asPoint())
    return f'{point.x():.7f}, {point.y():.7f}'


def wgs84(layer):
    """레이어 좌표계 → EPSG:4326 변환"""
    return QgsCoordinateTransform(layer.crs(), QgsCoordinateReferenceSystem('EPSG:4326'), QgsProject.instance())


def resolve(server, values, input_type='auto', lookups=True, report=lambda text, percent=None: None, canceled=lambda: False, details=True):
    """값 목록 → {값: 결과 행}. 외부 조회(위치·우편번호·도로명주소)를 하면 20줄씩, 끄면 200줄씩. details = 필지·건물·토지 속성도.
    하루 한도(429)면 그때까지의 결과를 돌려준다"""
    server = server.rstrip('/')
    unique = list(dict.fromkeys(v for v in values if v))
    size = 20 if lookups else 200
    results, stopped = {}, None
    for start in range(0, len(unique), size):
        if canceled():
            stopped = '취소함'
            break
        part = unique[start:start + size]
        report(f'{start + len(part)}/{len(unique)}개 변환 중', 100 * start / max(len(unique), 1))
        body = {'rows': [{'id': str(i), 'original': {}, 'value': v} for i, v in enumerate(part)], 'options': {'target': 'all', 'inputType': input_type, 'lookups': lookups, 'details': details}}
        try:
            batch = post_json(f'{server}/api/link/resolve', body)
        except ServerError as error:
            if '429' in str(error):
                stopped = str(error)
                break
            raise
        for value, row in zip(part, batch['rows']):
            results[value] = row
    return results, stopped


def reference_status(server):
    """기준자료(법정동·행정동 사전) 상태: lastCheckedAt(마지막 확인)·lastUpdatedAt(마지막 변경). 서버가 하루 한 번 자동으로 확인한다"""
    return get_json(f'{server.rstrip("/")}/api/link/references')


def search(server, lines, lookups=True, report=lambda text, percent=None: None, canceled=lambda: False):
    """직접 검색: 좌표 줄은 그 지점의 필지(location), 나머지는 자동 판별. 외부 조회를 켜면 필지 단위 결과까지. 돌려줌 {줄: 결과 행}"""
    places = [v for v in lines if COORDINATE.match(v)]
    if places and not lookups:
        raise ServerError('좌표로 찾으려면 외부 조회를 켜세요.')
    results = {}
    for values, kind in (([v for v in lines if v not in places], 'auto'), (places, 'location')):
        if values:
            found, stopped = resolve(server, values, kind, lookups, report, canceled, details=lookups)
            if stopped:
                raise ServerError(stopped)
            results.update(found)
    return results


def result_of(results, value):
    """입력 값 하나의 열 값. 빈 값은 묻지 않았으므로 empty"""
    return row_values(results.get(value)) if value else {'status': 'empty', 'note': '값 없음'}


def row_values(row):
    """결과 행 → 열 값 (결과 키 기준)"""
    if row is None:
        return {'status': 'skipped', 'note': '처리하지 않음 (한도·취소)'}
    out = dict(row.get('output') or {})
    notes = list(dict.fromkeys(e['message'] for e in row.get('errors', [])))
    notes += [w for w in dict.fromkeys(row.get('warnings', [])) if w.startswith(NOTICE)]
    candidates = [c['name'] for c in (row.get('conversions') or {}).get('legal_region', {}).get('candidates', [])] \
        or [c['name'] for conv in (row.get('conversions') or {}).values() for c in conv.get('candidates', [])]
    if candidates:
        notes.append('후보: ' + ', '.join(dict.fromkeys(candidates)))
    out['status'] = row.get('status', '')
    out['note'] = ' / '.join(notes)[:500]
    for key in ('x', 'y'):
        try:
            out[key] = float(out[key]) if out.get(key) else None
        except ValueError:
            out[key] = None
    # '6,600㎡'·'11,110,000원/㎡' → 숫자 열 (분석·분류에 쓰게)
    for key in ('land_area', 'land_price'):
        number = re.sub(r'[^\d.]', '', out.get(key) or '')
        out[key] = float(number) if number else None
    out['building_count'] = int(out['building_count']) if (out.get('building_count') or '').isdigit() else None
    out['geometry'] = ((row.get('conversions') or {}).get('parcel') or {}).get('geometry')
    return out


def new_fields(names):
    """열 정의 → QgsField (메모리 레이어로 만들어 QGIS 3·4 어느 쪽 형식이든 그대로)"""
    picked = [f for f in FIELDS if f[0] in names]
    probe = QgsVectorLayer('None?' + '&'.join(f'field={name}:{kind}' for name, _, _, kind in picked), 'probe', 'memory')
    return [(probe.fields().field(name), alias, key) for name, alias, key, _ in picked]


def parcel_geometry(geometry):
    """결과의 필지 경계(GeoJSON 도형, EPSG:4326) → QgsGeometry"""
    shape = ogr.CreateGeometryFromJson(json.dumps(geometry))
    return QgsGeometry.fromWkt(shape.ExportToWkt()) if shape is not None else QgsGeometry()


def writable(layer):
    """원본 속성 표에 열을 더할 수 있는지 (CSV 텍스트·읽기 전용 레이어는 못 한다). QGIS 3.40부터 Qgis.VectorProviderCapability"""
    caps = getattr(Qgis, 'VectorProviderCapability', QgsVectorDataProvider)
    return layer.supportsEditing() and bool(layer.dataProvider().capabilities() & caps.AddAttributes)


def add_columns(layer, items, results, names):
    """원본 레이어의 속성 표에 결과 열을 넣는다. 편집 모드로 넣고 저장하지 않는다 (편집 저장·취소는 사용자가, 실행 취소 한 번에 되돌림).
    결과 열이 이미 있으면(다시 실행) 값만 바꾼다. items = [(원본 피처, 값)]. 돌려줌: 값을 넣은 피처 수"""
    columns = new_fields(names)
    if not layer.isEditable():
        layer.startEditing()
    layer.beginEditCommand('주소·코드 결과 열')
    for field, _, _ in columns:
        if layer.fields().indexOf(field.name()) < 0:
            layer.addAttribute(field)
    index = {key: layer.fields().indexOf(field.name()) for field, _, key in columns}
    for field, alias, key in columns:
        layer.setFieldAlias(index[key], alias)
    done = 0
    for feature, value in items:
        values = result_of(results, value)
        done += layer.changeAttributeValues(feature.id(), {i: values.get(key) for key, i in index.items()})
    layer.endEditCommand()
    return done


def build_layers(layer, items, results, names, points=False, parcels=False, copy=True):
    """원본 레이어 + 결과 열 → 새 메모리 레이어. copy면 같은 모양 레이어, points면 위치(경도·위도)로 점 레이어, parcels면 필지 경계(연속지적도)로 면 레이어.
    items = [(원본 피처, 값)]. 돌려줌: (같은 모양 레이어, 점 레이어, 필지 레이어), 만들지 않은 것은 None"""
    columns = new_fields(names)
    # 다시 실행(결과 열이 이미 있는 레이어)이면 원본의 같은 이름 열은 빼고 새 값으로
    added = {field.name() for field, _, _ in columns}
    fields = layer.fields().toList()
    keep = [i for i, f in enumerate(fields) if f.name() not in added]

    def make(uri, title):
        target = QgsVectorLayer(uri, title, 'memory')
        provider = target.dataProvider()
        provider.addAttributes([fields[i] for i in keep] + [field for field, _, _ in columns])
        target.updateFields()
        for field, alias, _ in columns:
            target.setFieldAlias(target.fields().indexOf(field.name()), alias)
        return target

    geometry = QgsWkbTypes.displayString(layer.wkbType()) if layer.isSpatial() else 'None'
    same = make(f'{geometry}?crs={layer.crs().authid()}' if layer.isSpatial() else 'None', f'{layer.name()} (주소·코드)') if copy else None
    dots = make('Point?crs=EPSG:4326', f'{layer.name()} (주소·코드 위치)') if points else None
    lots = make('MultiPolygon?crs=EPSG:4326', f'{layer.name()} (필지 경계)') if parcels else None
    rows, dot_rows, lot_rows = [], [], []
    for feature, value in items:
        values = result_of(results, value)
        source = feature.attributes()
        attributes = [source[i] for i in keep] + [values.get(key) for _, _, key in columns]
        if same is not None:
            row = QgsFeature(same.fields())
            row.setAttributes(attributes)
            if layer.isSpatial():
                row.setGeometry(feature.geometry())
            rows.append(row)
        if dots is not None and values.get('x') is not None and values.get('y') is not None:
            dot = QgsFeature(dots.fields())
            dot.setAttributes(attributes)
            dot.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(values['x'], values['y'])))
            dot_rows.append(dot)
        if lots is not None and values.get('geometry'):
            lot = QgsFeature(lots.fields())
            lot.setAttributes(attributes)
            lot.setGeometry(parcel_geometry(values['geometry']))
            lot_rows.append(lot)
    if same is not None:
        same.dataProvider().addFeatures(rows)
    if dots is not None:
        dots.dataProvider().addFeatures(dot_rows)
    if lots is not None:
        lots.dataProvider().addFeatures(lot_rows)
    return same, dots, lots
