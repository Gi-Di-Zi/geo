// 웹 형태 변환 단계의 "방식 고르기" 안내. 방식별 특징 + 유형별 "데이터 상태 → 방식"
// 크기 기준은 어림 (단말·스타일·뷰어에 따라 다름)

import type { Output } from '../types.ts'

export type Way = 'file' | 'server' | 'engine'

export const ways: { id: Way; name: string; text: string; fits: string[]; limits: string[] }[] = [
  {
    id: 'file', name: '파일 방식', text: '결과를 파일로 구워 정적 호스팅. 브라우저가 파일을 직접 읽음.',
    fits: ['갱신 드문 데이터 (연 1회 공개 등)', '서버 운영 없는 배포: 정적 호스팅·CDN', '미리 구운 타일 → 요청마다 연산 없음, 동시 접속에 강함'],
    limits: ['원본이 바뀌면 다시 굽기', '속성 조건 조회 불가 → 받은 범위 안 클라이언트 필터만', '타일 수만~수백만 개 → 올리기·저장 부담 (PMTiles 한 파일로 완화)'],
  },
  {
    id: 'server', name: '서버 방식', text: '떠 있는 서버에 발행. 요청마다 서버가 응답 생성.',
    fits: ['자주 바뀌는 데이터: DB 수정 즉시 반영', '속성 조건 조회: WFS (CQL_FILTER)', 'WMS·WFS 표준 요구: GIS 소프트웨어·타 기관 시스템 연동', '저사양 단말: WMS는 서버가 그림까지 → 브라우저는 이미지만', '접근 권한·사용량 관리'],
    limits: ['서버 상시 운영: 메모리·DB·보안 패치', '요청마다 연산 → 타일 캐시(GeoWebCache 등) 없으면 동시 접속에 약함', '구성 요소 증가: DB + 서버 + 프록시'],
  },
  {
    id: 'engine', name: '엔진 (Cesium for Unreal)', text: '같은 결과 파일(3D Tiles·quantized-mesh)을 언리얼에서 읽음. 엔진 전용 변환 없음.',
    fits: ['화질: 조명·그림자·재질·후처리', '시뮬레이션·VR·다른 3D 에셋과 합성', '브라우저 메모리 한계를 넘는 장면 (데스크톱 GPU)'],
    limits: ['브라우저 밖: 설치형 앱 빌드 또는 Pixel Streaming', 'GPU 필요, 화면 확인 수동', '3D Tiles·지형만. 2D 벡터·영상은 지형 위 덧씌움(WMS·WMTS·XYZ)'],
  },
]

/** 통째 파일이 무거울 때의 순서 (파일·서버 둘 다 있는 확장자만) */
/**
 * 파일 방식 결과에서 내려받을 것 (출력 폴더 기준 path). 타일 {z}/{x}/{y}·3D Tiles·지형은 여러 파일이라 폴더째 zip.
 * name = 받는 파일 이름: 원본 이름 + 결과 확장자 (GeoJSON은 .json 대신 .geojson). 내려받기 API·MCP가 같이 쓰고 check.ts가 검사
 */
export function downloadOf(o: Output, jobName: string) {
  const t = o.path.indexOf('/{')
  // 3D Tiles는 tileset.json이 옆 파일을 가리킴 → 그 폴더째 (맨 위에 있으면 출력 폴더 전체)
  const path = t >= 0 ? o.path.slice(0, t) : o.kind === '3dtiles' ? o.path.replace(/\/?[^/]*$/, '') : o.path
  const zip = t >= 0 || o.kind === '3dtiles' || o.kind === 'quantized-mesh'
  const stem = jobName.replace(/[.][^.]*$/, '') || 'result'
  return { path, zip, name: zip ? `${stem}-${o.id}.zip` : stem + (o.kind === 'geojson' ? '.geojson' : /[.][^./]+$/.exec(path)?.[0] ?? '') }
}

export const heavy ='통째 파일이 무거울 때: ① 타일로 굽기(파일) → 화면 범위 조각만 받음. ② 그래도 브라우저 그리기 부담 → WMS(서버)로 서버가 그림까지. 갱신·조회·연동이 필요하면 크기와 상관없이 서버.'

/** 도구(레시피) 카드: when = 고르는 경우(카드에 보임), pros·cons = ?에 올리면 */
export type ToolNote = { when: string; pros: string[]; cons: string[] }
const oneImage: ToolNote = {
  when: '수 MB 영상 한 장. 그림 + 네 모서리 좌표',
  pros: ['가장 단순: 파일 하나', '타일 굽기 없음 → 준비 빠름', '모든 뷰어 지원'],
  cons: ['통째 로드 → 큰 영상은 느림·메모리 부담', '확대하면 원본 해상도 한계 그대로'],
}
/** 키: 유형/확장자/레시피 → 유형/레시피 → 레시피 순으로 찾는다 (같은 레시피 id라도 유형마다 하는 일이 다름). 검사(check.ts)가 모든 레시피의 항목을 요구 */
export const toolNotes: Record<string, ToolNote> = {
  'vector-2d/gdal': {
    when: '기본값. 표준 GeoJSON + MVT 타일 폴더',
    pros: ['SHP·GPKG·GML·FGB 등 대부분 입력', '좌표계 변환·속성 정리·타일 굽기를 한 도구로', '결과가 정적 파일 → 서버 불필요'],
    cons: ['MVT 폴더 = 파일 수백~수만 개 → 올리기 부담', '줌별 단순화·밀집 제어가 tippecanoe보다 약함', '빈 타일 미생성 → 범위 안 빈 칸은 404'],
  },
  'vector-2d/mvt/gdal': {
    when: '이미 웹 포맷(MVT). 그대로 올리고 Cesium용 GeoJSON만 추출',
    pros: ['변환 없음 → 원본 타일 그대로', 'GDAL이 줌 폴더를 레이어로 읽어 GeoJSON 추출'],
    cons: ['원본 타일의 줌·레이어 구성에 묶임', 'Cesium용 GeoJSON은 타일 경계에서 잘린 도형'],
  },
  'vector-2d/pmtiles/gdal': {
    when: '이미 웹 포맷(PMTiles). 그대로 올리고 Cesium용 GeoJSON만 추출',
    pros: ['변환 없음 → 파일 하나 그대로', 'Range 요청 → 서버 불필요', 'go-pmtiles로 줌·범위·레이어 확인'],
    cons: ['원본 빌드의 레이어 구성 그대로', 'Cesium은 PMTiles 미지원 → GeoJSON 따로'],
  },
  'tippecanoe': {
    when: '피처 많을 때. 줌별 단순화 + PMTiles 한 파일',
    pros: ['줌별 자동 단순화·밀집 피처 솎기', 'PMTiles 한 파일 → 정적 호스팅 + Range 요청', 'GeoJSON·FlatGeobuf 직접 입력'],
    cons: ['SHP·GPKG는 GeoJSON 추출 먼저', 'Cesium 미지원 (벡터타일)', '피처 적으면 최대 줌 추정(-zg)이 낮음 → 줌 지정 필요'],
  },
  'geopandas': {
    when: 'Python 분석 흐름 안에서 변환까지',
    pros: ['pandas로 속성 가공·조인·집계', '분석 코드·노트북과 같은 언어', 'pyogrio(GDAL) 기반 → 입력 포맷은 GDAL과 같음'],
    cons: ['데이터 전체를 메모리에 올림', '벡터타일 없음 → GeoJSON만', '같은 일에 GDAL 명령보다 코드 많음'],
  },
  'vector-2d/postgis': {
    when: '데이터를 PostGIS에서 관리할 때. SQL로 정리·타일까지',
    pros: ['추출·좌표계·정리를 SQL 한 번에', 'ST_AsMVT = martin 등 타일 서버와 같은 방식 → 서버 전환 쉬움', '공간 인덱스로 큰 데이터 처리'],
    cons: ['DB 기동·적재 단계 추가', '파일로 굽는 스크립트 직접 작성 (pg_mvt.py)', '구운 뒤 DB가 바뀌면 다시 실행'],
  },
  'attribute/gdal': {
    when: '기본값. 좌표 열 → 점 GeoJSON + MVT',
    pros: ['X·Y 열 이름 지정만으로 점 생성', 'SQLite 방언으로 필터·형변환', '결과가 정적 파일 → 서버 불필요'],
    cons: ['CSV는 UTF-8만 → CP949는 iconv 먼저', '숫자 열 판별 불안정 → 형변환 직접', 'MVT 폴더 파일 수 많음'],
  },
  'vector-25d/gdal': {
    when: '건물 수천~수만 동. 높이 속성 GeoJSON을 브라우저가 돌출',
    pros: ['파일 하나 → 가장 단순', 'MapLibre fill-extrusion·Deck.gl extruded로 바로', '속성 클릭·필터를 브라우저에서'],
    cons: ['통째 로드 → 수십만 동이면 첫 화면 지연', 'OpenLayers 입체 미지원', '지붕 모양 없음 (높이만 준 상자)'],
  },
  'vector-25d/mago': {
    when: '도시 단위 건물. 높이로 세운 상자를 3D Tiles로',
    pros: ['타일·LOD → 보이는 건물만 로드', 'SHP·GeoJSON + 높이 열 지정으로 바로', 'Deck.gl·CesiumJS 모두 표시'],
    cons: ['MultiPolygon·작은 구멍에 약함 → 전처리 필요', 'Java 실행 → 메모리 설정 필요', 'OpenLayers·MapLibre 미지원'],
  },
  'vector-25d/postgis': {
    when: '건물을 DB에서 관리 + 3D Tiles 배포',
    pros: ['CG_Extrude로 높이 돌출을 SQL에서', 'pg2b3dm: 표 → 3D Tiles 1.1 (속성 포함)', '조건으로 고른 건물만 굽기'],
    cons: ['DB 기동·적재 단계 추가', 'SFCGAL 확장 필요', 'DB가 바뀌면 다시 굽기'],
  },
  'raster/gdal': {
    when: '기본값. COG(OpenLayers 직접) + XYZ 타일(나머지 뷰어)',
    pros: ['COG: 파일 하나 + Range 요청', 'XYZ 타일: 모든 뷰어 공통', '재투영·압축·오버뷰를 명령 한 줄로'],
    cons: ['COG 직접 표시는 OpenLayers만', 'XYZ 타일은 줌마다 4배 증가'],
  },
  'raster/jpg/gdal': oneImage,
  'raster/png/gdal': oneImage,
  'raster/webp/gdal': oneImage,
  'raster/tiles': {
    when: '큰 영상·확대가 많은 화면. 줌별 타일',
    pros: ['보이는 타일만 → 큰 영상도 빠름', '모든 뷰어 공통 XYZ', 'WebP 타일로 용량 축소'],
    cons: ['타일 수천~수만 개', '원본이 바뀌면 다시 굽기'],
  },
  'raster/rio-cogeo': {
    when: 'Python 흐름에서 COG 생성·검증까지',
    pros: ['웹 최적화 프로파일(블록·오버뷰) 기본 제공', 'COG 규칙 검사(validate) 내장', 'rasterio 기반 → Python 코드와 연결'],
    cons: ['결과는 GDAL COG와 같음 → 도구 하나 추가', 'XYZ 타일은 GDAL로 따로'],
  },
  'terrain/gdal-mago': {
    when: '웹 2.5D 지형(Terrain-RGB) + CesiumJS 지형(quantized-mesh) 둘 다',
    pros: ['Terrain-RGB: MapLibre·Deck.gl 지형', 'quantized-mesh: CesiumJS 지형·LOD', '지오이드 보정·최대 줌 지정 (mago 3DTerrainer)'],
    cons: ['결과 두 벌 → 용량·시간 증가', 'mago는 GeoTIFF만 읽음 (.img는 변환 먼저)', 'Terrain-RGB 높이 정밀도 0.1m'],
  },
  'terrain/cesium': {
    when: '이미 quantized-mesh. 그대로 올리기',
    pros: ['변환 없음 → CesiumJS 지형 바로', '원본 LOD·삼각망 그대로'],
    cons: ['CesiumJS 전용 (MapLibre·Deck.gl은 Terrain-RGB 필요)', '타일 파일 수 많음'],
  },
  'pointcloud/mago': {
    when: '기본값. LAS·LAZ를 명령 하나로 3D Tiles',
    pros: ['옥트리 분할·LOD 자동', '16비트 정수 좌표 양자화 → 용량 축소', 'Deck.gl·CesiumJS 모두 표시'],
    cons: ['Java 실행 → 큰 점군은 메모리 설정 필요', '입력 좌표계 지정 필수 (-c)'],
  },
  'py3dtiles': {
    when: 'Python 환경에서 점군 3D Tiles',
    pros: ['pip 설치 → Python 흐름에 통합', '대용량 점군 병렬 처리', '지구 중심 좌표(ECEF) 출력 → 뷰어 배치 정확'],
    cons: ['refine 값 보정 필요 (루트만 REPLACE → Deck.gl 하위 타일 미요청)', '출력 옵션 적음'],
  },
  'pointcloud/tiles': {
    when: '이미 3D Tiles(pnts). 그대로 올리기',
    pros: ['변환 없음 → 손실 없음', 'Deck.gl·CesiumJS 모두 표시'],
    cons: ['3D Tiles 1.0 그대로 (1.1 변환 불가: DOUBLE 배치 속성)'],
  },
  'mago': {
    when: '3D 모델을 명령 하나로 3D Tiles. LOD 자동',
    pros: ['CityGML·IFC·glTF 등 입력 → 3D Tiles 한 도구로', '단순화 단계(LOD)·타일 분할 자동', '국내 개발(Gaia3D) 오픈소스'],
    cons: ['Java 실행 → 큰 입력은 메모리 설정 필요', '한 번에 변환 → 중간 결과 확인·수정 어려움', '좌표계·축 옵션 직접 지정 (-c, -rx 등)'],
  },
  'model-3d/cjio': {
    when: 'CityGML 처리를 단계별로 확인·제어할 때',
    pros: ['CityJSON을 거쳐 단계마다 검사·수정', '원점 이동·glb 압축 직접 제어', '전부 오픈소스 CLI'],
    cons: ['도구 3~4개 연결 → 단계 많음', '타일 분할·LOD 없음 (glb 하나) → 큰 도시엔 부적합', '속성 대부분 glb로 안 옮겨짐'],
  },
  'model-3d/3dcitydb': {
    when: 'CityGML 속성 조회·갱신. 원본은 DB, 배포는 3D Tiles',
    pros: ['CityGML 표준 DB 스키마 → 속성·LOD 보존', 'SQL로 건물 선택·집계', 'pg2b3dm: DB → 3D Tiles 1.1'],
    cons: ['DB 기동·적재 무거움', '스키마 복잡 (면 집계 SQL 필요)', 'DB가 바뀌면 다시 굽기'],
  },
  'model-3d/3d-tiles-tools': {
    when: '단일 모델 몇 개. 압축 + 위치 지정만',
    pros: ['재질·텍스처 원형 유지', 'meshopt·WebP 압축 → 용량 대폭 축소', 'glb(Deck.gl) + 위치 내장 타일셋(Cesium) 함께'],
    cons: ['타일 분할·LOD 없음 → 큰 모델은 통째 로드', '여러 모델 배치는 직접 구성'],
  },
  'model-3d/tiles': {
    when: '이미 3D Tiles(i3dm). 그대로 올리기',
    pros: ['변환 없음 → 손실 없음', '모델 한 벌 + 위치 목록 → 반복 배치에 가벼움'],
    cons: ['i3dm(1.0) → CesiumJS만 표시', '모델 상대 경로 → 폴더 구조 유지 필요'],
  },
  'model-3d/upgrade': {
    when: '3D Tiles 1.1 규격이 필요할 때 (i3dm → glTF 인스턴싱)',
    pros: ['타일 전부 glb → 뷰어의 i3dm 전용 해석 불필요', 'EXT_mesh_gpu_instancing: 1.1 표준 인스턴싱'],
    cons: ['Deck.gl은 인스턴싱 확장 미지원 → CesiumJS만', '외부 모델 경로 정리 필요 (도구 0.5.4 경로 해석)'],
  },
  'indoor-bim/ifcconvert': {
    when: '건물 1동 형상만. IFC → glb',
    pros: ['IfcOpenShell 기반 → IFC 형상 해석 정확', 'glb 압축으로 용량 축소', '단계마다 결과 확인 쉬움'],
    cons: ['부재 속성(층·실·설비) 손실', '타일 분할·LOD 없음', '도구 3개 연결'],
  },
  'geoserver': {
    when: 'WMS·WFS·OGC API 표준 연동, 속성 조회, DB 수정 즉시 반영',
    pros: ['WMS·WMTS·WFS 표준 → GIS 소프트웨어·타 기관 연동', 'OGC API Features: WFS 후속, 주소만으로 GeoJSON', 'SLD로 서버에서 스타일', '국내 현장 사용 많음'],
    cons: ['Java 서버 상시 운영', '설정 단계 많음 (작업공간·저장소·스타일·레이어)', '타일 캐시 없으면 요청마다 그림'],
  },
  'raster/geoserver': {
    when: '모자이크·주기 갱신·색 바꾸기. 원본 COG를 서버가 잘라 그림',
    pros: ['원본 COG 그대로 → 타일 굽기 없음', 'SLD ColorMap으로 색을 서버에서', 'WMS·WMTS로 모든 뷰어'],
    cons: ['서버 상시 운영', '요청마다 연산 → 타일 캐시 필요'],
  },
  'terrain/geoserver': {
    when: '음영기복·고도 색 지도만 (입체 불필요)',
    pros: ['ShadedRelief·ColorMap을 서버에서', '2D 뷰어(OpenLayers)도 지형 표현', '높이 값 원본 유지'],
    cons: ['입체 지형 아님 (그림)', '서버 상시 운영'],
  },
  'martin': {
    when: 'PostGIS 표를 바로 벡터타일로. DB 수정 즉시 반영',
    pros: ['Rust → 가볍고 빠름', '설정 거의 없음 (표 자동 발견)', 'MVT → 스타일은 브라우저에서'],
    cons: ['시작할 때만 표 탐색 → 새 표는 재시작', 'MVT만 (WMS·WFS 없음)', 'Cesium 미지원 (벡터타일)'],
  },
}
export const noteOf = (category: string, format: string, recipe: string): ToolNote | undefined =>
  toolNotes[`${category}/${format}/${recipe}`] ?? toolNotes[`${category}/${recipe}`] ?? toolNotes[recipe]

type Row = { when: string; way: Way; why: string }
/** 유형별 데이터 상태 → 방식. 화면은 그 확장자가 제공하는 방식의 줄만 보인다 */
export const byCategory: Record<string, { rows: Row[] }> = {
  'vector-2d': {
    rows: [
      { when: '수 MB 이하 · 피처 수만 개 이하', way: 'file', why: 'GeoJSON 통째: 한 번 받고 끝. 클릭·필터를 브라우저에서 바로.' },
      { when: '수십 MB 이상 · 피처 수십만 개', way: 'file', why: 'MVT·PMTiles: 줌·화면 범위 타일만. 통째 GeoJSON은 파싱·메모리로 첫 화면 지연.' },
      { when: '서버 없이 큰 데이터 배포', way: 'file', why: 'PMTiles 한 파일 + Range 요청. 타일 수만 개 올리기 없음.' },
      { when: '자주 갱신 (DB에서 관리)', way: 'server', why: 'martin: PostGIS 테이블을 요청 때 MVT로. 수정 즉시 반영.' },
      { when: '속성 조회 · 표준 연동', way: 'server', why: 'GeoServer WFS(조건 조회)·WMS(서버 그림). QGIS·타 시스템 연동.' },
    ],
  },
  'vector-25d': {
    rows: [
      { when: '건물 수천~수만 동', way: 'file', why: 'GeoJSON + 돌출 (MapLibre fill-extrusion·Deck.gl extruded). 높이 속성만 있으면 충분.' },
      { when: '도시 단위 수십만 동', way: 'file', why: '3D Tiles (mago·pg2b3dm): 높이로 세운 상자를 타일·LOD로. 보이는 타일만.' },
      { when: '자주 갱신 · 높이 색 지도만', way: 'server', why: 'GeoServer WMS 또는 martin MVT(돌출은 브라우저). PostGIS 수정 즉시 반영.' },
      { when: '도시 배경 (지형·영상과 함께)', way: 'engine', why: '같은 3D Tiles 사용. 단독으로는 보통 불필요 — 높이만 준 상자라 화질 이득 적음 (노선도에서 제외).' },
    ],
  },
  'raster': {
    rows: [
      { when: '단일 영상 수 MB (jpg·png·webp + 월드파일)', way: 'file', why: '그림 한 장 + 네 모서리 좌표. 타일 불필요.' },
      { when: '수십 MB~GB 영상', way: 'file', why: 'COG: Range 요청으로 필요한 블록·해상도만. OpenLayers 직접, 그 외 뷰어는 XYZ 타일.' },
      { when: '모든 뷰어 공통 · CDN 배포', way: 'file', why: 'XYZ 타일 굽기: z/x/y PNG. 줌 1단계마다 타일 수 4배.' },
      { when: '여러 장 모자이크 · 주기 갱신 · 색 바꾸기', way: 'server', why: 'GeoServer WMS·WMTS: 원본 COG를 두고 요청 때 잘라 그림. 색 지도(SLD)는 서버에서.' },
    ],
  },
  'terrain': {
    rows: [
      { when: '웹 2.5D 지형 (MapLibre·Deck.gl)', way: 'file', why: 'Terrain-RGB 타일: 높이를 RGB에 담은 PNG. 뷰어가 메시 생성.' },
      { when: '지구본 지형 (CesiumJS)', way: 'file', why: 'quantized-mesh: 미리 만든 삼각망 + LOD. 지형 위에 3D Tiles·영상 얹기.' },
      { when: '음영기복도·고도 색 지도만 (입체 불필요)', way: 'server', why: 'GeoServer WMS (ShadedRelief·ColorMap): 2D 뷰어 포함 모든 뷰어.' },
      { when: '고화질 지형 장면 · 시뮬레이션', way: 'engine', why: 'Cesium for Unreal: 같은 quantized-mesh + 영상 덧씌움 + 조명·대기.' },
    ],
  },
  'pointcloud': {
    rows: [
      { when: 'LAS·LAZ 원본', way: 'file', why: '3D Tiles (pnts·glTF 점): 옥트리 LOD로 보이는 점만. 원본 통째 로드는 수백만 점부터 첫 화면 지연·메모리 부담.' },
      { when: '수억 점 · 고화질 표현', way: 'engine', why: 'Cesium for Unreal: 같은 3D Tiles를 데스크톱 GPU로. 점 감쇠(attenuation)·조명.' },
    ],
  },
  'model-3d': {
    rows: [
      { when: '단일 모델 수 MB (glb·gltf)', way: 'file', why: 'glb 통째 + 위치·방향 지정. 가장 단순.' },
      { when: '여러 동 · 고해상 텍스처 (수십 MB 이상)', way: 'file', why: '3D Tiles: 타일 분할·LOD. 보이는 것만.' },
      { when: '같은 모델 반복 배치 (가로수·가로등)', way: 'file', why: 'i3dm(1.0)·EXT_mesh_gpu_instancing(1.1): 모델 한 벌 + 위치 목록.' },
      { when: 'CityGML 속성 조회·갱신', way: 'file', why: '3DCityDB(PostGIS)에 적재 → pg2b3dm으로 3D Tiles 굽기. 원본은 DB, 결과는 파일 → 갱신 시 다시 굽기.' },
      { when: '고화질 · 시뮬레이션 · VR', way: 'engine', why: 'Cesium for Unreal: 같은 3D Tiles. 재질·조명·그림자.' },
    ],
  },
  'indoor-bim': {
    rows: [
      { when: '건물 1동 · 형상만', way: 'file', why: 'glb 또는 3D Tiles (IfcConvert·mago).' },
      { when: '여러 동 · 단지 BIM', way: 'file', why: '3D Tiles 타일 분할·LOD. glb 통째는 수백 MB부터 첫 화면 지연.' },
      { when: '부재 속성(층·실·설비) 필요', way: 'file', why: 'IFC 속성을 3D Tiles 속성(배치 테이블·1.1 메타데이터)으로 옮기기. 형상만 옮기면 속성 손실.' },
      { when: '실내 이동 · VR · 설비 시뮬레이션', way: 'engine', why: 'Cesium for Unreal: 같은 3D Tiles. 1인칭 이동·충돌·조명.' },
    ],
  },
  'attribute': {
    rows: [
      { when: '좌표 있는 표 · 수만 행', way: 'file', why: 'GeoJSON 점으로 바꿔 통째.' },
      { when: '수십만 행 이상 (전국)', way: 'file', why: 'MVT 타일: 줌별 점 솎기. 통째 GeoJSON은 첫 화면 지연.' },
      { when: '자주 갱신 (운영 DB의 표)', way: 'server', why: 'PostGIS 적재 → martin MVT·GeoServer WMS. 표 수정 즉시 반영.' },
      { when: '조건 조회 (기관·노선별)', way: 'server', why: 'GeoServer WFS CQL_FILTER: 조건에 맞는 행만 응답.' },
    ],
  },
}
