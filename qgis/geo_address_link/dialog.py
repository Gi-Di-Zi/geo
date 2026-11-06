# 연계 화면: 레이어·값 열·입력 종류·붙일 결과 → 백그라운드 작업(QgsTask)으로 변환 → 결과 열을 붙인 새 레이어 (원본은 바꾸지 않음)
from qgis.core import Qgis, QgsApplication, QgsMapLayerProxyModel, QgsProject, QgsSettings, QgsTask
from qgis.gui import QgsFieldComboBox, QgsMapLayerComboBox
from qgis.PyQt.QtWidgets import QCheckBox, QComboBox, QDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QProgressBar, QPushButton, QVBoxLayout

from .core import ALWAYS, GROUPS, INPUT_TYPES, build_layers, resolve

SETTINGS = 'geo_address_link'
DEFAULT_SERVER = 'https://geospatial.kro.kr'
DAILY = 2000
# 도형 없는 표도 (QGIS 3.34부터 Qgis.LayerFilter)
LAYERS = Qgis.LayerFilter.VectorLayer if hasattr(Qgis, 'LayerFilter') else QgsMapLayerProxyModel.VectorLayer
CAN_CANCEL = QgsTask.Flag.CanCancel if hasattr(QgsTask, 'Flag') else QgsTask.CanCancel


class LinkTask(QgsTask):
    def __init__(self, server, values, input_type, lookups):
        super().__init__('주소·코드 연계 (geo-web-bridge)', CAN_CANCEL)
        self.args = (server, values, input_type, lookups)
        self.message, self.results, self.stopped, self.error = '', {}, None, None

    def run(self):
        try:
            self.results, self.stopped = resolve(*self.args, report=self.report, canceled=self.isCanceled)
            return True
        except Exception as error:
            self.error = str(error)
            return False

    def report(self, text, percent=None):
        self.message = text
        if percent is not None:
            self.setProgress(percent)


class Dialog(QDialog):
    def __init__(self, iface):
        super().__init__(iface.mainWindow())
        self.iface, self.task, self.items = iface, None, []
        self.setWindowTitle('주소·코드 연계 — geo-web-bridge')
        self.setMinimumWidth(520)
        settings = QgsSettings()

        self.layer = QgsMapLayerComboBox()
        self.layer.setFilters(LAYERS)
        self.field = QgsFieldComboBox()
        self.field.setLayer(self.layer.currentLayer())
        self.layer.layerChanged.connect(self.field.setLayer)
        self.selected = QCheckBox('선택한 피처만')
        self.input_type = QComboBox()
        for value, text in INPUT_TYPES:
            self.input_type.addItem(text, value)
        self.groups = []
        group_box = QVBoxLayout()
        for title, names in GROUPS:
            box = QCheckBox(title)
            box.setChecked(True)
            self.groups.append((box, names))
            group_box.addWidget(box)
        self.lookups = QCheckBox('위치·우편번호·도로명주소까지 찾기 (외부 조회: 20줄씩, 공개 서버는 하루 2,000줄)')
        self.lookups.setChecked(settings.value(f'{SETTINGS}/lookups', 'true') == 'true')
        self.points = QCheckBox('위치로 점 레이어도 만들기 (EPSG:4326)')
        self.points.setChecked(True)
        self.lookups.toggled.connect(self.sync)
        self.server = QLineEdit(settings.value(f'{SETTINGS}/server', DEFAULT_SERVER))
        self.server.setToolTip('공개 서버 또는 직접 설치한 geo-web-bridge 주소')

        form = QFormLayout()
        form.addRow('레이어', self.layer)
        form.addRow('값 열', self.field)
        form.addRow('', self.selected)
        form.addRow('입력 종류', self.input_type)
        form.addRow('붙일 결과', group_box)
        form.addRow('', self.lookups)
        form.addRow('', self.points)
        form.addRow('서버', self.server)

        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.status = QLabel('PNU·법정동코드·행정동코드·지번주소·도로명주소가 든 열을 고르세요. 결과는 새 레이어로 추가되고 원본은 바뀌지 않습니다. 같은 이름이 여러 곳이면 "확인 사항"에 후보를 남깁니다.')
        self.status.setWordWrap(True)
        self.run_button, self.cancel_button = QPushButton('변환'), QPushButton('취소')
        self.cancel_button.setEnabled(False)
        self.run_button.clicked.connect(self.start)
        self.cancel_button.clicked.connect(lambda: self.task and self.task.cancel())
        buttons = QHBoxLayout()
        buttons.addWidget(self.run_button)
        buttons.addWidget(self.cancel_button)

        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(self.bar)
        layout.addWidget(self.status)
        layout.addLayout(buttons)
        self.sync()

    def sync(self):
        self.points.setEnabled(self.lookups.isChecked())
        self.groups[-1][0].setEnabled(self.lookups.isChecked())

    def names(self):
        return ALWAYS + [name for box, names in self.groups if box.isChecked() and box.isEnabled() for name in names]

    def start(self):
        layer, field = self.layer.currentLayer(), self.field.currentField()
        if not layer or not field:
            return self.status.setText('레이어와 값 열을 고르세요.')
        features = layer.getSelectedFeatures() if self.selected.isChecked() else layer.getFeatures()
        # 피처는 화면 스레드에서 읽어 둔다 (작업 스레드는 서버 호출만)
        self.items = [(f, str(f[field]).strip() if f[field] is not None and str(f[field]).strip() not in ('', 'NULL') else '') for f in features]
        values = [value for _, value in self.items]
        unique = len(set(v for v in values if v))
        if not unique:
            return self.status.setText('변환할 값이 없습니다.')
        lookups = self.lookups.isChecked()
        server = self.server.text().strip() or DEFAULT_SERVER
        settings = QgsSettings()
        settings.setValue(f'{SETTINGS}/server', server)
        settings.setValue(f'{SETTINGS}/lookups', 'true' if lookups else 'false')
        if lookups and server.rstrip('/') == DEFAULT_SERVER and unique > DAILY:
            self.status.setText(f'서로 다른 값이 {unique}개입니다. 공개 서버의 외부 조회는 하루 {DAILY}줄까지라 앞 {DAILY}개까지만 위치를 찾습니다. 위치가 필요 없으면 외부 조회를 끄세요.')
        self.bar.setValue(0)
        self.run_button.setEnabled(False)
        self.cancel_button.setEnabled(True)
        self.task = LinkTask(server, values, self.input_type.currentData(), lookups)
        self.task.progressChanged.connect(lambda value: (self.bar.setValue(int(value)), self.status.setText(self.task.message)))
        self.task.taskCompleted.connect(self.finished)
        self.task.taskTerminated.connect(lambda: self.done(self.task.error or '변환을 끝내지 못했습니다.'))
        QgsApplication.taskManager().addTask(self.task)

    def done(self, text):
        self.status.setText(text)
        self.run_button.setEnabled(True)
        self.cancel_button.setEnabled(False)

    def finished(self):
        layer = self.layer.currentLayer()
        same, dots = build_layers(layer, self.items, self.task.results, self.names(), self.points.isChecked() and self.points.isEnabled())
        QgsProject.instance().addMapLayer(same)
        if dots is not None:
            QgsProject.instance().addMapLayer(dots)
        rows = [r for r in self.task.results.values()]
        ok = sum(1 for r in rows if r.get('status') == 'ok')
        pick = sum(1 for r in rows if r.get('status') == 'needs_selection')
        self.bar.setValue(100)
        self.done(f'완료: 서로 다른 값 {len(rows)}개 중 정상 {ok}, 후보 선택 필요 {pick}, 그 밖 {len(rows) - ok - pick}. "{same.name()}" 레이어를 추가했습니다.'
                  + (f' 중단: {self.task.stopped}' if self.task.stopped else ''))
