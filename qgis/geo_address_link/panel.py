# 주소·코드 연계 패널 (QGIS 오른쪽 도킹). 두 탭:
#  속성 표 = 레이어의 한 열(또는 도형 위치)을 변환해 그 레이어 속성 표에 결과 열 추가(편집 모드, 저장은 사용자가) 또는 열을 붙인 새 레이어로
#  직접 검색 = 웹처럼 주소·코드·좌표를 넣거나 지도를 찍어 결과를 패널에서 보고, 원하면 점·필지 레이어로
# 탭 아래 외부 조회 켬·끔과 기준자료(법정동·행정동 사전)의 마지막 확인·변경 시각. 상태·진행은 QGIS 지도 위 메시지 줄
# 서버는 배포 서버. 개발·시험만 QGIS 고급 설정 geo_address_link/server_override (npm run qgis:dev·시험이 넣는다)
from datetime import datetime, timedelta, timezone

from qgis.core import (Qgis, QgsApplication, QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsFeature, QgsMapLayerProxyModel,
                       QgsProject, QgsSettings, QgsVectorLayer)
from qgis.gui import QgsCheckableComboBox, QgsDockWidget, QgsFieldComboBox, QgsMapLayerComboBox, QgsMapToolEmitPoint
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QGuiApplication
from qgis.PyQt.QtWidgets import (QCheckBox, QComboBox, QFormLayout, QHBoxLayout, QPlainTextEdit, QTabWidget, QToolButton, QTreeWidget,
                                 QTreeWidgetItem, QVBoxLayout, QWidget)

from .core import (ALWAYS, DETAIL_FIELDS, FIELDS, GROUPS, INPUT_TYPES, SEARCH_LIMIT, STATUS, add_columns, build_layers, geometry_value, reference_status,
                   resolve, row_values, search, wgs84, writable)
from .ui import Job, Status, button, dock_body, enum, narrow, note

SETTINGS = 'geo_address_link'
DEFAULT_SERVER = 'https://geospatial.kro.kr'
DAILY = 2000
# 도형 없는 표도 (QGIS 3.34부터 Qgis.LayerFilter)
LAYERS = Qgis.LayerFilter.VectorLayer if hasattr(Qgis, 'LayerFilter') else QgsMapLayerProxyModel.VectorLayer
ALL_NAMES = ALWAYS + [name for _, names, _ in GROUPS for name in names]
TARGETS = [('inplace', '이 레이어 속성 표에 열 추가'), ('new', '열을 붙인 새 레이어')]
KST = timezone(timedelta(hours=9))


def server():
    """배포 서버 (사용자 화면에는 없다). 개발·시험은 고급 설정 server_override"""
    return (QgsSettings().value(f'{SETTINGS}/server_override', '') or DEFAULT_SERVER).rstrip('/')


def when(value):
    """ISO 시각 → 한국 시간 '2026-11-06 17:01'"""
    if not value:
        return '없음'
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(KST).strftime('%Y-%m-%d %H:%M')


class Panel(QgsDockWidget):
    def __init__(self, iface):
        super().__init__('주소·코드 연계', iface.mainWindow())
        self.setObjectName('geo_address_link_panel')
        self.iface, self.task, self.items, self.lines, self.found, self.checking = iface, None, [], [], {}, None
        settings = QgsSettings()

        # 속성 표 탭
        self.layer = QgsMapLayerComboBox()
        self.layer.setFilters(LAYERS)
        self.field = QgsFieldComboBox()
        self.field.setLayer(self.layer.currentLayer())
        self.layer.layerChanged.connect(self.field.setLayer)
        self.input_type = QComboBox()
        for value, text in INPUT_TYPES:
            self.input_type.addItem(text, value)
        self.selected = QCheckBox('선택한 피처만')
        # 붙일 결과 묶음 (외부 조회가 필요한 묶음은 외부 조회를 끄면 흐리게)
        self.groups = QgsCheckableComboBox()
        self.groups.setDefaultText('처리 상태·확인 사항만')
        for i, (title, _, _) in enumerate(GROUPS):
            self.groups.addItemWithCheckState(title, enum(Qt, 'CheckState', 'Checked'), i)
        self.groups.setToolTip('처리 상태·확인 사항 열은 항상 붙습니다. 위치·도로명주소·건물·필지·토지 속성은 외부 조회가 필요합니다.')
        self.target = QComboBox()
        for value, text in TARGETS:
            self.target.addItem(text, value)
        self.target.setCurrentIndex(max(self.target.findData(settings.value(f'{SETTINGS}/target', 'inplace')), 0))
        self.target.setToolTip('속성 표에 추가: 편집 모드로 넣습니다. 확인한 뒤 편집 저장, 되돌리려면 편집 취소. 결과 열이 이미 있으면 값만 바꿉니다.\n'
                               'CSV 텍스트처럼 열을 더할 수 없는 레이어는 새 레이어로 만듭니다.')
        for combo in (self.layer, self.field, self.input_type, self.groups, self.target):
            narrow(combo)
        self.points = QCheckBox('위치 점')
        self.points.setToolTip('찾은 위치(경도·위도)로 점 레이어를 함께 만듭니다 (EPSG:4326). 도형 없는 표를 웹 지도로 만들 때 이 레이어를 씁니다.')
        self.points.setChecked(True)
        self.parcels = QCheckBox('필지 경계')
        self.parcels.setToolTip('연속지적도(참고 도면)의 필지 경계로 면 레이어를 함께 만듭니다 (EPSG:4326)')
        extra = QHBoxLayout()
        extra.addWidget(self.points)
        extra.addWidget(self.parcels)
        extra.addStretch(1)
        form = QFormLayout()
        form.addRow('레이어', self.layer)
        form.addRow('값 열', self.field)
        form.addRow('입력 종류', self.input_type)
        form.addRow('', self.selected)
        form.addRow('붙일 결과', self.groups)
        form.addRow('넣을 곳', self.target)
        form.addRow('함께 만들기', extra)
        self.run_button = button('결과 열 붙이기', '/mActionStart.svg')
        self.run_button.clicked.connect(self.convert_layer)
        run_row = QHBoxLayout()
        run_row.addStretch(1)
        run_row.addWidget(self.run_button)
        layer_tab = QWidget()
        layer_box = QVBoxLayout(layer_tab)
        layer_box.addLayout(form)
        layer_box.addLayout(run_row)
        layer_box.addStretch(1)

        # 직접 검색 탭
        self.query = QPlainTextEdit()
        self.query.setPlaceholderText(f'주소, PNU, 법정동·행정동 코드, 좌표(경도, 위도)\n한 줄에 하나, 최대 {SEARCH_LIMIT}줄')
        self.query.setFixedHeight(self.query.fontMetrics().lineSpacing() * 4 + 14)
        self.pick_button = QToolButton()
        self.pick_button.setText('지도에서 찍기')
        self.pick_button.setIcon(QgsApplication.getThemeIcon('/mActionIdentify.svg'))
        self.pick_button.setToolButtonStyle(enum(Qt, 'ToolButtonStyle', 'ToolButtonTextBesideIcon'))
        self.pick_button.setCheckable(True)
        self.pick_button.setToolTip('지도를 누르면 그 지점의 필지를 찾습니다 (외부 조회 필요)')
        self.pick_button.toggled.connect(self.pick)
        self.picker = QgsMapToolEmitPoint(iface.mapCanvas())
        self.picker.canvasClicked.connect(self.picked)
        self.picker.deactivated.connect(lambda: self.pick_button.setChecked(False))
        self.search_button = button('검색', '/search.svg')
        self.search_button.clicked.connect(self.search_lines)
        search_row = QHBoxLayout()
        search_row.addWidget(self.pick_button)
        search_row.addStretch(1)
        search_row.addWidget(self.search_button)
        self.tree = QTreeWidget()
        self.tree.setColumnCount(2)
        self.tree.setHeaderHidden(True)
        # 항목 칸은 가장 긴 이름 폭으로 고정, 나머지는 값 (긴 값은 툴팁). 두 번 누르면 복사
        self.tree.setColumnWidth(0, self.tree.fontMetrics().horizontalAdvance('공시지가(원/㎡)') + 40)
        self.tree.setAlternatingRowColors(True)
        self.tree.setMinimumHeight(240)
        self.tree.setToolTip('값을 두 번 누르면 복사합니다')
        self.tree.itemDoubleClicked.connect(self.copy_value)
        self.tree.hide()
        self.add_button = button('점·필지 레이어로 추가', '/mActionAddLayer.svg')
        self.add_button.clicked.connect(self.add_search_layers)
        self.add_button.hide()
        add_row = QHBoxLayout()
        add_row.addStretch(1)
        add_row.addWidget(self.add_button)
        self.search_tab = QWidget()
        search_box = QVBoxLayout(self.search_tab)
        search_box.addWidget(self.query)
        search_box.addLayout(search_row)
        search_box.addWidget(self.tree)
        search_box.addLayout(add_row)
        search_box.addStretch(1)

        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        self.tabs.addTab(layer_tab, QgsApplication.getThemeIcon('/mActionOpenTable.svg'), '속성 표')
        self.tabs.addTab(self.search_tab, QgsApplication.getThemeIcon('/search.svg'), '직접 검색')

        # 두 탭 공통: 외부 조회, 기준자료 시각
        self.lookups = QCheckBox('외부 조회 (VWorld: 위치·건물·필지·토지 속성)')
        self.lookups.setToolTip('위치·우편번호·도로명주소·건물·필지·토지 속성을 VWorld에서 찾습니다. 20줄씩, 공개 서버는 접속자별 하루 2,000줄. 끄면 코드 사전만으로 빠르게 바꿉니다.')
        self.lookups.setChecked(settings.value(f'{SETTINGS}/lookups', 'true') == 'true')
        self.lookups.toggled.connect(self.sync)
        self.reference = note('기준자료 상태를 읽는 중…')
        self.reference.setToolTip('법정동·행정동 코드 사전. 서버가 한국 시간 기준 하루 한 번 공식 제공처를 확인하고, 원본이 같으면 다시 적용하지 않습니다.')
        shared = QVBoxLayout()
        shared.setContentsMargins(9, 0, 9, 9)
        shared.addWidget(self.lookups)
        shared.addWidget(self.reference)

        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.tabs)
        layout.addLayout(shared)
        layout.addStretch(1)
        self.status = Status(iface.messageBar(), '주소·코드 연계')
        self.setWidget(dock_body(content))
        if server() != DEFAULT_SERVER:
            self.status.say(f'개발 서버: {server()}')
        self.sync()
        self.fetch_reference()

    def sync(self):
        on = self.lookups.isChecked()
        self.points.setEnabled(on)
        self.parcels.setEnabled(on)
        self.pick_button.setEnabled(on)
        for i, (_, _, external) in enumerate(GROUPS):
            if external:
                self.groups.model().item(i).setEnabled(on)

    def remember(self):
        """외부 조회 켬·끔과 결과 넣을 곳을 다음에도 (검색·변환할 때만 저장)"""
        on = self.lookups.isChecked()
        QgsSettings().setValue(f'{SETTINGS}/lookups', 'true' if on else 'false')
        QgsSettings().setValue(f'{SETTINGS}/target', self.target.currentData())
        return on

    def names(self):
        on = self.lookups.isChecked()
        return ALWAYS + [name for i in self.groups.checkedItemsData() if on or not GROUPS[int(i)][2] for name in GROUPS[int(i)][1]]

    # 기준자료 시각
    def fetch_reference(self):
        target = server()
        self.checking = job = Job('기준자료 상태 (geo-web-bridge)', lambda report, canceled: reference_status(target))
        job.taskCompleted.connect(lambda: self.show_reference(job.result))
        job.taskTerminated.connect(lambda: self.reference.setText('기준자료 상태를 읽지 못했습니다.'))
        QgsApplication.taskManager().addTask(job)

    def show_reference(self, status):
        self.reference.setText(f'기준자료 확인 {when(status.get("lastCheckedAt"))} · 변경 {when(status.get("lastUpdatedAt"))}')

    # 직접 검색
    def search_lines(self):
        lines = list(dict.fromkeys(line.strip() for line in self.query.toPlainText().splitlines() if line.strip()))
        if not lines:
            return self.status.say('찾을 주소나 코드를 넣으세요.', 'warn')
        if len(lines) > SEARCH_LIMIT:
            return self.status.say(f'한 번에 {SEARCH_LIMIT}줄까지 찾습니다. 많은 값은 속성 표 탭을 쓰세요.', 'warn')
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
        self.tabs.setCurrentWidget(self.search_tab)
        self.query.setPlainText(f'{spot.x():.7f}, {spot.y():.7f}')
        self.search_lines()

    def show_results(self, lines, found):
        self.lines, self.found = lines, found
        self.tree.clear()
        bold = self.tree.font()
        bold.setBold(True)
        for value in lines:
            row = found.get(value)
            values = row_values(row)
            shown = {**((row or {}).get('output') or {}), 'note': values['note']}
            # 입력 줄은 두 칸을 가로질러: 상태 아이콘 + 입력 — 상태
            top = QTreeWidgetItem([f'{value}  —  {STATUS.get(values["status"], values["status"])}'])
            top.setIcon(0, QgsApplication.getThemeIcon('/mIconSuccess.svg' if values['status'] == 'ok' else '/mIconWarning.svg'))
            top.setFont(0, bold)
            top.setToolTip(0, value)
            for _, alias, key, _ in FIELDS:
                text = str(shown.get(key) or '')
                if key != 'status' and text:
                    item = QTreeWidgetItem(top, [alias, text])
                    item.setToolTip(1, text)
            self.tree.addTopLevelItem(top)
            top.setFirstColumnSpanned(True)
        self.tree.expandAll()
        self.tree.show()
        self.add_button.setVisible(self.lookups.isChecked())
        ok = sum(1 for r in found.values() if r.get('status') == 'ok')
        self.status.say(f'{len(lines)}줄 중 정상 {ok}.', 'ok' if ok == len(lines) else 'warn')

    def copy_value(self, item, _column=0):
        text = item.text(1) if item.parent() else item.toolTip(0)
        QGuiApplication.clipboard().setText(text)
        self.status.say(f'복사함: {text}')

    def add_search_layers(self):
        """검색 결과 → 점 레이어(위치)·필지 경계 레이어. 결과 열은 속성 표 탭과 같다"""
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
            return self.status.say('위치나 필지 경계가 있는 결과가 없습니다.', 'warn')
        QgsProject.instance().addMapLayers(added)
        self.iface.setActiveLayer(added[0])
        self.iface.zoomToActiveLayer()
        self.status.say('추가함: ' + ', '.join(f'"{layer.name()}"' for layer in added), 'ok')

    # 속성 표
    def convert_layer(self):
        layer, field = self.layer.currentLayer(), self.field.currentField()
        by_geometry = self.input_type.currentData() == 'geometry'
        if not layer or (not field and not by_geometry):
            return self.status.say('레이어와 값 열을 고르세요.', 'warn')
        if by_geometry and not layer.isSpatial():
            return self.status.say('도형이 없는 레이어는 도형 위치를 쓸 수 없습니다.', 'warn')
        if by_geometry and not self.lookups.isChecked():
            return self.status.say('도형 위치로 필지를 찾으려면 외부 조회를 켜세요.', 'warn')
        features = layer.getSelectedFeatures() if self.selected.isChecked() else layer.getFeatures()
        # 피처는 화면 스레드에서 읽어 둔다 (작업 스레드는 서버 호출만). 도형 위치 = 피처의 위치(경위도)로 그 지점의 필지
        transform = wgs84(layer) if by_geometry else None
        self.items = [(f, geometry_value(f, transform)) if by_geometry else (f, str(f[field]).strip() if f[field] is not None and str(f[field]).strip() not in ('', 'NULL') else '') for f in features]
        values = [value for _, value in self.items]
        unique = len(set(v for v in values if v))
        if not unique:
            return self.status.say('변환할 값이 없습니다.', 'warn')
        target, lookups = server(), self.remember()
        # 공개 서버의 외부 조회 하루 한도를 넘는 양이면 끝 메시지에 함께 알린다
        notice = f' 서로 다른 값이 {unique}개라 공개 서버의 외부 조회 하루 한도({DAILY}줄)를 넘습니다. 위치가 필요 없으면 외부 조회를 끄세요.' \
            if lookups and target == DEFAULT_SERVER and unique > DAILY else ''
        # 필지 단위 결과는 그 열을 고르거나 필지 경계 레이어를 만들 때만 묻는다 (필지마다 원천 3번 더)
        details = lookups and (bool(DETAIL_FIELDS & set(self.names())) or self.parcels.isChecked())
        input_type = 'location' if by_geometry else self.input_type.currentData()
        inplace = self.target.currentData() == 'inplace' and writable(layer)
        self.start('주소·코드 연계 (geo-web-bridge)', lambda report, canceled: resolve(target, values, input_type, lookups, report, canceled, details=details),
                   lambda result: self.converted(layer, inplace, result, notice))

    def converted(self, layer, inplace, result, notice=''):
        results, stopped = result
        same, dots, lots = build_layers(layer, self.items, results, self.names(), self.points.isChecked() and self.points.isEnabled(),
                                        self.parcels.isChecked() and self.parcels.isEnabled(), copy=not inplace)
        if inplace:
            add_columns(layer, self.items, results, self.names())
            where = f'"{layer.name()}" 속성 표에 결과 열을 넣었습니다 (편집 중: 확인 후 편집 저장, 되돌리려면 편집 취소).'
        else:
            where = f'"{same.name()}" 레이어를 추가했습니다' + (' (열을 더할 수 없는 레이어라 새 레이어로).' if self.target.currentData() == 'inplace' else '.')
        extra = [x for x in (dots, lots) if x is not None]
        QgsProject.instance().addMapLayers([x for x in (same, *extra) if x is not None])
        rows = list(results.values())
        ok = sum(1 for r in rows if r.get('status') == 'ok')
        pick = sum(1 for r in rows if r.get('status') == 'needs_selection')
        self.status.say(f'완료: 서로 다른 값 {len(rows)}개 중 정상 {ok}, 후보 선택 필요 {pick}, 그 밖 {len(rows) - ok - pick}. {where}'
                        + (' 함께 추가: ' + ', '.join(f'"{x.name()}"' for x in extra) if extra else '')
                        + (f' 중단: {stopped}' if stopped else '') + notice, 'ok' if ok == len(rows) and not stopped else 'warn')

    # 작업 하나 (검색·변환): 메시지 줄에 진행·취소, 끝나면 done(결과)
    def start(self, title, work, done):
        self.busy(True)
        self.task = task = Job(title, work)
        self.status.working('시작하는 중…', task.cancel)
        task.progressChanged.connect(lambda value: self.status.step(task.message, value))
        task.taskCompleted.connect(lambda: (self.busy(False), done(task.result)))
        task.taskTerminated.connect(lambda: (self.busy(False), self.status.say(task.error or '끝내지 못했습니다.', 'error')))
        QgsApplication.taskManager().addTask(task)

    def busy(self, on):
        for widget in (self.search_button, self.run_button):
            widget.setEnabled(not on)
