# 웹 지도 변환 패널 (QGIS 오른쪽 도킹): ① 레이어(또는 확장자별 예시 데이터) → ② 대상 라이브러리·최종본 형태 → 백그라운드 작업으로 변환 → ③ 결과
# 서버는 배포 서버. 개발·시험만 QGIS 고급 설정 geo_web_bridge/server_override (npm run qgis:dev·시험이 넣는다)
import os
import tempfile

from qgis.core import Qgis, QgsApplication, QgsMapLayerProxyModel, QgsProject, QgsSettings, QgsVectorLayer
from qgis.gui import QgsDockWidget, QgsFileWidget, QgsMapLayerComboBox
from qgis.PyQt.QtCore import Qt, QUrl
from qgis.PyQt.QtGui import QDesktopServices, QFontDatabase
from qgis.PyQt.QtWidgets import (QButtonGroup, QCheckBox, QComboBox, QFormLayout, QFrame, QHBoxLayout, QLabel, QPlainTextEdit, QRadioButton,
                                 QScrollArea, QVBoxLayout, QWidget)

from .core import FORMS, VIEWERS, convert, export_layer, fetch_sample, list_samples, result_layer, sample_layer
from .ui import Job, Message, bar, button, enum, footer, header, narrow, progress, section

SETTINGS = 'geo_web_bridge'
DEFAULT_SERVER = 'https://geospatial.kro.kr'
ICON = os.path.join(os.path.dirname(__file__), 'icon.svg')
# QGIS 3.34부터 Qgis.LayerFilter, 그 전은 QgsMapLayerProxyModel의 값
LAYERS = (Qgis.LayerFilter.HasGeometry | Qgis.LayerFilter.RasterLayer) if hasattr(Qgis, 'LayerFilter') else (QgsMapLayerProxyModel.HasGeometry | QgsMapLayerProxyModel.RasterLayer)


def server():
    """배포 서버 (사용자 화면에는 없다). 개발·시험은 고급 설정 server_override"""
    return (QgsSettings().value(f'{SETTINGS}/server_override', '') or DEFAULT_SERVER).rstrip('/')


class Panel(QgsDockWidget):
    def __init__(self, iface):
        super().__init__('웹 지도로 변환', iface.mainWindow())
        self.setObjectName('geo_web_bridge_panel')
        self.iface, self.task, self.listing, self.last_folder = iface, None, None, None
        settings = QgsSettings()

        # ① 레이어: 프로젝트 레이어, 또는 확장자별 공개 예시를 받아 레이어로 (목록은 패널을 열 때 서버에서)
        self.layer = QgsMapLayerComboBox()
        self.layer.setFilters(LAYERS)
        self.selected = QCheckBox('선택한 피처만')
        self.sample = QComboBox()
        self.sample.currentIndexChanged.connect(self.describe_sample)
        self.load_button = button('불러오기', '/mActionAddOgrLayer.svg')
        self.load_button.setToolTip('고른 예시 원본을 받아 레이어로 추가합니다 (저장 폴더의 "예시" 아래)')
        self.load_button.clicked.connect(self.load_sample)
        self.sample_note = QLabel()
        self.sample_note.setWordWrap(True)
        pick = QHBoxLayout()
        pick.addWidget(self.sample, 1)
        pick.addWidget(self.load_button)
        data = QFormLayout()
        data.addRow('레이어', self.layer)
        data.addRow('', self.selected)
        data.addRow('예시 데이터', pick)
        data.addRow('', self.sample_note)

        # ② 결과 형태
        self.viewer = QComboBox()
        for combo in (self.sample, self.layer, self.viewer):
            narrow(combo)
        for value, text in VIEWERS:
            self.viewer.addItem(text, value)
        self.forms = QButtonGroup(self)
        form_column = QVBoxLayout()
        for i, (value, text) in enumerate(FORMS):
            radio = QRadioButton(text)
            radio.setProperty('form', value)
            radio.setChecked(value == settings.value(f'{SETTINGS}/form', 'files'))
            self.forms.addButton(radio, i)
            form_column.addWidget(radio)
        shape = QFormLayout()
        shape.addRow('라이브러리', self.viewer)
        shape.addRow('최종본', form_column)

        self.run_button = button('웹 지도로 변환', '/mActionStart.svg', primary=True)
        self.run_button.clicked.connect(self.convert_layer)
        self.bar, self.cancel_button = bar(), button('취소', '/mTaskCancel.svg')
        self.cancel_button.clicked.connect(lambda: self.task and self.task.cancel())
        self.progress = progress(self.bar, self.cancel_button)
        hint = '레이어를 고르거나 예시 데이터를 불러온 뒤 변환하세요. 벡터는 GeoPackage, 래스터는 GeoTIFF로 보내며 좌표계는 레이어 그대로입니다.'
        if server() != DEFAULT_SERVER:
            hint += f' (개발 서버: {server()})'
        self.status = Message(hint)

        # ③ 결과: 저장 위치·적용 코드·주의 (변환이 끝나면)
        self.output = QPlainTextEdit()
        self.output.setReadOnly(True)
        self.output.setFont(QFontDatabase.systemFont(enum(QFontDatabase, 'SystemFont', 'FixedFont')))
        self.output.setMinimumHeight(160)
        result_layout = QVBoxLayout()
        result_layout.addWidget(self.output)
        self.result_box = section('③ 결과', result_layout)
        self.result_box.hide()

        # 옵션: 저장 폴더·폴더 열기·결과 불러오기
        self.folder = QgsFileWidget()
        self.folder.setStorageMode(enum(QgsFileWidget, 'StorageMode', 'GetDirectory'))
        self.folder.setFilePath(settings.value(f'{SETTINGS}/folder', os.path.join(os.path.expanduser('~'), 'geo-web-bridge')))
        open_folder = button('폴더 열기', '/mIconFolderOpen.svg')
        open_folder.setToolTip('마지막 결과 폴더 (없으면 저장 폴더)')
        open_folder.clicked.connect(self.reveal)
        self.add = QCheckBox('결과를 QGIS에 불러오기')
        self.add.setToolTip('GeoJSON·벡터 타일 폴더·COG·래스터 타일 결과를 레이어로 추가합니다 (PMTiles·이미지 한 장은 폴더에서)')
        self.add.setChecked(True)
        option_form = QFormLayout()
        option_form.addRow('저장 폴더', self.folder)
        option_form.addRow('', open_folder)
        option_form.addRow('', self.add)

        body = QWidget()
        layout = QVBoxLayout(body)
        layout.setSpacing(8)
        layout.addWidget(header(ICON, '웹 지도로 변환', 'QGIS 레이어를 OpenLayers·MapLibre·Deck.gl·CesiumJS용 결과 파일이나 바로 열리는 HTML 지도로'))
        layout.addWidget(section('① 레이어', data))
        layout.addWidget(section('② 결과 형태', shape))
        layout.addWidget(self.run_button)
        layout.addWidget(self.progress)
        layout.addWidget(self.status)
        layout.addWidget(self.result_box)
        layout.addWidget(section('옵션', option_form, collapsed=True))
        layout.addStretch(1)
        layout.addWidget(footer())
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(enum(QFrame, 'Shape', 'NoFrame'))
        # 패널 폭에 맞춘다 (옆으로 밀리는 스크롤 없이)
        scroll.setHorizontalScrollBarPolicy(enum(Qt, 'ScrollBarPolicy', 'ScrollBarAlwaysOff'))
        scroll.setWidget(body)
        self.setWidget(scroll)
        self.fetch_samples()

    # 예시 데이터
    def fetch_samples(self):
        self.sample.clear()
        self.sample.addItem('예시 목록 받는 중…')
        self.load_button.setEnabled(False)
        target = server()
        self.listing = job = Job('예시 목록 (geo-web-bridge)', lambda report, canceled: list_samples(target))
        job.taskCompleted.connect(lambda: self.fill_samples(job.result))
        job.taskTerminated.connect(lambda: self.fill_samples(None))
        QgsApplication.taskManager().addTask(job)

    def fill_samples(self, items):
        self.sample.clear()
        if items is None:
            self.sample.addItem('예시 목록을 받지 못함 (불러오기 = 다시 시도)')
        for s in items or []:
            self.sample.addItem(f'{s["ext"]}  {s["category"]} — {s["dataset"]}', s)
            self.sample.setItemData(self.sample.count() - 1, f'{s["name"]}\n{s["dataset"]}', enum(Qt, 'ItemDataRole', 'ToolTipRole'))
        self.load_button.setEnabled(not self.progress.isVisible())

    def describe_sample(self):
        s = self.sample.currentData()
        self.sample_note.setText(f'<small>출처: {s["attribution"]} · {s["license"]}</small>' if s else '')

    def load_sample(self):
        s = self.sample.currentData()
        if not s:
            return self.fetch_samples()
        target, folder = server(), os.path.join(self.folder.filePath(), '예시')
        self.start('예시 데이터 받기 (geo-web-bridge)', lambda report, canceled: fetch_sample(target, s, folder, report), lambda path: self.add_sample(path, s))

    def add_sample(self, path, s):
        try:
            layer = sample_layer(path, s)
        except Exception as error:
            return self.status.say(str(error), 'error')
        QgsProject.instance().addMapLayer(layer)
        self.layer.setLayer(layer)
        self.iface.setActiveLayer(layer)
        self.iface.zoomToActiveLayer()
        self.status.say(f'불러옴: {layer.name()} ({s["dataset"]}). 웹 지도로 변환을 누르면 이 레이어를 바꿉니다.', 'ok')

    # 변환
    def convert_layer(self):
        layer = self.layer.currentLayer()
        if not layer:
            return self.status.say('레이어를 고르거나 예시 데이터를 불러오세요.', 'warn')
        intent = {'viewer': self.viewer.currentData(), 'form': self.forms.checkedButton().property('form')}
        out_dir, target = self.folder.filePath(), server()
        settings = QgsSettings()
        settings.setValue(f'{SETTINGS}/folder', out_dir)
        settings.setValue(f'{SETTINGS}/form', intent['form'])
        try:
            # 내보내기는 화면 스레드에서 (프로젝트 레이어를 다른 스레드에서 읽지 않는다)
            path, fmt = export_layer(layer, tempfile.mkdtemp(prefix='geo-web-bridge-'), self.selected.isChecked() and isinstance(layer, QgsVectorLayer))
        except Exception as error:
            return self.status.say(str(error), 'error')
        self.result_box.hide()
        self.start('웹 지도 변환 (geo-web-bridge)', lambda report, canceled: convert(target, path, fmt, intent, out_dir, report=report, canceled=canceled), self.converted)

    def converted(self, result):
        info, folder, base = result
        self.last_folder = folder
        html = info.get('intent', {}).get('form') == 'html'
        usage = next((u for u in info.get('usages', []) if html and info.get('site') == u.get('site')), None) or next(iter(info.get('usages', [])), None)
        lines = [f'저장 위치: {folder}']
        if html:
            lines.append('index.html이 있는 폴더를 정적 웹 서버(npx serve 등)로 열거나 정적 호스팅에 폴더째 올리세요 (README.txt).')
        if usage:
            lines += ['', f'{usage["name"]} 적용 코드 (주소는 결과를 올린 곳으로 바꿔 사용):', usage['code']]
        lines += [f'주의: {text}' for text in info.get('limits', [])]
        self.output.setPlainText('\n'.join(lines))
        self.result_box.show()
        message, tone = f'완료: {info["name"]} — {info.get("method", {}).get("title", "")}', 'ok'
        if self.add.isChecked():
            output = next((o for o in info.get('outputs', []) if usage and o['id'] == usage['output']), info.get('primary'))
            layer = output and result_layer(output, base, f'{info["name"]} · {output["label"]}')
            if layer:
                QgsProject.instance().addMapLayer(layer)
            elif output:
                message += f' (결과 {output["label"]}은 QGIS에서 바로 열지 않습니다. 옵션의 폴더 열기로 확인하세요)'
        self.status.say(message, tone)

    def reveal(self):
        folder = self.last_folder or self.folder.filePath()
        os.makedirs(folder, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(folder))

    # 작업 하나 (예시 받기·변환): 진행 막대·취소, 끝나면 done(결과)
    def start(self, title, work, done):
        self.busy(True)
        self.task = task = Job(title, work)
        task.progressChanged.connect(lambda value: (self.bar.setValue(int(value)), self.status.say(task.message)))
        task.taskCompleted.connect(lambda: (self.busy(False), done(task.result)))
        task.taskTerminated.connect(lambda: (self.busy(False), self.status.say(task.error or '끝내지 못했습니다.', 'error')))
        QgsApplication.taskManager().addTask(task)

    def busy(self, on):
        self.bar.setValue(0)
        self.progress.setVisible(on)
        self.run_button.setEnabled(not on)
        self.load_button.setEnabled(not on)
