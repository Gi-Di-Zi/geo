# 변환 흐름 (화면 없음 → 시험 가능): 레이어 내보내기 → 서버 변환(POST /api/jobs) → 진행 확인(/info) → 내려받기·압축 풀기 → QGIS 레이어
# 2D만: 벡터는 GeoPackage, 래스터는 GeoTIFF로 보낸다. 레이어의 좌표계가 파일에 들어가므로 서버에서 좌표계를 고를 일이 없다
import os
import re
import time
import zipfile

from qgis.core import (QgsDataSourceUri, QgsProject, QgsRasterFileWriter, QgsRasterLayer, QgsRasterPipe,
                       QgsVectorFileWriter, QgsVectorLayer, QgsVectorTileLayer)
from qgis.PyQt.QtCore import QUrl

from .client import ServerError, download, get_json, post_file

UPLOAD_LIMIT = 200 * 1024 ** 2
VIEWERS = [('auto', '자동 추천'), ('ol', 'OpenLayers'), ('maplibre', 'MapLibre GL JS'), ('deck', 'Deck.gl'), ('cesium', 'CesiumJS')]
PRIORITIES = [('balanced', '일반적인 사용'), ('fast_preview', '빠른 미리보기'), ('large_data', '대용량 웹 표출'), ('fidelity', '원본 정보 보존')]
FORMS = [('files', '결과 파일 + 적용 코드'), ('html', '바로 열리는 HTML 지도')]


def code(value):
    """QGIS 열거형 → 정수 (PyQt6은 열거형이 정수와 비교되지 않는다)"""
    return int(getattr(value, "value", value))


def safe_name(text):
    """파일 이름에 못 쓰는 글자만 바꾼다 (한글 유지)"""
    return re.sub(r'[\\/:*?"<>|\s]+', '_', text).strip('_') or 'layer'


def export_layer(layer, folder, selected_only=False):
    """레이어 → 서버에 올릴 파일과 형식 id. 벡터 = GeoPackage(속성·좌표계 그대로), 래스터 = 원본 GeoTIFF 또는 GeoTIFF로 쓰기"""
    name = safe_name(layer.name())
    if isinstance(layer, QgsVectorLayer):
        if not layer.isSpatial():
            raise ServerError('도형이 없는 표입니다. 주소·코드 연계 플러그인을 쓰세요.')
        path = os.path.join(folder, f'{name}.gpkg')
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = 'GPKG'
        options.layerName = name
        options.fileEncoding = 'UTF-8'
        options.onlySelectedFeatures = selected_only
        result = QgsVectorFileWriter.writeAsVectorFormatV3(layer, path, QgsProject.instance().transformContext(), options)
        if code(result[0]) != 0:
            raise ServerError(f'레이어를 GeoPackage로 내보내지 못함: {result[1]}')
        return path, 'vector-2d/gpkg'
    if isinstance(layer, QgsRasterLayer):
        source = layer.source().split('|')[0]
        if layer.providerType() == 'gdal' and os.path.isfile(source) and source.lower().endswith(('.tif', '.tiff')):
            return source, 'raster/tif'
        path = os.path.join(folder, f'{name}.tif')
        provider = layer.dataProvider()
        pipe = QgsRasterPipe()
        pipe.set(provider.clone())
        writer = QgsRasterFileWriter(path)
        if code(writer.writeRaster(pipe, provider.xSize(), provider.ySize(), provider.extent(), provider.crs())) != 0:
            raise ServerError('래스터를 GeoTIFF로 내보내지 못함')
        return path, 'raster/tif'
    raise ServerError('벡터·래스터 레이어만 변환할 수 있습니다.')


def convert(server, path, fmt, intent, out_dir, report=lambda text, percent=None: None, canceled=lambda: False):
    """변환 → 결과 폴더. intent = viewer·priority·form. 돌려줌: 결과 요약(info), 결과 폴더, 데이터 폴더(레이어 불러올 기준)"""
    server = server.rstrip('/')
    size = os.path.getsize(path)
    if size > UPLOAD_LIMIT:
        raise ServerError(f'파일이 {size / 1024 ** 2:.0f}MB로 서버 한도(200MB)를 넘습니다. 범위·피처를 줄이거나 직접 설치한 서버를 쓰세요.')
    fields = {'format': fmt, 'priority': intent.get('priority', 'balanced'), 'delivery': 'file', 'form': intent.get('form', 'files')}
    if intent.get('viewer', 'auto') != 'auto':
        fields['viewer'] = intent['viewer']
    report(f'올리는 중 ({size / 1024 ** 2:.1f}MB)', 2)
    job = post_file(f'{server}/api/jobs', fields, path)['id']
    while True:
        info = get_json(f'{server}/api/jobs/{job}/info')
        progress = info.get('progress') or {}
        if info['state'] == 'failed':
            raise ServerError(f'변환 실패: {info.get("error") or "원인 미상"} (단계 기록: {info["view"].replace("/view?", "/convert?")})')
        if info['state'] == 'done':
            break
        total = progress.get('total') or 1
        report(f'변환 중 {progress.get("done", 0)}/{total} — {progress.get("current") or ""}', 5 + 80 * progress.get('done', 0) / total)
        if canceled():
            raise ServerError('취소함 (서버 작업은 끝까지 진행됩니다)')
        time.sleep(2)
    if info.get('problems'):
        raise ServerError('변환은 끝났지만 결과 확인 실패: ' + ' / '.join(info['problems']))
    stem = safe_name(os.path.splitext(os.path.basename(path))[0])
    os.makedirs(out_dir, exist_ok=True)
    if intent.get('form') == 'html' and info.get('site'):
        report('HTML 지도 받는 중', 90)
        archive = download(info['site'], os.path.join(out_dir, f'{stem}-map.zip'))
        with zipfile.ZipFile(archive) as z:
            top = z.namelist()[0].split('/')[0]
            z.extractall(out_dir)
        folder = os.path.join(out_dir, top)
        return info, folder, os.path.join(folder, 'data')
    primary = info.get('primary') or next((o for o in info.get('outputs', []) if o.get('download')), None)
    if not primary or not primary.get('download'):
        raise ServerError('내려받을 파일 결과가 없습니다.')
    report('결과 받는 중', 90)
    folder = os.path.join(out_dir, f'{stem}-{primary["id"]}')
    os.makedirs(folder, exist_ok=True)
    relative = output_path(primary)
    if primary.get('zip'):
        archive = download(primary['download'], os.path.join(out_dir, primary['file']))
        with zipfile.ZipFile(archive) as z:
            z.extractall(folder)
    else:
        target = os.path.join(folder, relative)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        download(primary['download'], target)
    return info, folder, folder


def output_path(o):
    """결과의 출력 폴더 기준 경로 (리소스 URL의 /files/ 뒤)"""
    return o['url'].split('/files/', 1)[1]


def tiles_uri(path, o):
    """타일 폴더({z}/{x}/{y}) → QGIS XYZ 데이터 소스 (QGIS가 쓰는 인코딩 그대로)"""
    uri = QgsDataSourceUri()
    uri.setParam('type', 'xyz')
    uri.setParam('url', QUrl.fromLocalFile(path.split('{z}')[0]).toString() + '{z}/{x}/{y}' + os.path.splitext(path)[1])
    uri.setParam('zmin', str(o.get('minzoom') or 0))
    uri.setParam('zmax', str(o.get('maxzoom') or 14))
    return bytes(uri.encodedUri()).decode()


def result_layer(o, base, name):
    """내려받은 결과 → QGIS 레이어 (GeoJSON·MVT 폴더·COG·XYZ 타일 폴더). 못 여는 결과(PMTiles·이미지 한 장)는 None"""
    path = os.path.join(base, output_path(o))
    if o['kind'] == 'geojson':
        layer = QgsVectorLayer(path, name, 'ogr')
    elif o['kind'] == 'mvt':
        layer = QgsVectorTileLayer(tiles_uri(path, o), name)
    elif o['kind'] == 'cog':
        layer = QgsRasterLayer(path, name)
    elif o['kind'] == 'xyz-raster':
        layer = QgsRasterLayer(tiles_uri(path, o), name, 'wms')
    else:
        return None
    return layer if layer.isValid() else None
