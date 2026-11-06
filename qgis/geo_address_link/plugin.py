# QGIS 웹 메뉴·도구 모음의 "주소·코드 연계" → 오른쪽 패널 (다른 geo-web-bridge 패널이 있으면 같은 자리에 탭으로)
import os

from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QDockWidget

try:
    from qgis.PyQt.QtGui import QAction  # Qt6 (QGIS 4)
except ImportError:
    from qgis.PyQt.QtWidgets import QAction  # Qt5 (QGIS 3)

MENU = 'geo-web-bridge'
RIGHT = getattr(Qt, 'DockWidgetArea', Qt).RightDockWidgetArea
PANELS = ('geo_web_bridge_panel', 'geo_address_link_panel')


class Plugin:
    def __init__(self, iface):
        self.iface, self.action, self.dock = iface, None, None

    def initGui(self):
        self.action = QAction(QIcon(os.path.join(os.path.dirname(__file__), 'icon.svg')), '주소·코드 연계', self.iface.mainWindow())
        self.action.setCheckable(True)
        self.action.triggered.connect(self.run)
        self.iface.addPluginToWebMenu(MENU, self.action)
        self.iface.addWebToolBarIcon(self.action)

    def unload(self):
        self.iface.removePluginWebMenu(MENU, self.action)
        self.iface.removeWebToolBarIcon(self.action)
        if self.dock is not None:
            self.iface.removeDockWidget(self.dock)
            self.dock.deleteLater()
            self.dock = None

    def run(self):
        """처음 누르면 패널을 만들어 오른쪽에 붙인다. 그 뒤로는 메뉴·버튼이 패널 보이기·숨기기 (QgsDockWidget이 맞춘다)"""
        if self.dock is not None:
            return
        from .panel import Panel

        self.dock = Panel(self.iface)
        self.iface.addDockWidget(RIGHT, self.dock)
        window = self.iface.mainWindow()
        sibling = next((d for d in window.findChildren(QDockWidget) if d is not self.dock and d.objectName() in PANELS and window.dockWidgetArea(d) == RIGHT), None)
        if sibling is not None:
            window.tabifyDockWidget(sibling, self.dock)
        self.dock.setToggleVisibilityAction(self.action)
        self.dock.setUserVisible(True)
