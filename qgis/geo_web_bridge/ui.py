# 패널 공통 화면 조각. 두 플러그인이 따로 설치되므로 같은 파일을 둘 다 가진다 (qgis/*/ui.py — 고칠 때 함께, 시험이 같은지 본다)
# QGIS 테마(밝음·어두움)를 따르도록 색은 강조색·상태색만 쓰고 나머지는 기본 모양 그대로
from qgis.core import QgsApplication, QgsTask
from qgis.gui import QgsCollapsibleGroupBox
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QComboBox, QHBoxLayout, QLabel, QProgressBar, QPushButton, QWidget

ACCENT = '#1D5BD6'
GUIDE = 'https://geospatial.kro.kr/qgis'
ISSUES = 'https://github.com/Gi-Di-Zi/geo/issues'
CAN_CANCEL = QgsTask.Flag.CanCancel if hasattr(QgsTask, 'Flag') else QgsTask.CanCancel
# 상태 한 줄의 왼쪽 막대·옅은 바탕 (r, g, b)
TONES = {'info': '29, 91, 214', 'ok': '31, 122, 68', 'warn': '178, 107, 0', 'error': '192, 57, 43'}


def enum(cls, group, name):
    """Qt5·Qt6 공통 열거값 (Qt6은 cls.Group.Name)"""
    return getattr(getattr(cls, group, cls), name)


def narrow(combo):
    """좁은 패널: 콤보가 가장 긴 항목만큼 넓어지지 않게 (전체 이름은 펼친 목록에)"""
    combo.setSizeAdjustPolicy(enum(QComboBox, 'SizeAdjustPolicy', 'AdjustToMinimumContentsLengthWithIcon'))
    combo.setMinimumContentsLength(8)


def button(text, icon=None, primary=False):
    """버튼. icon = QGIS 테마 아이콘 이름('/mActionStart.svg'), primary = 강조색 주 버튼"""
    widget = QPushButton(text)
    if icon:
        widget.setIcon(QgsApplication.getThemeIcon(icon))
    if primary:
        widget.setMinimumHeight(32)
        widget.setStyleSheet(f'QPushButton {{ background: {ACCENT}; color: white; font-weight: bold; border: 0; border-radius: 4px; padding: 5px 14px; }}'
                             ' QPushButton:hover { background: #174BB0; } QPushButton:disabled { background: palette(mid); color: palette(window); }')
    return widget


def header(icon_path, title, text):
    """패널 맨 위: 플러그인 아이콘 + 제목 + 한 줄 설명"""
    box = QWidget()
    row = QHBoxLayout(box)
    row.setContentsMargins(2, 2, 2, 6)
    image = QLabel()
    image.setPixmap(QIcon(icon_path).pixmap(30, 30))
    row.addWidget(image, 0, enum(Qt, 'AlignmentFlag', 'AlignTop'))
    words = QLabel(f'<span style="font-size:12pt; font-weight:600">{title}</span><br>{text}')
    words.setWordWrap(True)
    row.addWidget(words, 1)
    return box


def section(title, layout, collapsed=False):
    """묶음 (QGIS 접이식 상자, 제목은 굵게)"""
    box = QgsCollapsibleGroupBox(title)
    box.setLayout(layout)
    box.setCollapsed(collapsed)
    return box


def progress(bar, cancel):
    """진행 막대 + 취소 (일하는 동안만 보인다)"""
    row = QWidget()
    line = QHBoxLayout(row)
    line.setContentsMargins(0, 0, 0, 0)
    line.addWidget(bar, 1)
    line.addWidget(cancel)
    row.hide()
    return row


def bar():
    widget = QProgressBar()
    widget.setRange(0, 100)
    widget.setTextVisible(False)
    widget.setMaximumHeight(10)
    return widget


def footer():
    note = QLabel(f'<a href="{GUIDE}">사용 안내</a> · <a href="{ISSUES}">문제 알리기</a> · 개발 중 실험 버전')
    note.setOpenExternalLinks(True)
    note.setWordWrap(True)
    return note


class Message(QLabel):
    """상태 한 줄: 종류(info·ok·warn·error)에 따라 왼쪽 색 막대와 옅은 바탕"""

    def __init__(self, text=''):
        super().__init__()
        self.setWordWrap(True)
        self.setTextInteractionFlags(enum(Qt, 'TextInteractionFlag', 'TextSelectableByMouse'))
        self.tone = 'info'
        self.say(text)

    def say(self, text, tone='info'):
        self.tone = tone
        rgb = TONES[tone]
        self.setStyleSheet(f'QLabel {{ border-left: 3px solid rgb({rgb}); background: rgba({rgb}, 0.08); padding: 6px 8px; }}')
        self.setText(text)


class Job(QgsTask):
    """화면 밖에서 도는 일 하나 (서버 호출·내려받기). work(report, canceled) → 결과"""

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
