# 웹 지도 변환 패널 (QGIS 오른쪽 도킹): 레이어(옆 "예시" 메뉴로 확장자별 공개 예시도) → 라이브러리·결과 형태·저장 폴더 → 백그라운드 작업으로 변환
# → 결과 (HTML 지도는 브라우저로 보기, 폴더 열기, 적용 코드). 상태·진행은 QGIS 지도 위 메시지 줄
# 서버는 배포 서버. 개발·시험만 QGIS 고급 설정 geo_web_bridge/server_override (npm run qgis:dev·시험이 넣는다)
import os
import tempfile

from qgis.core import Qgis, QgsApplication, QgsMapLayerProxyModel, QgsProject, QgsSettings, QgsVectorLayer
from qgis.gui import QgsCollapsibleGroupBox, QgsDockWidget, QgsFileWidget, QgsMapLayerComboBox
from qgis.PyQt.QtCore import Qt, QUrl
from qgis.PyQt.QtGui import QDesktopServices, QFontDatabase
from qgis.PyQt.QtWidgets import QCheckBox, QComboBox, QFormLayout, QHBoxLayout, QMenu, QPlainTextEdit, QToolButton, QVBoxLayout, QWidget

from .core import FORMS, VIEWERS, convert, export_layer, fetch_sample, list_samples, result_layer, sample_layer, serve
from .ui import Job, Status, button, dock_body, enum, narrow

SETTINGS = 'geo_web_bridge'
DEFAULT_SERVER = 'https://geospatial.kro.kr'
# QGIS 3.34부터 Qgis.LayerFilter, 그 전은 QgsMapLayerProxyModel의 값
LAYERS = (Qgis.LayerFilter.HasGeometry | Qgis.LayerFilter.RasterLayer) if hasattr(Qgis, 'LayerFilter') else (QgsMapLayerProxyModel.HasGeometry | QgsMapLayerProxyModel.RasterLayer)


def server():
    """배포 서버 (사용자 화면에는 없다). 개발·시험은 고급 설정 server_override"""
    return (QgsSettings().value(f'{SETTINGS}/server_override', '') or DEFAULT_SERVER).rstrip('/')


class Panel(QgsDockWidget):
    def __init__(self, iface):
        super().__init__('웹 지도로 변환', iface.mainWindow())
        self.setObjectName('geo_web_bridge_panel')
        self.iface, self.task, self.listing, self.last_folder, self.preview = iface, None, None, None, None
        settings = QgsSettings()

        # 레이어 + 예시 메뉴 (확장자별 공개 예시를 받아 레이어로. 목록은 패널을 열 때 서버에서)
        self.layer = QgsMapLayerComboBox()
        self.layer.setFilters(LAYERS)
        self.samples = QMenu(self)
        self.samples.setToolTipsVisible(True)
        self.samples.triggered.connect(self.load_sample)
        self.sample_button = QToolButton()
        self.sample_button.setText('예시')
        self.sample_button.setIcon(QgsApplication.getThemeIcon('/mActionDataSourceManager.svg'))
        self.sample_button.setToolButtonStyle(enum(Qt, 'ToolButtonStyle', 'ToolButtonTextBesideIcon'))
        self.sample_button.setPopupMode(enum(QToolButton, 'ToolButtonPopupMode', 'InstantPopup'))
        self.sample_button.setToolTip('예시 데이터 불러오기: 확장자별 공개 예시를 받아 레이어로 추가합니다 (저장 폴더의 "예시" 아래)')
        self.sample_button.setMenu(self.samples)
        layer_row = QHBoxLayout()
        layer_row.addWidget(self.layer, 1)
        layer_row.addWidget(self.sample_button)
        self.selected = QCheckBox('선택한 피처만')

        # 결과 형태
        self.viewer = QComboBox()
        for value, text in VIEWERS:
            self.viewer.addItem(text, value)
        self.form = QComboBox()
        for value, text in FORMS:
            self.form.addItem(text, value)
        self.form.setCurrentIndex(max(self.form.findData(settings.value(f'{SETTINGS}/form', 'html')), 0))
        self.form.setToolTip('결과 파일 + 적용 코드: 내 웹 프로젝트에 넣을 결과와 코드\n바로 열리는 HTML 지도: 결과·지도 페이지·라이브러리를 한 폴더로 (브라우저로 보기, 정적 호스팅에 그대로)')
        for combo in (self.layer, self.viewer, self.form):
            narrow(combo)
        self.folder = QgsFileWidget()
        self.folder.setStorageMode(enum(QgsFileWidget, 'StorageMode', 'GetDirectory'))
        self.folder.setFilePath(settings.value(f'{SETTINGS}/folder', os.path.join(os.path.expanduser('~'), 'geo-web-bridge')))
        self.add = QCheckBox('결과를 QGIS에도 불러오기')
        self.add.setToolTip('GeoJSON·벡터 타일 폴더·COG·래스터 타일 결과를 레이어로 추가해 확인합니다 (PMTiles·이미지 한 장은 폴더에서)')
        self.add.setChecked(True)
        form = QFormLayout()
        form.addRow('레이어', layer_row)
        form.addRow('', self.selected)
        form.addRow('라이브러리', self.viewer)
        form.addRow('결과 형태', self.form)
        form.addRow('저장 폴더', self.folder)
        form.addRow('', self.add)

        self.run_button = button('웹 지도로 변환', '/mActionStart.svg')
        self.run_button.setToolTip('벡터는 GeoPackage, 래스터는 GeoTIFF로 서버에 보내 변환합니다 (좌표계는 레이어 그대로)')
        self.run_button.clicked.connect(self.convert_layer)
        run_row = QHBoxLayout()
        run_row.addStretch(1)
        run_row.addWidget(self.run_button)

        # 결과: 브라우저로 보기(HTML 지도)·폴더 열기, 저장 위치·적용 코드·주의 (변환이 끝나면)
        self.browse_button = button('브라우저로 보기', '/mActionShowAllLayers.svg')
        self.browse_button.setToolTip('받은 HTML 지도를 이 PC에서만 열리는 주소(127.0.0.1)로 띄워 기본 브라우저로 엽니다. QGIS를 끄면 함께 닫힙니다.')
        self.browse_button.clicked.connect(self.browse)
        open_folder = button('폴더 열기', '/mIconFolderOpen.svg')
        open_folder.clicked.connect(self.reveal)
        actions = QHBoxLayout()
        actions.addWidget(self.browse_button)
        actions.addWidget(open_folder)
        actions.addStretch(1)
        self.output = QPlainTextEdit()
        self.output.setReadOnly(True)
        self.output.setFont(QFontDatabase.systemFont(enum(QFontDatabase, 'SystemFont', 'FixedFont')))
        self.output.setMinimumHeight(180)
        result_layout = QVBoxLayout()
        result_layout.addLayout(actions)
        result_layout.addWidget(self.output)
        self.result_box = QgsCollapsibleGroupBox('결과')
        self.result_box.setLayout(result_layout)
        self.result_box.hide()

        content = QWidget()
        layout = QVBoxLayout(content)
        layout.addLayout(form)
        layout.addLayout(run_row)
        layout.addWidget(self.result_box)
        layout.addStretch(1)
        self.status = Status(iface.messageBar(), '웹 지도로 변환')
        self.setWidget(dock_body(content))
        if server() != DEFAULT_SERVER:
            self.status.say(f'개발 서버: {server()}')
        self.fetch_samples()

    # 예시 데이터
    def fetch_samples(self):
        self.fill_samples([], '목록 받는 중…')
        target = server()
        self.listing = job = Job('예시 목록 (geo-web-bridge)', lambda report, canceled: list_samples(target))
        job.taskCompleted.connect(lambda: self.fill_samples(job.result))
        job.taskTerminated.connect(lambda: self.fill_samples([], '목록을 받지 못함 — 다시 받기'))
        QgsApplication.taskManager().addTask(job)

    def fill_samples(self, items, empty=None):
        """예시 메뉴: 항목마다 확장자·유형·자료 이름, 툴팁에 파일 이름·출처. empty = 목록 대신 보일 한 줄 (누르면 다시 받기)"""
        self.samples.clear()
        if empty:
            self.samples.addAction(empty).setEnabled(not empty.endswith('…'))
        for s in items:
            action = self.samples.addAction(f'{s["ext"]}  {s["category"]} — {s["dataset"]}')
            action.setData(s)
            action.setToolTip(f'{s["name"]}\n출처: {s["attribution"]} · {s["license"]}')

    def load_sample(self, action):
        s = action.data()
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
        self.status.say(f'불러옴: {layer.name()} — {s["dataset"]} (출처: {s["attribution"]} · {s["license"]})', 'ok')

    # 변환
    def convert_layer(self):
        layer = self.layer.currentLayer()
        if not layer:
            return self.status.say('레이어를 고르거나 "예시"에서 불러오세요.', 'warn')
        intent = {'viewer': self.viewer.currentData(), 'form': self.form.currentData()}
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
        self.browse_button.setVisible(html)
        lines = [f'저장 위치: {folder}']
        if html:
            lines.append('공유할 때는 폴더째 정적 호스팅(GitHub Pages·사내 웹 서버 등)에 올리세요 (README.txt).')
        if usage:
            lines += ['', f'{usage["name"]} 적용 코드 (주소는 결과를 올린 곳으로 바꿔 사용):', usage['code']]
        lines += [f'주의: {text}' for text in info.get('limits', [])]
        self.output.setPlainText('\n'.join(lines))
        self.result_box.show()
        message = f'완료: {info["name"]} — {info.get("method", {}).get("title", "")}'
        if self.add.isChecked():
            output = next((o for o in info.get('outputs', []) if usage and o['id'] == usage['output']), info.get('primary'))
            layer = output and result_layer(output, base, f'{info["name"]} · {output["label"]}')
            if layer:
                QgsProject.instance().addMapLayer(layer)
            elif output:
                message += f' (결과 {output["label"]}은 QGIS에서 바로 열지 않습니다. 폴더 열기로 확인하세요)'
        self.status.say(message, 'ok')

    def reveal(self):
        folder = self.last_folder or self.folder.filePath()
        os.makedirs(folder, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(folder))

    def browse(self):
        """마지막 HTML 지도 폴더를 127.0.0.1로 띄워 브라우저로 (앞서 띄운 것은 멈춘다)"""
        self.stop_preview()
        self.preview = serve(self.last_folder)
        QDesktopServices.openUrl(QUrl(f'http://127.0.0.1:{self.preview.server_address[1]}/'))

    def stop_preview(self):
        if self.preview is not None:
            self.preview.shutdown()
            self.preview.server_close()
            self.preview = None

    # 작업 하나 (예시 받기·변환): 메시지 줄에 진행·취소, 끝나면 done(결과)
    def start(self, title, work, done):
        self.busy(True)
        self.task = task = Job(title, work)
        self.status.working('시작하는 중…', task.cancel)
        task.progressChanged.connect(lambda value: self.status.step(task.message, value))
        task.taskCompleted.connect(lambda: (self.busy(False), done(task.result)))
        task.taskTerminated.connect(lambda: (self.busy(False), self.status.say(task.error or '끝내지 못했습니다.', 'error')))
        QgsApplication.taskManager().addTask(task)

    def busy(self, on):
        self.run_button.setEnabled(not on)
        self.sample_button.setEnabled(not on)
