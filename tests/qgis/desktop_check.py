# QGIS 데스크톱(--code)에서 실행 (scripts/test-qgis.ts가 임시 프로필로 띄운다): 두 플러그인을 시작해 웹 메뉴·오른쪽 패널(둘은 탭으로 겹침)을 확인하고
# 결과를 GEO_CHECK_OUT 파일에 쓴 뒤 바로 끝낸다 (QgsApplication.exit는 곧바로 끝나지 않아 os._exit)
# 닫기(패널 X)도 확인: Qt가 부르는 가상 함수에서 난 파이썬 오류는 호출한 쪽으로 오지 않고 sys.excepthook으로 간다
import os
import sys

import qgis.utils
from qgis.utils import iface

out = []
hook_errors = []
sys.excepthook = lambda kind, value, tb: hook_errors.append(f'{kind.__name__}: {value}')
try:
    for name in ('geo_web_bridge', 'geo_address_link'):
        loaded = qgis.utils.loadPlugin(name)
        started = qgis.utils.startPlugin(name)
        out.append(f'{name}: load={loaded} start={started}')
    texts = []
    for action in iface.webMenu().actions():
        texts.append(action.text())
        if action.menu():
            texts += ['  ' + sub.text() for sub in action.menu().actions()]
    out.append('웹 메뉴: ' + ' | '.join(texts))
    from qgis.PyQt.QtCore import Qt

    window, right = iface.mainWindow(), getattr(Qt, 'DockWidgetArea', Qt).RightDockWidgetArea
    docks = {}
    for name in ('geo_web_bridge', 'geo_address_link'):
        plugin = qgis.utils.plugins[name]
        plugin.action.trigger()
        docks[name] = plugin.dock
        out.append(f'{name} 패널: {plugin.dock.windowTitle()} right={window.dockWidgetArea(plugin.dock) == right} visible={plugin.dock.isVisible()} action={plugin.action.isChecked()}')
    out.append(f'패널 탭: {len(window.tabifiedDockWidgets(docks["geo_address_link"]))}')
    for name, dock in docks.items():
        dock.close()
        out.append(f'{name} 닫기: closed={not dock.isVisible()} action={qgis.utils.plugins[name].action.isChecked()} errors={len(hook_errors)}' + (' ' + ' / '.join(hook_errors) if hook_errors else ''))
except Exception as error:  # noqa: BLE001
    import traceback

    out.append('오류: ' + traceback.format_exc())
with open(os.environ['GEO_CHECK_OUT'], 'w', encoding='utf-8') as file:
    file.write('\n'.join(out))
os._exit(0)
