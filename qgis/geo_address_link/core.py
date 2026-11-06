# 주소·코드 연계 흐름 (화면 없음 → 시험 가능): 열 값 목록 → 서버 변환(POST /api/link/resolve, target=all) → 값마다 결과 → 새 레이어
# 같은 값은 한 번만 묻는다. 코드는 문자열 열로 (앞자리 0·19자리 PNU가 숫자로 바뀌어 깨지지 않게)
from qgis.core import QgsFeature, QgsGeometry, QgsPointXY, QgsVectorLayer, QgsWkbTypes

from .client import ServerError, post_json

INPUT_TYPES = [('auto', '자동 판별 (줄마다)'), ('pnu_legal', 'PNU·법정동코드'), ('administrative', '행정동코드'), ('address', '주소 (지번·도로명)')]

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
    ('g_lon', '경도', 'x', 'double'),
    ('g_lat', '위도', 'y', 'double'),
    ('g_note', '확인 사항', 'note', 'string(500)'),
]
# 화면의 결과 묶음 → 열 이름. 처리 상태·확인 사항은 항상
GROUPS = [
    ('주소·PNU', ['g_addr', 'g_pnu']),
    ('법정동', ['g_bjd_cd', 'g_bjd_nm']),
    ('단계별 코드 (시도·시군구·읍면동·리)', ['g_sido_cd', 'g_sido_nm', 'g_sgg_cd', 'g_sgg_nm', 'g_emd_cd', 'g_emd_nm', 'g_ri_cd', 'g_ri_nm']),
    ('행정동', ['g_hjd_cd', 'g_hjd_nm']),
    ('우편번호·위치 (외부 조회)', ['g_zip', 'g_lon', 'g_lat']),
]
ALWAYS = ['g_status', 'g_note']
# 결과 경고 중 사용자가 알아야 하는 것 (해석을 바꾼 경우)
NOTICE = ('옛 시도명', '입력에 없는', '폐지 코드', '도로명주소', '역조회한 행정동')


def resolve(server, values, input_type='auto', lookups=True, report=lambda text, percent=None: None, canceled=lambda: False):
    """값 목록 → {값: 결과 행}. 외부 조회(위치·우편번호·도로명주소)를 하면 20줄씩, 끄면 200줄씩. 하루 한도(429)면 그때까지의 결과를 돌려준다"""
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
        body = {'rows': [{'id': str(i), 'original': {}, 'value': v} for i, v in enumerate(part)], 'options': {'target': 'all', 'inputType': input_type, 'lookups': lookups}}
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
    return out


def new_fields(names):
    """열 정의 → QgsField (메모리 레이어로 만들어 QGIS 3·4 어느 쪽 형식이든 그대로)"""
    picked = [f for f in FIELDS if f[0] in names]
    probe = QgsVectorLayer('None?' + '&'.join(f'field={name}:{kind}' for name, _, _, kind in picked), 'probe', 'memory')
    return [(probe.fields().field(name), alias, key) for name, alias, key, _ in picked]


def build_layers(layer, items, results, names, points=False):
    """원본 레이어 + 결과 열 → 새 메모리 레이어. points면 위치(경도·위도)로 점 레이어도. items = [(원본 피처, 값)]"""
    columns = new_fields(names)

    def make(uri, title):
        target = QgsVectorLayer(uri, title, 'memory')
        provider = target.dataProvider()
        provider.addAttributes(layer.fields().toList() + [field for field, _, _ in columns])
        target.updateFields()
        for field, alias, _ in columns:
            target.setFieldAlias(target.fields().indexOf(field.name()), alias)
        return target

    geometry = QgsWkbTypes.displayString(layer.wkbType()) if layer.isSpatial() else 'None'
    same = make(f'{geometry}?crs={layer.crs().authid()}' if layer.isSpatial() else 'None', f'{layer.name()} (주소·코드)')
    dots = make('Point?crs=EPSG:4326', f'{layer.name()} (주소·코드 위치)') if points else None
    rows, dot_rows = [], []
    for feature, value in items:
        values = row_values(results.get(value)) if value else {'status': 'empty', 'note': '값 없음'}
        attributes = list(feature.attributes()) + [values.get(key) for _, _, key in columns]
        copy = QgsFeature(same.fields())
        copy.setAttributes(attributes)
        if layer.isSpatial():
            copy.setGeometry(feature.geometry())
        rows.append(copy)
        if dots is not None and values.get('x') is not None and values.get('y') is not None:
            dot = QgsFeature(dots.fields())
            dot.setAttributes(attributes)
            dot.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(values['x'], values['y'])))
            dot_rows.append(dot)
    same.dataProvider().addFeatures(rows)
    if dots is not None:
        dots.dataProvider().addFeatures(dot_rows)
    return same, dots
