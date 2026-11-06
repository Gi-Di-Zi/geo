# QGIS 데스크톱(--code)에서 실행 (scripts/test-qgis.ts가 임시 프로필로 띄운다). 결과는 GEO_CHECK_OUT 파일에 쓰고 바로 끝낸다(os._exit).
#  1) 두 플러그인 시작 → 웹 메뉴·오른쪽 패널(탭으로 겹침)·닫기(파이썬 오류 없음)
#  2) 사용 시험: 이 임시 프로필에서만 서버를 시험 서버(GEO_SERVER)로 바꾸고, 사람이 쓰듯 패널을 조작한다
#     웹 지도 변환 = 예시 목록 → 예시 불러오기(FGB·GeoTIFF) → 변환(결과 파일·HTML 지도) → 결과 레이어
#     주소·코드 연계 = 기준자료 시각 → 직접 검색 → 점·필지 레이어 → 지도에서 찍기 → 레이어 값(주소 열·도형 위치) → 새 레이어
#  GEO_SHOT_DIR가 있으면 단계마다 화면을 저장한다. Qt가 부르는 함수에서 난 파이썬 오류는 sys.excepthook으로 모아 실패로 센다
import os
import sys
import tempfile
import time

import qgis.utils
from qgis.core import (QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsFeature, QgsGeometry, QgsPointXY, QgsProject, QgsRasterLayer,
                       QgsSettings, QgsVectorLayer)
from qgis.PyQt.QtCore import QCoreApplication, Qt
from qgis.utils import iface

out, failed, hook_errors = [], [], []
sys.excepthook = lambda kind, value, tb: hook_errors.append(f'{kind.__name__}: {value}')
server, shots = os.environ.get('GEO_SERVER', '').rstrip('/'), os.environ.get('GEO_SHOT_DIR')
PLUGINS = ('geo_web_bridge', 'geo_address_link')


def check(name, ok, detail=''):
    out.append(('OK   ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))
    if not ok:
        failed.append(name)


def wait(until, seconds=180):
    """화면 이벤트를 돌리며 조건을 기다린다 (작업은 QGIS 작업 관리자의 다른 스레드에서)"""
    end = time.time() + seconds
    while time.time() < end:
        QCoreApplication.processEvents()
        if until():
            return True
        time.sleep(0.1)
    return False


def shot(name, widget=None):
    if shots:
        QCoreApplication.processEvents()
        (widget or iface.mainWindow()).grab().save(os.path.join(shots, f'{name}.png'))


def layer_named(prefix):
    return next((layer for layer in QgsProject.instance().mapLayers().values() if layer.name().startswith(prefix)), None)


try:
    if server:
        for name in PLUGINS:
            QgsSettings().setValue(f'{name}/server_override', server)
    for name in PLUGINS:
        out.append(f'{name}: load={qgis.utils.loadPlugin(name)} start={qgis.utils.startPlugin(name)}')
    texts = []
    for action in iface.webMenu().actions():
        texts.append(action.text())
        if action.menu():
            texts += ['  ' + sub.text() for sub in action.menu().actions()]
    out.append('웹 메뉴: ' + ' | '.join(texts))

    window, right = iface.mainWindow(), getattr(Qt, 'DockWidgetArea', Qt).RightDockWidgetArea
    window.resize(1500, 950)
    plugins = {name: qgis.utils.plugins[name] for name in PLUGINS}
    for name, plugin in plugins.items():
        plugin.action.trigger()
        out.append(f'{name} 패널: {plugin.dock.windowTitle()} right={window.dockWidgetArea(plugin.dock) == right} visible={plugin.dock.isVisible()} action={plugin.action.isChecked()}')
    out.append(f'패널 탭: {len(window.tabifiedDockWidgets(plugins["geo_address_link"].dock))}')
    for name, plugin in plugins.items():
        plugin.dock.close()
        out.append(f'{name} 닫기: closed={not plugin.dock.isVisible()} action={plugin.action.isChecked()} errors={len(hook_errors)}' + (' ' + ' / '.join(hook_errors) if hook_errors else ''))

    if server:
        work = tempfile.mkdtemp(prefix='geo-qgis-use-')
        # 웹 지도 변환
        plugins['geo_web_bridge'].action.trigger()
        web = plugins['geo_web_bridge'].dock
        web.raise_()
        web.folder.setFilePath(work)
        check('다시 열기 (메뉴)', web.isVisible())
        check('예시 목록', wait(lambda: web.sample.count() > 5 and web.sample.itemData(0) is not None, 60), f'{web.sample.count()}개')
        shot('1-web-start', web)

        def use_sample(sample_id, ext):
            index = next(i for i in range(web.sample.count()) if (web.sample.itemData(i) or {}).get('id') == sample_id)
            web.sample.setCurrentIndex(index)
            web.load_button.click()
            loaded = wait(lambda: not web.progress.isVisible() and web.layer.currentLayer() is not None and web.layer.currentLayer().name().endswith(f'(예시 {ext})'))
            check(f'예시 {sample_id} 불러오기 → 레이어 선택됨', loaded, web.status.text())

        def convert(viewer, form, label):
            web.viewer.setCurrentIndex(web.viewer.findData(viewer))
            next(b for b in web.forms.buttons() if b.property('form') == form).setChecked(True)
            before = len(QgsProject.instance().mapLayers())
            web.run_button.click()
            done = wait(lambda: not web.progress.isVisible(), 600) and web.status.tone == 'ok'
            check(f'변환 {label}', done and web.result_box.isVisible(), web.status.text())
            return before

        use_sample('vector-2d/fgb', '.fgb')
        before = convert('maplibre', 'files', 'FGB → MapLibre 결과 파일')
        check('결과 레이어 추가', len(QgsProject.instance().mapLayers()) > before and 'maplibre' in web.output.toPlainText().lower(), web.output.toPlainText().split('\n')[0])
        shot('2-web-files')
        convert('ol', 'html', 'FGB → OpenLayers HTML 지도')
        check('HTML 지도 폴더 (index.html)', bool(web.last_folder) and os.path.exists(os.path.join(web.last_folder, 'index.html')), str(web.last_folder))
        use_sample('raster/tif', '.tif')
        before = convert('auto', 'files', 'GeoTIFF → 자동 추천')
        check('래스터 결과 레이어', any(isinstance(layer, QgsRasterLayer) and '·' in layer.name() for layer in QgsProject.instance().mapLayers().values()), web.status.text())
        shot('3-web-raster')

        # 주소·코드 연계
        plugins['geo_address_link'].action.trigger()
        link = plugins['geo_address_link'].dock
        link.raise_()
        check('기준자료 시각', wait(lambda: '마지막 확인' in link.reference.text(), 60), link.reference.text())
        link.query.setPlainText('서울 강남구 테헤란로 152\n1111010100100010000\n중구 태평로1가 31')
        link.search_button.click()
        wait(lambda: not link.progress.isVisible())
        statuses = [link.tree.topLevelItem(i).text(0).split('  —  ')[-1] for i in range(link.tree.topLevelItemCount())]
        check('직접 검색 세 줄 (동명이인은 후보 선택)', statuses == ['정상', '정상', '후보 선택 필요'], str(statuses))
        shot('4-link-search', link)
        link.add_button.click()
        check('검색 결과 → 점·필지 레이어', layer_named('주소·코드 검색 (주소·코드 위치)') is not None and layer_named('주소·코드 검색 (필지 경계)') is not None, link.status.text())

        canvas = iface.mapCanvas()
        link.pick_button.setChecked(True)
        check('지도에서 찍기 도구', canvas.mapTool() is link.picker)
        to_canvas = QgsCoordinateTransform(QgsCoordinateReferenceSystem('EPSG:4326'), canvas.mapSettings().destinationCrs(), QgsProject.instance())
        link.picker.canvasClicked.emit(to_canvas.transform(QgsPointXY(127.03651, 37.50003)), getattr(Qt, 'MouseButton', Qt).LeftButton)
        wait(lambda: not link.progress.isVisible())
        top = link.tree.topLevelItem(0)
        pnu = next((top.child(i).text(1) for i in range(top.childCount()) if top.child(i).text(0) == 'PNU'), '') if top else ''
        check('지도에서 찍기 → 그 지점의 필지', pnu == '1168010100107370000', f'{top and top.text(0)} → {pnu}')
        link.pick_button.setChecked(False)

        table = QgsVectorLayer('None?field=주소:string&field=번호:integer', '시험 주소표', 'memory')
        rows = []
        for i, value in enumerate(['서울 강남구 테헤란로 152', '경기도 부천시 중동 1156', '4211011200101000000', '']):
            feature = QgsFeature(table.fields())
            feature.setAttributes([value, i])
            rows.append(feature)
        table.dataProvider().addFeatures(rows)
        QgsProject.instance().addMapLayer(table)
        link.tabs.setCurrentIndex(1)
        link.layer.setLayer(table)
        link.field.setField('주소')
        link.input_type.setCurrentIndex(link.input_type.findData('auto'))
        link.parcels.setChecked(True)
        link.run_button.click()
        wait(lambda: not link.progress.isVisible())
        result = layer_named('시험 주소표 (주소·코드)')
        pnus = sorted(f['g_pnu'] for f in result.getFeatures() if f['g_pnu']) if result else []
        check('레이어 값(주소 열) → 결과 열 레이어', result is not None and result.featureCount() == 4 and '1168010100107370000' in pnus and '5111011200101000000' in pnus, str(pnus))
        check('레이어 값 → 필지 경계 레이어', layer_named('시험 주소표 (필지 경계)') is not None, link.status.text())
        shot('5-link-layer', link)

        spot = QgsVectorLayer('Point?crs=EPSG:5186&field=이름:string', '시험 측량점', 'memory')
        to5186 = QgsCoordinateTransform(QgsCoordinateReferenceSystem('EPSG:4326'), QgsCoordinateReferenceSystem('EPSG:5186'), QgsProject.instance())
        feature = QgsFeature(spot.fields())
        feature.setAttributes(['점1'])
        feature.setGeometry(QgsGeometry.fromPointXY(to5186.transform(QgsPointXY(127.03651, 37.50003))))
        spot.dataProvider().addFeatures([feature])
        QgsProject.instance().addMapLayer(spot)
        link.layer.setLayer(spot)
        link.input_type.setCurrentIndex(link.input_type.findData('geometry'))
        link.run_button.click()
        wait(lambda: not link.progress.isVisible())
        result = layer_named('시험 측량점 (주소·코드)')
        check('레이어 값(도형 위치, EPSG:5186) → 필지 PNU', result is not None and next(result.getFeatures())['g_pnu'] == '1168010100107370000', link.status.text())
        iface.zoomToActiveLayer()
        shot('6-final')
        check('사용 중 파이썬 오류 없음', not hook_errors, ' / '.join(hook_errors))
        out.append('사용 시험 끝')
except Exception:  # noqa: BLE001
    import traceback

    out.append('오류: ' + traceback.format_exc())
with open(os.environ['GEO_CHECK_OUT'], 'w', encoding='utf-8') as file:
    file.write('\n'.join(out))
os._exit(0)
