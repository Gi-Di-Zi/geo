# 변환 화면: 레이어·대상 라이브러리·목적·최종본 형태 → 백그라운드 작업(QgsTask)으로 변환 → 결과 폴더·적용 코드·지도 화면
import os
import tempfile

from qgis.core import Qgis, QgsApplication, QgsMapLayerProxyModel, QgsProject, QgsSettings, QgsTask, QgsVectorLayer
from qgis.gui import QgsFileWidget, QgsMapLayerComboBox
from qgis.PyQt.QtCore import QUrl
from qgis.PyQt.QtGui import QDesktopServices, QGuiApplication
from qgis.PyQt.QtWidgets import (QButtonGroup, QCheckBox, QComboBox, QDialog, QFormLayout, QHBoxLayout, QLabel, QLineEdit,
                                 QPlainTextEdit, QProgressBar, QPushButton, QRadioButton, QVBoxLayout)

from .core import FORMS, PRIORITIES, VIEWERS, convert, export_layer, result_layer

SETTINGS = 'geo_web_bridge'
DEFAULT_SERVER = 'https://geospatial.kro.kr'
# QGIS 3.34부터 Qgis.LayerFilter, 그 전은 QgsMapLayerProxyModel의 값
LAYERS = (Qgis.LayerFilter.HasGeometry | Qgis.LayerFilter.RasterLayer) if hasattr(Qgis, 'LayerFilter') else (QgsMapLayerProxyModel.HasGeometry | QgsMapLayerProxyModel.RasterLayer)
CAN_CANCEL = QgsTask.Flag.CanCancel if hasattr(QgsTask, 'Flag') else QgsTask.CanCancel


class ConvertTask(QgsTask):
    def __init__(self, server, path, fmt, intent, out_dir):
        super().__init__('웹 지도 변환 (geo-web-bridge)', CAN_CANCEL)
        self.args = (server, path, fmt, intent, out_dir)
        self.message, self.result, self.error = '', None, None

    def run(self):
        try:
            self.result = convert(*self.args, report=self.report, canceled=self.isCanceled)
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
        self.iface, self.task, self.done = iface, None, None
        self.setWindowTitle('웹 지도로 변환 — geo-web-bridge')
        self.setMinimumWidth(560)
        settings = QgsSettings()

        self.layer = QgsMapLayerComboBox()
        self.layer.setFilters(LAYERS)
        self.selected = QCheckBox('선택한 피처만')
        self.viewer, self.priority = QComboBox(), QComboBox()
        for value, text in VIEWERS:
            self.viewer.addItem(text, value)
        for value, text in PRIORITIES:
            self.priority.addItem(text, value)
        self.forms = QButtonGroup(self)
        form_row = QHBoxLayout()
        for i, (value, text) in enumerate(FORMS):
            button = QRadioButton(text)
            button.setProperty('form', value)
            button.setChecked(value == settings.value(f'{SETTINGS}/form', 'files'))
            self.forms.addButton(button, i)
            form_row.addWidget(button)
        self.folder = QgsFileWidget()
        self.folder.setStorageMode(QgsFileWidget.StorageMode.GetDirectory if hasattr(QgsFileWidget, 'StorageMode') else QgsFileWidget.GetDirectory)
        self.folder.setFilePath(settings.value(f'{SETTINGS}/folder', os.path.join(os.path.expanduser('~'), 'geo-web-bridge')))
        self.add = QCheckBox('결과를 QGIS에 불러오기 (GeoJSON·타일 폴더·COG)')
        self.add.setChecked(True)
        self.server = QLineEdit(settings.value(f'{SETTINGS}/server', DEFAULT_SERVER))
        self.server.setToolTip('공개 서버 또는 직접 설치한 geo-web-bridge 주소. 공개 서버는 파일 200MB·접속자별 하루 1GiB')

        form = QFormLayout()
        form.addRow('레이어', self.layer)
        form.addRow('', self.selected)
        form.addRow('대상 라이브러리', self.viewer)
        form.addRow('목적', self.priority)
        form.addRow('최종본 형태', form_row)
        form.addRow('저장 폴더', self.folder)
        form.addRow('', self.add)
        form.addRow('서버', self.server)

        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.status = QLabel('레이어를 고르고 변환을 누르세요. 벡터는 GeoPackage, 래스터는 GeoTIFF로 보내며 좌표계는 레이어 그대로입니다.')
        self.status.setWordWrap(True)
        self.output = QPlainTextEdit()
        self.output.setReadOnly(True)
        self.output.setPlaceholderText('변환이 끝나면 결과 위치·지도 화면 주소·적용 코드가 여기에 나옵니다.')
        self.run_button, self.cancel_button = QPushButton('변환'), QPushButton('취소')
        self.open_folder, self.open_map, self.copy_code = QPushButton('폴더 열기'), QPushButton('지도 화면 열기'), QPushButton('적용 코드 복사')
        for button in (self.cancel_button, self.open_folder, self.open_map, self.copy_code):
            button.setEnabled(False)
        self.run_button.clicked.connect(self.start)
        self.cancel_button.clicked.connect(lambda: self.task and self.task.cancel())
        self.open_folder.clicked.connect(lambda: QDesktopServices.openUrl(QUrl.fromLocalFile(self.done['folder'])))
        self.open_map.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(self.done['info']['view'])))
        self.copy_code.clicked.connect(lambda: QGuiApplication.clipboard().setText(self.done['code']))
        buttons = QHBoxLayout()
        for button in (self.run_button, self.cancel_button, self.open_folder, self.open_map, self.copy_code):
            buttons.addWidget(button)

        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(self.bar)
        layout.addWidget(self.status)
        layout.addWidget(self.output)
        layout.addLayout(buttons)

    def start(self):
        layer = self.layer.currentLayer()
        if not layer:
            return self.status.setText('레이어를 고르세요.')
        intent = {'viewer': self.viewer.currentData(), 'priority': self.priority.currentData(), 'form': self.forms.checkedButton().property('form')}
        server, out_dir = self.server.text().strip() or DEFAULT_SERVER, self.folder.filePath()
        settings = QgsSettings()
        settings.setValue(f'{SETTINGS}/server', server)
        settings.setValue(f'{SETTINGS}/folder', out_dir)
        settings.setValue(f'{SETTINGS}/form', intent['form'])
        try:
            # 내보내기는 화면 스레드에서 (프로젝트 레이어를 다른 스레드에서 읽지 않는다)
            path, fmt = export_layer(layer, tempfile.mkdtemp(prefix='geo-web-bridge-'), self.selected.isChecked() and isinstance(layer, QgsVectorLayer))
        except Exception as error:
            return self.status.setText(str(error))
        self.output.clear()
        self.bar.setValue(0)
        self.run_button.setEnabled(False)
        self.cancel_button.setEnabled(True)
        self.task = ConvertTask(server, path, fmt, intent, out_dir)
        self.task.progressChanged.connect(lambda value: (self.bar.setValue(int(value)), self.status.setText(self.task.message)))
        self.task.taskCompleted.connect(self.finished)
        self.task.taskTerminated.connect(self.failed)
        QgsApplication.taskManager().addTask(self.task)

    def failed(self):
        self.status.setText(self.task.error or '변환을 끝내지 못했습니다.')
        self.run_button.setEnabled(True)
        self.cancel_button.setEnabled(False)

    def finished(self):
        info, folder, base = self.task.result
        self.run_button.setEnabled(True)
        self.cancel_button.setEnabled(False)
        self.bar.setValue(100)
        html = info.get('intent', {}).get('form') == 'html'
        usage = next((u for u in info.get('usages', []) if html and info.get('site') == u.get('site')), None) or next(iter(info.get('usages', [])), None)
        code = usage['code'] if usage else ''
        self.done = {'info': info, 'folder': folder, 'code': code}
        lines = [f'저장 위치: {folder}', f'지도 화면(서버 사본): {info["view"]}']
        if html:
            lines.append('index.html이 있는 폴더를 정적 웹 서버(npx serve 등)로 열거나 정적 호스팅에 폴더째 올리세요 (README.txt).')
        if usage:
            lines += ['', f'{usage["name"]} 적용 코드 (주소는 결과를 올린 곳으로 바꿔 사용):', code]
        lines += [f'주의: {text}' for text in info.get('limits', [])]
        self.output.setPlainText('\n'.join(lines))
        for button in (self.open_folder, self.open_map, self.copy_code):
            button.setEnabled(True)
        self.copy_code.setEnabled(bool(code))
        self.status.setText(f'완료: {info["name"]} — {info.get("method", {}).get("title", "")}')
        if self.add.isChecked():
            output = next((o for o in info.get('outputs', []) if usage and o['id'] == usage['output']), info.get('primary'))
            layer = output and result_layer(output, base, f'{info["name"]} · {output["label"]}')
            if layer:
                QgsProject.instance().addMapLayer(layer)
            elif output:
                self.status.setText(self.status.text() + f' (결과 {output["label"]}은 QGIS에서 바로 열지 않습니다. 폴더에서 확인하세요)')
