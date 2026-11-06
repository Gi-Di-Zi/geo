# QGIS 웹 메뉴·도구 모음에 "웹 지도로 변환…"
import os

from qgis.PyQt.QtGui import QIcon

try:
    from qgis.PyQt.QtGui import QAction  # Qt6 (QGIS 4)
except ImportError:
    from qgis.PyQt.QtWidgets import QAction  # Qt5 (QGIS 3)

MENU = 'geo-web-bridge'


class Plugin:
    def __init__(self, iface):
        self.iface, self.action, self.dialog = iface, None, None

    def initGui(self):
        self.action = QAction(QIcon(os.path.join(os.path.dirname(__file__), 'icon.svg')), '웹 지도로 변환…', self.iface.mainWindow())
        self.action.triggered.connect(self.run)
        self.iface.addPluginToWebMenu(MENU, self.action)
        self.iface.addWebToolBarIcon(self.action)

    def unload(self):
        self.iface.removePluginWebMenu(MENU, self.action)
        self.iface.removeWebToolBarIcon(self.action)

    def run(self):
        from .dialog import Dialog

        if self.dialog is None:
            self.dialog = Dialog(self.iface)
        self.dialog.show()
        self.dialog.raise_()
