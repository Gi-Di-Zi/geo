import type { FormatSpec, Step } from '../../types.ts'
import { serverRecipes } from '../_server.ts'
import { geopandasRecipe, vectorRecipe, vectorUpload } from '../vector-2d/_vector.ts'

const RAW = '/raw/molit_bus_stops.csv'
/** 업로드 CSV의 좌표 열 이름. GDAL CSV X/Y_POSSIBLE_NAMES 규칙(대소문자 무시, 앞뒤 * 와일드카드). 업로드 판별(shared/sniff.ts)도 같은 목록 */
export const XY_NAMES = { x: ['경도', 'lon*', 'lng', 'x', 'x좌표', '*_x'], y: ['위도', 'lat*', 'y', 'y좌표', '*_y'] }
// 위도·경도 열이 텍스트라 빈 칸·뒤바뀐 값이 섞여 있다. 한국 범위(위도 33~39, 경도 124~132) 밖은 버린다
const IN_KOREA = 'CAST(위도 AS REAL) BETWEEN 33 AND 39 AND CAST(경도 AS REAL) BETWEEN 124 AND 132'

// 파일 레시피(GDAL)와 서버 레시피(GeoServer·martin)가 같이 쓰는 전처리
const preprocess: Step[] = [
  {
    title: 'UTF-8 변환',
    why: '원본 파일 이름 표기 EUCKR(= CP949). GDAL CSV 드라이버는 UTF-8 기준 → 그대로 읽으면 한글 열 이름·값 깨짐. head: 머리글·첫 행 확인.',
    tool: 'gdal',
    run: `iconv -f CP949 -t UTF-8 ${RAW} > /work/stops.csv && head -3 /work/stops.csv`,
  },
  {
    title: '무결성 확인',
    why: 'X·Y_POSSIBLE_NAMES: 경도·위도 열을 점 좌표로 읽기(GDAL CSV 드라이버). 전국 227,065행. 범위(Extent) x 최솟값 33·y 최댓값 127 → 위도·경도 뒤바뀐 행 존재. Layer SRS 없음: CSV에는 좌표계 정보 없음.',
    tool: 'gdal',
    run: 'ogrinfo -so -al -oo X_POSSIBLE_NAMES=경도 -oo Y_POSSIBLE_NAMES=위도 /work/stops.csv',
  },
  {
    title: '무결성 확인 (좌표 이상 행)',
    why: '좌표가 숫자 아닌 텍스트 → 빈 칸·한국 범위 밖 행을 도시별로 집계. 대전 5·제주 1: 위도·경도 뒤바뀜, 세종 6: 빈 칸 5 + 위도·경도 같은 값 1.',
    tool: 'gdal',
    run: `ogrinfo -q /work/stops.csv -dialect SQLite -sql "SELECT 도시명, count(*) AS rows FROM stops WHERE 위도 = '' OR 경도 = '' OR NOT (${IN_KOREA}) GROUP BY 도시명"`,
  },
  {
    title: '무결성 확인 (중복 등록)',
    why: '관리도시명: 정류장을 등록한 버스정보시스템(BIS). 서울 정류장을 경기BIS도 따로 등록 → 경기BIS 행 중 서울BIS와 같은 단축번호(ARS) 수 집계. 같은 정류장이 두 점으로 겹침.',
    tool: 'gdal',
    run: `ogrinfo -q /work/stops.csv -dialect SQLite -sql "SELECT count(*) AS 경기BIS, sum(모바일단축번호 IN (SELECT 모바일단축번호 FROM stops WHERE 관리도시명 = '서울BIS')) AS 같은_단축번호 FROM stops WHERE 관리도시명 = '경기BIS' AND 도시명 = '서울특별시'"`,
  },
  {
    title: '서울BIS 정류장 점 만들기',
    why: 'MakePoint(경도, 위도, 4326): 텍스트 좌표 → 위경도 점. WHERE 범위: 이상 좌표 행 제외. 관리도시명 서울BIS: 중복 없이 한쪽만(서울 버스가 서는 경기·인천 일부 포함, 경기BIS에만 있는 광역 정류장은 빠짐). AS: 한글 열 → 영문. -nlt POINT: 도형 종류 고정.',
    tool: 'gdal',
    run: `ogr2ogr -f GPKG /work/stops.gpkg /work/stops.csv -nln stops -nlt POINT -dialect SQLite -sql "SELECT MakePoint(CAST(경도 AS REAL), CAST(위도 AS REAL), 4326) AS geom, 정류장번호 AS id, 정류장명 AS name, 모바일단축번호 AS ars FROM stops WHERE 관리도시명 = '서울BIS' AND ${IN_KOREA}"`,
  },
]

export default {
  id: 'csv',
  category: 'attribute',
  name: 'CSV',
  extensions: ['.csv'],
  summary: '쉼표로 열을 나눈 텍스트 표. 위경도 열이 있으면 점으로 지도에 표시.',
  description: 'Comma-Separated Values. 엑셀·DB 내보내기의 기본 형식, 공공데이터포털 파일데이터 대부분이 CSV. 한계: 도형·좌표계 정보 없음 → 좌표 열과 좌표계를 직접 지정. 글자 인코딩 표기 없음(국내 공공 CSV는 CP949가 흔함). 값이 모두 텍스트 → 빈 칸·뒤바뀐 좌표 검증 필요.',
  anatomy: [
    { name: '머리글 행', role: '첫 줄. 열 이름 (정류장번호, 위도, 경도 …)' },
    { name: '데이터 행', role: '한 줄에 한 건. 쉼표로 값 구분, 쉼표가 든 값은 큰따옴표로 감쌈' },
    { name: '좌표 열', role: '위도·경도(또는 X·Y) 숫자 텍스트. 좌표계는 파일 밖 설명 문서에만' },
  ],
  convertible: true,
  collect: {
    source: 'datagokr',
    dataset: '국토교통부 전국 버스정류장 위치정보 15067528',
    url: 'https://www.data.go.kr/data/15067528/fileData.do',
    how: '공공데이터포털 CSV 한 파일. 전국 버스정류장 22만 7천 곳(20MB), 위도·경도 열 포함.',
    license: '이용허락범위 제한 없음',
    attribution: '국토교통부 (공공데이터포털)',
    steps: [
      {
        title: '전국 버스정류장 CSV 다운로드',
        why: '공공데이터포털 2단계 다운로드: 파일 번호(atchFileId) 조회 → 다운로드. 로그인 불필요.',
        tool: 'curl',
        run: `FID=$(curl -sS 'https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?publicDataPk=15067528&publicDataDetailPk=uddi:f74b9799-9db1-4754-a5d0-b66e2ae705f3&fileDetailSn=1&publicDataTyCode=PR0051' | grep -oE '"atchFileId":"[^"]+' | head -1 | cut -d'"' -f4) && curl -sSL "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=$FID&fileDetailSn=1" -o ${RAW}`,
      },
    ],
  },
  otherSources: [
    { source: 'seoul', dataset: '서울시 버스정류소 위치정보 OA-15067', note: 'CRDNT_X·CRDNT_Y(위경도) 열, CP949. 2024년 8월 이후 파일은 XLSX.' },
    { source: 'admdongkor', dataset: '행정동 중심점 coordinate_UTMK_이름포함.tsv', note: 'TSV, UTM-K(EPSG:5179).' },
    { source: 'overpass-turbo', dataset: '[out:csv(::lat,::lon,name)] 질의', note: '예: 지하철역 좌표.' },
    { source: 'geonames', dataset: 'KR.zip', note: '한국 지명 위경도, TSV.' },
    { source: 'ourairports', dataset: 'airports.csv', note: 'iso_country=KR 필터.' },
    { source: 'kma', dataset: '관측지점정보 (지상관측 지점 목록)', note: '지점번호·위도·경도·해발고도, MS949. 로그인 없이 CSV.' },
    { source: 'khs-gis', dataset: '국가유산 위치 API (spca.do)', note: 'XML 응답. UTM-K 좌표 → CSV 변환 후 사용. 인증키 불필요.' },
  ],
  recipes: [
    vectorRecipe({
      work: '/work/stops.gpkg',
      layer: 'stops',
      minzoom: 11,
      maxzoom: 14,
      key: 'id',
      preprocess,
      bounds: [126.434, 37.184, 127.188, 37.830],
    }),
    geopandasRecipe({
      layer: 'stops',
      check: {
        why: "encoding='cp949': 원본 인코딩 그대로 읽기(iconv 변환 불필요). dtype=str: 값을 텍스트 그대로. to_numeric(errors='coerce'): 빈 칸·문자 → NaN. 한국 범위 밖·빈 좌표 행을 도시별로 집계(GDAL 레시피와 같은 대전 5·세종 6·제주 1).",
        code: `import pandas as pd\ndf = pd.read_csv('${RAW}', encoding='cp949', dtype=str)\nprint(len(df), '행 ·', list(df.columns))\nlat, lon = pd.to_numeric(df['위도'], errors='coerce'), pd.to_numeric(df['경도'], errors='coerce')\nprint(df[~(lat.between(33, 39) & lon.between(124, 132))].groupby('도시명').size().to_string())`,
      },
      tidy: {
        title: '서울BIS 정류장 점 만들기',
        why: "관리도시명 서울BIS: 경기BIS 중복 등록 제외. between: 한국 범위 밖·빈 좌표 행 제외. points_from_xy(경도, 위도) + crs=4326: 텍스트 좌표 → 위경도 점. set_axis: 한글 열 → id·name·ars.",
        code: `import pandas as pd\ndf = pd.read_csv('${RAW}', encoding='cp949', dtype=str)\ndf['lat'], df['lon'] = pd.to_numeric(df['위도'], errors='coerce'), pd.to_numeric(df['경도'], errors='coerce')\ndf = df[(df['관리도시명'] == '서울BIS') & df['lat'].between(33, 39) & df['lon'].between(124, 132)]\ndf = gpd.GeoDataFrame(df[['정류장번호', '정류장명', '모바일단축번호']].set_axis(['id', 'name', 'ars'], axis=1), geometry=gpd.points_from_xy(df['lon'], df['lat']), crs=4326)`,
      },
    }),
    ...serverRecipes({ category: 'attribute', layer: 'stops', preprocess, work: '/work/stops.gpkg', geom: 'point', bounds: [126.434013, 37.184719, 127.187302, 37.829449] }),
  ],
  alternatives: [
    { tool: 'mapshaper', cmd: 'mapshaper -i molit_bus_stops.csv encoding=cp949 -points x=경도 y=위도 -o format=geojson stops.geojson', note: '인코딩 지정 + 좌표 열 → 점, 명령 한 줄.' },
  ],
  upload: vectorUpload({
    category: 'attribute',
    accept: ['.csv'],
    note: '좌표 열(경도·위도, lon·lat, x·y, X좌표·Y좌표, …_x·…_y 등)이 있는 CSV. UTF-8 또는 CP949. 평면 좌표(TM 등 미터 값)면 판별 화면에서 좌표계 선택. 빈 좌표·위경도 범위 밖 행(위도·경도 뒤바뀜 등)은 제외.',
    open: '/work/data.csv',
    prepare: [
      {
        title: '인코딩 확인·UTF-8 변환',
        why: 'UTF-8로 읽히면 그대로, 아니면 국내 공공 CSV에 흔한 CP949로 보고 UTF-8 변환. GDAL CSV 드라이버는 UTF-8 기준.',
        tool: 'gdal',
        run: "if iconv -f UTF-8 -t UTF-8 $INPUT > /work/data.csv 2>/dev/null; then echo '인코딩: UTF-8'; else iconv -f CP949 -t UTF-8 $INPUT > /work/data.csv && echo '인코딩: CP949 → UTF-8'; fi",
      },
      {
        title: '좌표계 지정',
        why: 'CSV에는 좌표계 정보 없음 → 같은 이름의 .prj에 위경도(WGS84) 기록. GDAL CSV 드라이버가 .prj를 함께 읽음. 판별 화면에서 좌표계를 고르면 다음 단계의 -s_srs가 이 값을 덮어씀.',
        tool: 'gdal',
        run: 'gdalsrsinfo -o wkt_esri EPSG:4326 > /work/data.prj',
      },
    ],
    opts: `-oo 'X_POSSIBLE_NAMES=${XY_NAMES.x.join(',')}' -oo 'Y_POSSIBLE_NAMES=${XY_NAMES.y.join(',')}' -oo KEEP_GEOM_COLUMNS=NO`,
  }),
  view: { center: [126.98, 37.55], zoom: 11 },
} satisfies FormatSpec
