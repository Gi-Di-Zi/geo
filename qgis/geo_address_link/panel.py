# 주소·코드 연계 패널 (QGIS 오른쪽 도킹). 두 방식:
#  직접 검색 = 웹처럼 주소·코드·좌표를 넣거나 지도를 찍어 결과를 패널에서 보고, 원하면 점·필지 레이어로
#  레이어 값 = 레이어의 한 열(또는 도형 위치)을 결과 열을 붙인 새 레이어로 (원본은 바꾸지 않음)
# 서버는 배포 서버. 개발·시험만 QGIS 고급 설정 geo_address_link/server_override (npm run qgis:dev가 넣는다)
from qgis.core import (Qgis, QgsApplication, QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsFeature, QgsMapLayerProxyModel,
                       QgsProject, QgsSettings, QgsTask, QgsVectorLayer)
from qgis.gui import QgsDockWidget, QgsFieldComboBox, QgsMapLayerComboBox, QgsMapToolEmitPoint
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QGuiApplication
from qgis.PyQt.QtWidgets import (QCheckBox, QComboBox, QFormLayout, QFrame, QHBoxLayout, QLabel, QPlainTextEdit, QProgressBar, QPushButton,
                                 QScrollArea, QTabWidget, QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget)

from .core import ALWAYS, DETAIL_FIELDS, FIELDS, GROUPS, INPUT_TYPES, SEARCH_LIMIT, STATUS, build_layers, geometry_value, resolve, row_values, search, wgs84

SETTINGS = 'geo_address_link'
DEFAULT_SERVER = 'https://geospatial.kro.kr'
DAILY = 2000
# 도형 없는 표도 (QGIS 3.34부터 Qgis.LayerFilter)
LAYERS = Qgis.LayerFilter.VectorLayer if hasattr(Qgis, 'LayerFilter') else QgsMapLayerProxyModel.VectorLayer
CAN_CANCEL = QgsTask.Flag.CanCancel if hasattr(QgsTask, 'Flag') else QgsTask.CanCancel
ALL_NAMES = ALWAYS + [name for _, names, _ in GROUPS for name in names]


def enum(cls, group, name):
    """Qt5·Qt6 공통 열거값 (Qt6은 cls.Group.Name)"""
    return getattr(getattr(cls, group, cls), name)


def narrow(combo):
    """좁은 패널: 콤보가 가장 긴 항목만큼 넓어지지 않게 (전체 이름은 펼친 목록에)"""
    combo.setSizeAdjustPolicy(enum(QComboBox, 'SizeAdjustPolicy', 'AdjustToMinimumContentsLengthWithIcon'))
    combo.setMinimumContentsLength(8)


def server():
    """배포 서버 (사용자 화면에는 없다). 개발·시험은 고급 설정 server_override"""
    return (QgsSettings().value(f'{SETTINGS}/server_override', '') or DEFAULT_SERVER).rstrip('/')


class Job(QgsTask):
    """화면 밖에서 도는 일 하나 (서버 호출). work(report, canceled) → 결과"""

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


class Panel(QgsDockWidget):
    def __init__(self, iface):
        super().__init__('주소·코드 연계', iface.mainWindow())
        self.setObjectName('geo_address_link_panel')
        self.iface, self.task, self.items, self.lines, self.found = iface, None, [], [], {}
        settings = QgsSettings()

        # 직접 검색
        self.query = QPlainTextEdit()
        self.query.setPlaceholderText('주소, PNU, 법정동·행정동 코드, 좌표(경도, 위도)')
        self.query.setFixedHeight(self.query.fontMetrics().lineSpacing() * 4 + 12)
        self.search_button = QPushButton('검색')
        self.search_button.clicked.connect(self.search_lines)
        self.pick_button = QPushButton('지도에서 찍기')
        self.pick_button.setCheckable(True)
        self.pick_button.setToolTip('지도를 누르면 그 지점의 필지를 찾습니다 (외부 조회 필요)')
        self.pick_button.toggled.connect(self.pick)
        self.picker = QgsMapToolEmitPoint(iface.mapCanvas())
        self.picker.canvasClicked.connect(self.picked)
        self.picker.deactivated.connect(lambda: self.pick_button.setChecked(False))
        search_row = QHBoxLayout()
        search_row.addWidget(self.search_button)
        search_row.addWidget(self.pick_button)
        search_hint = QLabel(f'한 줄에 하나, 최대 {SEARCH_LIMIT}줄. 좌표는 "경도, 위도"(EPSG:4326). 결과 값을 두 번 누르면 복사합니다.')
        search_hint.setWordWrap(True)
        self.tree = QTreeWidget()
        self.tree.setHeaderLabels(['항목', '값'])
        self.tree.setMinimumHeight(220)
        self.tree.itemDoubleClicked.connect(self.copy_value)
        self.tree.hide()
        self.add_button = QPushButton('결과를 점·필지 레이어로 추가')
        self.add_button.clicked.connect(self.add_search_layers)
        self.add_button.hide()
        search_tab = QWidget()
        search_box = QVBoxLayout(search_tab)
        search_box.addWidget(self.query)
        search_box.addLayout(search_row)
        search_box.addWidget(search_hint)
        search_box.addWidget(self.tree)
        search_box.addWidget(self.add_button)
        search_box.addStretch(1)

        # 레이어 값
        self.layer = QgsMapLayerComboBox()
        self.layer.setFilters(LAYERS)
        self.field = QgsFieldComboBox()
        self.field.setLayer(self.layer.currentLayer())
        self.layer.layerChanged.connect(self.field.setLayer)
        self.selected = QCheckBox('선택한 피처만')
        self.input_type = QComboBox()
        for combo in (self.layer, self.field, self.input_type):
            narrow(combo)
        for value, text in INPUT_TYPES:
            self.input_type.addItem(text, value)
        self.groups = []
        group_box = QVBoxLayout()
        for title, names, external in GROUPS:
            box = QCheckBox(title)
            box.setChecked(True)
            self.groups.append((box, names, external))
            group_box.addWidget(box)
        self.points = QCheckBox('위치 점 레이어도 만들기')
        self.points.setToolTip('찾은 위치(경도·위도)로 점 레이어를 함께 만듭니다 (EPSG:4326)')
        self.points.setChecked(True)
        self.parcels = QCheckBox('필지 경계 레이어도 만들기')
        self.parcels.setToolTip('연속지적도(참고 도면)의 필지 경계로 면 레이어를 함께 만듭니다 (EPSG:4326)')
        self.run_button = QPushButton('변환')
        self.run_button.clicked.connect(self.convert_layer)
        layer_tab = QWidget()
        form = QFormLayout(layer_tab)
        form.addRow('레이어', self.layer)
        form.addRow('값 열', self.field)
        form.addRow('', self.selected)
        form.addRow('입력 종류', self.input_type)
        form.addRow('붙일 결과', group_box)
        form.addRow('', self.points)
        form.addRow('', self.parcels)
        form.addRow('', self.run_button)

        tabs = QTabWidget()
        tabs.addTab(search_tab, '직접 검색')
        tabs.addTab(layer_tab, '레이어 값')

        # 공통: 외부 조회, 진행(쓸 때만 보임)·상태
        self.lookups = QCheckBox('외부 조회 (위치·건물·필지·토지 속성)')
        self.lookups.setToolTip('위치·우편번호·도로명주소·건물·필지·토지 속성을 VWorld에서 찾습니다. 20줄씩, 공개 서버는 접속자별 하루 2,000줄. 끄면 코드 사전만으로 빠르게 바꿉니다.')
        self.lookups.setChecked(settings.value(f'{SETTINGS}/lookups', 'true') == 'true')
        self.lookups.toggled.connect(self.sync)
        self.bar = QProgressBar()
        self.bar.setRange(0, 100)
        self.cancel_button = QPushButton('취소')
        self.cancel_button.clicked.connect(lambda: self.task and self.task.cancel())
        progress = QHBoxLayout()
        progress.addWidget(self.bar, 1)
        progress.addWidget(self.cancel_button)
        self.progress = QWidget()
        self.progress.setLayout(progress)
        self.progress.hide()
        hint = '직접 검색하거나, 레이어 값 탭에서 PNU·법정동코드·행정동코드·주소가 든 열을 고르세요. 같은 이름이 여러 곳이면 "확인 사항"에 후보를 남깁니다.'
        if server() != DEFAULT_SERVER:
            hint += f' (개발 서버: {server()})'
        self.status = QLabel(hint)
        self.status.setWordWrap(True)

        body = QWidget()
        layout = QVBoxLayout(body)
        layout.addWidget(tabs)
        layout.addWidget(self.lookups)
        layout.addWidget(self.progress)
        layout.addWidget(self.status)
        layout.addStretch(1)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(enum(QFrame, 'Shape', 'NoFrame'))
        # 패널 폭에 맞춘다 (옆으로 밀리는 스크롤 없이)
        scroll.setHorizontalScrollBarPolicy(enum(Qt, 'ScrollBarPolicy', 'ScrollBarAlwaysOff'))
        scroll.setWidget(body)
        self.setWidget(scroll)
        self.sync()

    def sync(self):
        on = self.lookups.isChecked()
        self.points.setEnabled(on)
        self.parcels.setEnabled(on)
        self.pick_button.setEnabled(on)
        for box, _, external in self.groups:
            if external:
                box.setEnabled(on)

    def remember(self):
        """외부 조회 켬·끔을 다음에도 (검색·변환할 때만 저장)"""
        on = self.lookups.isChecked()
        QgsSettings().setValue(f'{SETTINGS}/lookups', 'true' if on else 'false')
        return on

    def names(self):
        return ALWAYS + [name for box, names, _ in self.groups if box.isChecked() and box.isEnabled() for name in names]

    # 직접 검색
    def search_lines(self):
        lines = list(dict.fromkeys(line.strip() for line in self.query.toPlainText().splitlines() if line.strip()))
        if not lines:
            return self.status.setText('찾을 주소나 코드를 넣으세요.')
        if len(lines) > SEARCH_LIMIT:
            return self.status.setText(f'한 번에 {SEARCH_LIMIT}줄까지 찾습니다. 많은 값은 레이어 값 탭을 쓰세요.')
        target, lookups = server(), self.remember()
        self.start('주소·코드 검색 (geo-web-bridge)', lambda report, canceled: search(target, lines, lookups, report, canceled), lambda found: self.show_results(lines, found))

    def pick(self, on):
        canvas = self.iface.mapCanvas()
        if on:
            canvas.setMapTool(self.picker)
        elif canvas.mapTool() is self.picker:
            canvas.unsetMapTool(self.picker)

    def picked(self, point, _button=None):
        transform = QgsCoordinateTransform(self.iface.mapCanvas().mapSettings().destinationCrs(), QgsCoordinateReferenceSystem('EPSG:4326'), QgsProject.instance())
        spot = transform.transform(point)
        self.query.setPlainText(f'{spot.x():.7f}, {spot.y():.7f}')
        self.search_lines()

    def show_results(self, lines, found):
        self.lines, self.found = lines, found
        self.tree.clear()
        for value in lines:
            row = found.get(value)
            values = row_values(row)
            shown = {**((row or {}).get('output') or {}), 'note': values['note']}
            top = QTreeWidgetItem([value, STATUS.get(values['status'], values['status'])])
            top.setToolTip(0, value)
            for _, alias, key, _ in FIELDS:
                text = str(shown.get(key) or '')
                if key != 'status' and text:
                    item = QTreeWidgetItem(top, [alias, text])
                    item.setToolTip(1, text)
            self.tree.addTopLevelItem(top)
        self.tree.expandAll()
        self.tree.resizeColumnToContents(0)
        self.tree.show()
        self.add_button.setVisible(self.lookups.isChecked())
        ok = sum(1 for r in found.values() if r.get('status') == 'ok')
        self.status.setText(f'{len(lines)}줄 중 정상 {ok}.')

    def copy_value(self, item, _column=0):
        QGuiApplication.clipboard().setText(item.text(1) if item.parent() else item.text(0))
        self.status.setText(f'복사함: {item.text(1) if item.parent() else item.text(0)}')

    def add_search_layers(self):
        """검색 결과 → 점 레이어(위치)·필지 경계 레이어. 결과 열은 레이어 값과 같다"""
        table = QgsVectorLayer('None?field=입력:string', '주소·코드 검색', 'memory')
        rows = []
        for value in self.lines:
            feature = QgsFeature(table.fields())
            feature.setAttributes([value])
            rows.append(feature)
        table.dataProvider().addFeatures(rows)
        items = [(f, f['입력']) for f in table.getFeatures()]
        _, dots, lots = build_layers(table, items, self.found, ALL_NAMES, points=True, parcels=True)
        added = [layer for layer in (dots, lots) if layer.featureCount()]
        if not added:
            return self.status.setText('위치나 필지 경계가 있는 결과가 없습니다.')
        QgsProject.instance().addMapLayers(added)
        self.iface.setActiveLayer(added[0])
        self.iface.zoomToActiveLayer()
        self.status.setText('추가함: ' + ', '.join(f'"{layer.name()}"' for layer in added))

    # 레이어 값
    def convert_layer(self):
        layer, field = self.layer.currentLayer(), self.field.currentField()
        by_geometry = self.input_type.currentData() == 'geometry'
        if not layer or (not field and not by_geometry):
            return self.status.setText('레이어와 값 열을 고르세요.')
        if by_geometry and not layer.isSpatial():
            return self.status.setText('도형이 없는 레이어는 도형 위치를 쓸 수 없습니다.')
        if by_geometry and not self.lookups.isChecked():
            return self.status.setText('도형 위치로 필지를 찾으려면 외부 조회를 켜세요.')
        features = layer.getSelectedFeatures() if self.selected.isChecked() else layer.getFeatures()
        # 피처는 화면 스레드에서 읽어 둔다 (작업 스레드는 서버 호출만). 도형 위치 = 피처의 위치(경위도)로 그 지점의 필지
        transform = wgs84(layer) if by_geometry else None
        self.items = [(f, geometry_value(f, transform)) if by_geometry else (f, str(f[field]).strip() if f[field] is not None and str(f[field]).strip() not in ('', 'NULL') else '') for f in features]
        values = [value for _, value in self.items]
        unique = len(set(v for v in values if v))
        if not unique:
            return self.status.setText('변환할 값이 없습니다.')
        target, lookups = server(), self.remember()
        if lookups and target == DEFAULT_SERVER and unique > DAILY:
            self.status.setText(f'서로 다른 값이 {unique}개입니다. 공개 서버의 외부 조회는 하루 {DAILY}줄까지라 앞 {DAILY}개까지만 위치를 찾습니다. 위치가 필요 없으면 외부 조회를 끄세요.')
        # 필지 단위 결과는 그 열을 고르거나 필지 경계 레이어를 만들 때만 묻는다 (필지마다 원천 3번 더)
        details = lookups and (bool(DETAIL_FIELDS & set(self.names())) or self.parcels.isChecked())
        input_type = 'location' if by_geometry else self.input_type.currentData()
        self.start('주소·코드 연계 (geo-web-bridge)', lambda report, canceled: resolve(target, values, input_type, lookups, report, canceled, details=details), lambda result: self.converted(layer, result))

    def converted(self, layer, result):
        results, stopped = result
        same, dots, lots = build_layers(layer, self.items, results, self.names(), self.points.isChecked() and self.points.isEnabled(), self.parcels.isChecked() and self.parcels.isEnabled())
        QgsProject.instance().addMapLayers([x for x in (same, dots, lots) if x is not None])
        rows = list(results.values())
        ok = sum(1 for r in rows if r.get('status') == 'ok')
        pick = sum(1 for r in rows if r.get('status') == 'needs_selection')
        self.status.setText(f'완료: 서로 다른 값 {len(rows)}개 중 정상 {ok}, 후보 선택 필요 {pick}, 그 밖 {len(rows) - ok - pick}. "{same.name()}" 레이어를 추가했습니다.'
                            + (f' 중단: {stopped}' if stopped else ''))

    # 작업 하나 (검색·변환): 진행 막대·취소, 끝나면 done(결과)
    def start(self, title, work, done):
        self.busy(True)
        self.task = task = Job(title, work)
        task.progressChanged.connect(lambda value: (self.bar.setValue(int(value)), self.status.setText(task.message)))
        task.taskCompleted.connect(lambda: (self.busy(False), done(task.result)))
        task.taskTerminated.connect(lambda: (self.busy(False), self.status.setText(task.error or '끝내지 못했습니다.')))
        QgsApplication.taskManager().addTask(task)

    def busy(self, on):
        self.bar.setValue(0)
        self.progress.setVisible(on)
        for button in (self.search_button, self.run_button):
            button.setEnabled(not on)
