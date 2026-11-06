# QGIS 데스크톱(--code)에서 실행 (scripts/test-qgis.ts가 임시 프로필로 띄운다): 두 플러그인을 시작해 웹 메뉴·대화상자를 확인하고
# 결과를 GEO_CHECK_OUT 파일에 쓴 뒤 바로 끝낸다 (QgsApplication.exit는 곧바로 끝나지 않아 os._exit)
import os

import qgis.utils
from qgis.utils import iface

out = []
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
    for name in ('geo_web_bridge', 'geo_address_link'):
        plugin = qgis.utils.plugins[name]
        plugin.run()
        out.append(f'{name} 대화상자: {plugin.dialog.windowTitle()} visible={plugin.dialog.isVisible()}')
        plugin.dialog.close()
except Exception as error:  # noqa: BLE001
    import traceback

    out.append('오류: ' + traceback.format_exc())
with open(os.environ['GEO_CHECK_OUT'], 'w', encoding='utf-8') as file:
    file.write('\n'.join(out))
os._exit(0)
