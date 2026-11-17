# 패널 공통 조각. 두 플러그인이 따로 설치되므로 같은 파일을 둘 다 가진다 (qgis/*/ui.py — 고칠 때 함께, 시험이 같은지 본다)
# 모양은 QGIS 기본 위젯 그대로 두고 꾸밈 색을 쓰지 않는다 (QGIS 테마·밝음·어두움을 따른다).
# 상태·진행은 QGIS 지도 위 메시지 줄 (다른 플러그인·처리 도구와 같은 자리), 버튼은 QGIS 테마 아이콘
from qgis.core import Qgis, QgsApplication, QgsTask
from qgis.gui import QgsMessageBar
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QPalette
from qgis.PyQt.QtWidgets import QComboBox, QFrame, QLabel, QProgressBar, QPushButton, QScrollArea

CAN_CANCEL = QgsTask.Flag.CanCancel if hasattr(QgsTask, 'Flag') else QgsTask.CanCancel
# 상태 종류 → QGIS 메시지 수준
LEVELS = {'info': 'Info', 'ok': 'Success', 'warn': 'Warning', 'error': 'Critical'}


def enum(cls, group, name):
    """Qt5·Qt6 공통 열거값 (Qt6은 cls.Group.Name)"""
    return getattr(getattr(cls, group, cls), name)


def narrow(combo):
    """좁은 패널: 콤보가 가장 긴 항목만큼 넓어지지 않게 (전체 이름은 펼친 목록에)"""
    combo.setSizeAdjustPolicy(enum(QComboBox, 'SizeAdjustPolicy', 'AdjustToMinimumContentsLengthWithIcon'))
    combo.setMinimumContentsLength(8)


def button(text, icon=None):
    """버튼. icon = QGIS 테마 아이콘 이름('/mActionStart.svg')"""
    widget = QPushButton(text)
    if icon:
        widget.setIcon(QgsApplication.getThemeIcon(icon))
    return widget


def note(text=''):
    """흐린 작은 글씨 (기준자료 시각 등)"""
    label = QLabel(text)
    label.setWordWrap(True)
    # 테마 글자색을 옅게 (QGIS 팔레트는 PlaceholderText가 비어 있어 투명하게 나온다)
    palette = label.palette()
    color = palette.color(enum(QPalette, 'ColorRole', 'WindowText'))
    color.setAlpha(160)
    palette.setColor(enum(QPalette, 'ColorRole', 'WindowText'), color)
    label.setPalette(palette)
    font = label.font()
    font.setPointSizeF(font.pointSizeF() * 0.9)
    label.setFont(font)
    return label


def dock_body(content):
    """도킹 패널 안: 스크롤되는 내용 (가로 스크롤 없이 패널 폭에 맞춘다)"""
    scroll = QScrollArea()
    scroll.setWidgetResizable(True)
    scroll.setFrameShape(enum(QFrame, 'Shape', 'NoFrame'))
    scroll.setHorizontalScrollBarPolicy(enum(Qt, 'ScrollBarPolicy', 'ScrollBarAlwaysOff'))
    scroll.setWidget(content)
    return scroll


class Status:
    """QGIS 지도 위 메시지 줄(iface.messageBar())에 이 패널의 메시지 한 줄 (좁은 패널보다 넓어 긴 결과도 읽힌다).
    일하는 동안은 진행 막대·취소, 끝나면 결과(닫을 때까지). 다른 메시지는 건드리지 않고 이 패널이 올린 줄만 바꾼다"""

    def __init__(self, bar, title):
        self.bar, self.title = bar, title
        self.tone, self.last, self.item, self.progress = 'info', '', None, None

    def clear(self):
        if self.item is not None:
            try:
                self.bar.popWidget(self.item)
            except RuntimeError:  # 사용자가 이미 닫음
                pass
        self.item = self.progress = None

    def say(self, text, tone='info'):
        self.clear()
        self.tone, self.last = tone, text
        self.item = self.bar.pushWidget(QgsMessageBar.createMessage(self.title, text), enum(Qgis, 'MessageLevel', LEVELS[tone]))

    def text(self):
        return self.last

    def working(self, text, cancel):
        self.clear()
        self.tone, self.last = 'info', text
        item = QgsMessageBar.createMessage(self.title, text)
        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.progress.setMaximumWidth(240)
        stop = button('취소')
        stop.clicked.connect(cancel)
        item.layout().addWidget(self.progress)
        item.layout().addWidget(stop)
        self.item = self.bar.pushWidget(item, enum(Qgis, 'MessageLevel', 'Info'))

    def step(self, text, percent):
        if self.item is None:
            return
        self.last = text
        try:
            self.item.setText(text)
            self.progress.setValue(int(percent))
        except RuntimeError:  # 사용자가 진행 줄을 닫음 (작업은 계속, QGIS 아래 작업 목록에 남는다)
            self.item = self.progress = None


class Job(QgsTask):
    """화면 밖에서 도는 일 하나 (서버 호출·내려받기). work(report, canceled) → 결과. QGIS 아래 상태 표시줄 작업 목록에도 나온다"""

    def __init__(self, title, work):
        super().__init__(title, CAN_CANCEL)
        self.work, self.message, self.result, self.error = work, '', None, None

    def run(self):
        try:
            self.result = self.work(self.report, self.isCanceled)
            return True
        except Exception as error:
            self.error = str(error)
            return False

    def report(self, text, percent=None):
        self.message = text
        if percent is not None:
            self.setProgress(percent)
