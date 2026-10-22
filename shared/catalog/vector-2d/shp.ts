import type { FormatSpec, Step } from '../../types.ts'
import { serverRecipes } from '../_server.ts'
import { shpEncoding, tileCount, vectorUpload } from './_vector.ts'

// 레시피 GDAL·tippecanoe가 같이 쓰는 전처리
const gdalPreprocess: Step[] = [
    {
      title: '무결성 확인',
      why: 'CPL_ZIP_ENCODING CP949: zip 안 CP949 파일 이름 해석 → 압축 해제 없이 /vsizip/로 읽기(그냥 풀면 이름 깨짐). -so: 레이어 요약.',
      tool: 'gdal',
      run: 'ogrinfo -so --config CPL_ZIP_ENCODING CP949 /vsizip//raw/seoul_trdar.zip',
    },
    {
      title: '시청 일대 추출',
      why: '-spat: 서울 전체 1,650개 중 시청 주변 범위에 걸치는 상권만. -spat_srs EPSG:4326: 범위는 위경도 기준(원본 EPSG:5181은 미터).',
      tool: 'gdal',
      run: 'ogr2ogr --config CPL_ZIP_ENCODING CP949 -f GPKG /work/clip.gpkg /vsizip//raw/seoul_trdar.zip -nln clip -spat 126.970 37.555 126.990 37.570 -spat_srs EPSG:4326',
    },
    {
      title: '위경도 변환·필드 이름 정리',
      why: '-t_srs EPSG:4326: EPSG:5181(중부원점, m) → 위경도. -sql: 10자로 잘린 필드 이름(TRDAR_CD_N 등) → name·kind·gu·dong·area_m2. -makevalid: 꼬인 도형 수정.',
      tool: 'gdal',
      run: "ogr2ogr -f GPKG /work/trdar.gpkg /work/clip.gpkg -nln trdar -t_srs EPSG:4326 -makevalid -sql 'SELECT TRDAR_CD_N AS name, TRDAR_SE_1 AS kind, SIGNGU_CD_ AS gu, ADSTRD_CD_ AS dong, RELM_AR AS area_m2, geom FROM clip'",
    },
  ]

// 타일 전후 피처 수 (상권 이름은 시청 일대 30개에서 고유)
const TILE_COUNT = { layer: 'trdar', key: 'name', minzoom: 11, maxzoom: 16 }

// 서버 레시피(GeoServer·martin): 추출만 하고 원본 좌표계(EPSG:5181) 그대로 상시 PostGIS에 적재 → 요청 좌표계로는 서버가 변환
const BOUNDS: [number, number, number, number] = [126.964, 37.545, 127.016, 37.578]
const serverLoad: Step = {
  title: 'PostGIS 적재 (원본 좌표계 유지)',
  why: '좌표계 변환 없이 EPSG:5181 그대로 → 서버가 요청마다 변환(국내 운영 DB의 흔한 형태). -sql: 10자로 잘린 필드 이름 → name·kind·gu·dong·area_m2. -nlt PROMOTE_TO_MULTI: Polygon·MultiPolygon 통일. -makevalid: 꼬인 도형 수정. -overwrite: 다시 실행 시 표 교체.',
  tool: 'gdal',
  run: "ogr2ogr -f PostgreSQL PG:dbname=gis /work/clip.gpkg -nln trdar -overwrite -nlt PROMOTE_TO_MULTI -makevalid -lco GEOMETRY_NAME=geom -sql 'SELECT TRDAR_CD_N AS name, TRDAR_SE_1 AS kind, SIGNGU_CD_ AS gu, ADSTRD_CD_ AS dong, RELM_AR AS area_m2, geom FROM clip'",
}

export default {
  id: 'shp',
  category: 'vector-2d',
  name: 'Shapefile',
  extensions: ['.shp', '.zip'],
  summary: '가장 흔한 벡터 포맷. 여러 파일이 한 세트라 보통 zip으로 배포.',
  description: '1990년대 Esri 포맷. 국내 공공데이터 대부분이 SHP. 한계: 필드 이름 10자, 파일 2GB, 글자 인코딩 별도 표기(.cpg). 웹 지도 직접 미지원 → GeoJSON·벡터타일 변환 필요.',
  anatomy: [
    { name: '.shp', role: '도형(점·선·면 좌표)' },
    { name: '.shx', role: '.shp 내 도형 위치 색인' },
    { name: '.dbf', role: '속성 표(dBase). 필드 이름 10자 제한' },
    { name: '.prj', role: '좌표계 정의(WKT)' },
    { name: '.cpg', role: '.dbf 글자 인코딩 (UTF-8, EUC-KR 등)' },
  ],
  convertible: true,
  collect: {
    source: 'seoul',
    dataset: '서울시 상권분석서비스(영역-상권) OA-15560',
    url: 'https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do',
    how: '포털 다운로드 버튼과 같은 POST 요청(파일 번호)을 curl로 전송. 서울 전체 상권 1,650개 zip(2MB).',
    steps: [
      {
        title: '서울 전체 상권 SHP 다운로드',
        why: 'infId·infSeq·seq: 다운로드 버튼과 같은 POST 파라미터. 로그인 불필요.',
        tool: 'curl',
        run: "curl -sSL -X POST 'https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?useCache=false' -d 'infId=OA-15560&infSeq=3&seq=5' -o /raw/seoul_trdar.zip",
      },
    ],
  },
  otherSources: [
    { source: 'vworld', dataset: 'GIS건물통합정보, 연속지적도 등', note: '로그인 다운로드. 약관 확인 전 → 샘플 미사용.' },
    { source: 'nsdi', dataset: '국가공간정보 SHP 목록', note: '대부분 로그인 필요.' },
    { source: 'datagokr', dataset: '기관별 SHP 파일데이터', note: '포털 직접 업로드 파일은 로그인 불필요. 라이선스는 데이터셋별 상이.' },
    { source: 'geofabrik', dataset: 'south-korea-latest-free.shp.zip', note: 'OSM 전체 SHP. 이미 위경도·UTF-8 → 국내 공공 SHP와 전처리 다름.' },
    { source: 'naturalearth', dataset: 'Admin 0 국가 / Admin 1 시도 경계 (1:10m)', note: '한국 포함, 소축척.' },
    { source: 'geoboundaries', dataset: 'geoBoundaries-KOR-ADM2-all.zip', note: '한국 시군구 SHP.' },
    { source: 'gadm', dataset: 'gadm41_KOR_shp.zip', note: '재배포 불가(비상업·학술 전용).' },
    { source: 'southkorea-maps', dataset: 'kostat/2012/shp/municipalities.shp', note: '통계청 2012 시군구. 시도는 provinces.shp.' },
    { source: 'gisdeveloper', dataset: 'sig_20230729.zip(시군구) / emd_20230729.zip(읍면동)', note: 'EPSG:5179. 인코딩 미확인(EUC-KR 추정).' },
    { source: 'bbbike', dataset: 'Seoul.osm.shp.zip', note: '서울 OSM, 약 70MB.' },
    { source: 'juso', dataset: '도로명주소 전자지도 (시도·시군구별)', note: '건물·도로·행정구역 등 11종. 관할 기관장 승인 후 다운로드.' },
    { source: 'sgis', dataset: '행정구역·집계구 경계', note: 'UTM-K(EPSG:5179), 행정동 기준. 로그인 후 자료신청.' },
    { source: 'egis', dataset: '중분류 토지피복지도 (1:25,000, 2022~2025 전국)', note: '22개 분류 폴리곤, 전국 814도엽. 로그인 후 신청.' },
    { source: 'forest', dataset: '대축척 임상도 (1:5,000)', note: '수종·영급·경급·밀도 폴리곤. 지역·용도 입력 신청 후 다운로드.' },
    { source: 'its', dataset: '전국 표준노드링크 (NODELINKDATA.zip)', note: '전국 도로망 노드·링크, 매월 갱신(약 270MB). 로그인 불필요.' },
    { source: 'khoa', dataset: '2레벨 전자해도 (일반도)', note: 'S-57 전자해도 레이어 SHP zip.' },
    { source: 'datagokr', dataset: '국립해양조사원 해안선 15083948', note: '전국 해안선 SHP zip(약 88MB). 이용허락범위 제한 없음.' },
    { source: 'datagokr', dataset: '팜맵 공간정보 (시도별, 예: 전북 15104486)', note: '농경지 폴리곤, 시도별 zip. 이용허락범위 제한 없음.' },
    { source: 'datagokr', dataset: 'SGIS 격자 통계 및 경계 15141768', note: '경계 SHP + 격자통계 CSV(약 98MB). 로그인 불필요.' },
    { source: 'ngii', dataset: '정밀도로지도 (벡터)', note: '도로·주변 시설 3차원 전자지도 SHP. 로그인 후 다운로드.' },
  ],
  recipes: [
    {
      id: 'gdal',
      title: 'GDAL',
      preprocess: gdalPreprocess,
      convert: [
        {
          title: 'GeoJSON 내보내기 (OGC API Features 경로)',
          why: '-lco RFC7946=YES: 브라우저 표준 GeoJSON. COORDINATE_PRECISION=7: 좌표 7자리. /collections/{id}/items: OGC API Features 경로, 실서버 이전 용이.',
          tool: 'gdal',
          run: 'ogr2ogr -f GeoJSON /out/ogc/collections/trdar/items.json /work/trdar.gpkg -lco RFC7946=YES -lco COORDINATE_PRECISION=7',
        },
        {
          title: 'MVT 벡터타일 분할',
          why: '줌별 z/x/y.pbf 타일 → 보이는 영역만 요청(대용량 대비). MINZOOM=11·MAXZOOM=16: 줌 범위. COMPRESS=NO: gzip 없이 저장.',
          tool: 'gdal',
          run: 'ogr2ogr -f MVT /out/tiles /work/trdar.gpkg -dsco MINZOOM=11 -dsco MAXZOOM=16 -dsco COMPRESS=NO',
        },
        tileCount({ ...TILE_COUNT, work: '/work/trdar.gpkg', tiles: '/out/tiles/$z' }),
      ],
      outputs: [
        { id: 'features', kind: 'geojson', path: 'ogc/collections/trdar/items.json', label: 'GeoJSON', why: '상권 전체 한 파일. 소규모 데이터에 가장 단순.' },
        { id: 'tiles', kind: 'mvt', path: 'tiles/{z}/{x}/{y}.pbf', minzoom: 11, maxzoom: 16, layer: 'trdar', label: 'MVT 벡터타일', why: '보이는 영역 타일만 요청. 대용량에 유리.' },
      ],
      viewers: {
        ol: { output: 'tiles' },
        maplibre: { output: 'tiles' },
        deck: { output: 'tiles' },
        cesium: { output: 'features', note: 'MVT 미지원 → GeoJSON 사용.' },
      },
    },
    {
      id: 'tippecanoe',
      title: 'tippecanoe',
      preprocess: gdalPreprocess,
      convert: [
        {
          title: 'GeoJSON 추출',
          why: 'tippecanoe 입력 형식: GeoJSON(또는 FlatGeobuf).',
          tool: 'gdal',
          run: 'ogr2ogr -f GeoJSON /work/trdar.geojson /work/trdar.gpkg -lco RFC7946=YES',
        },
        {
          title: 'PMTiles 생성',
          why: '-Z11·-z16: 줌 범위. -l trdar: 레이어 이름. --drop-densest-as-needed: 줌별 과밀 피처 제거. 결과: PMTiles 한 파일.',
          tool: 'tippecanoe',
          run: 'tippecanoe -o /out/trdar.pmtiles -l trdar -Z11 -z16 --drop-densest-as-needed --force /work/trdar.geojson',
        },
        tileCount({ ...TILE_COUNT, work: '/work/trdar.gpkg', tiles: '-oo ZOOM_LEVEL=$z /out/trdar.pmtiles' }),
      ],
      outputs: [
        { id: 'pmtiles', kind: 'pmtiles', path: 'trdar.pmtiles', minzoom: 11, maxzoom: 16, layer: 'trdar', label: 'PMTiles', why: '타일 전체 단일 파일. 정적 호스팅에 적합.' },
      ],
      viewers: {
        ol: { output: 'pmtiles' },
        maplibre: { output: 'pmtiles' },
        deck: { output: 'pmtiles', note: 'MVTLayer 타일 요청 → PMTiles 읽기로 교체.' },
        cesium: { unsupported: '벡터타일(PMTiles 포함) 미지원 → GeoJSON 별도 필요.' },
      },
    },
    {
      id: 'postgis',
      title: 'PostGIS + Python',
      preprocess: [
        {
          title: 'PostGIS 원본 적재',
          why: '원본 좌표계(EPSG:5181)·속성 그대로 적재 → 이후 처리는 전부 SQL. -nlt PROMOTE_TO_MULTI: Polygon·MultiPolygon 통일.',
          tool: 'gdal',
          run: 'ogr2ogr --config CPL_ZIP_ENCODING CP949 -f PostgreSQL PG:dbname=gis /vsizip//raw/seoul_trdar.zip -nln trdar_raw -nlt PROMOTE_TO_MULTI -lco GEOMETRY_NAME=geom',
        },
        {
          title: 'SQL 추출·좌표계·필드 정리',
          why: 'ST_Intersects: 시청 범위에 걸치는 상권만. ST_Transform: 웹 타일 좌표계(EPSG:3857). ST_MakeValid: 꼬인 도형 수정. gist 인덱스: 타일 계산 가속.',
          tool: 'postgis',
          run: `psql -v ON_ERROR_STOP=1 -c "CREATE TABLE trdar AS SELECT trdar_cd_n AS name, trdar_se_1 AS kind, signgu_cd_ AS gu, adstrd_cd_ AS dong, relm_ar AS area_m2, ST_Transform(ST_MakeValid(geom), 3857) AS geom FROM trdar_raw WHERE ST_Intersects(geom, ST_Transform(ST_MakeEnvelope(126.970, 37.555, 126.990, 37.570, 4326), 5181)); CREATE INDEX ON trdar USING gist (geom); SELECT count(*) AS 상권_수 FROM trdar;"`,
        },
      ],
      convert: [
        {
          title: 'MVT 타일 생성 (ST_AsMVT)',
          why: 'ST_TileEnvelope: 타일 번호별 범위. ST_AsMVTGeom: 도형 → 타일 좌표. ST_AsMVT: 타일로 묶기. martin 같은 타일 서버의 요청별 처리를 Python으로 미리 실행.',
          tool: 'psycopg',
          run: 'python /scripts/pg_mvt.py trdar trdar /out/tiles 11 16 126.96 37.54 127.02 37.58',
        },
        tileCount({ ...TILE_COUNT, work: 'PG:dbname=gis', tiles: '/out/tiles/$z' }),
        {
          title: 'GeoJSON 생성 (ST_AsGeoJSON)',
          why: 'ST_Transform: EPSG:3857 → 위경도. ST_AsGeoJSON: 행 → Feature(좌표 7자리). json_agg: FeatureCollection 하나로 집계.',
          tool: 'postgis',
          run: `psql -At -v ON_ERROR_STOP=1 -o /out/ogc/collections/trdar/items.json -c "SELECT json_build_object('type', 'FeatureCollection', 'features', json_agg(ST_AsGeoJSON(t.*, 'geom', 7)::json)) FROM (SELECT name, kind, gu, dong, area_m2, ST_Transform(geom, 4326) AS geom FROM trdar) t"`,
        },
      ],
      outputs: [
        { id: 'features', kind: 'geojson', path: 'ogc/collections/trdar/items.json', label: 'GeoJSON', why: 'SQL 결과 그대로 GeoJSON.' },
        { id: 'tiles', kind: 'mvt', path: 'tiles/{z}/{x}/{y}.pbf', minzoom: 11, maxzoom: 16, layer: 'trdar', label: 'MVT 벡터타일', why: 'ST_AsMVT 생성 타일. 실서버는 요청마다 같은 SQL 실행.' },
      ],
      viewers: {
        ol: { output: 'tiles' },
        maplibre: { output: 'tiles' },
        deck: { output: 'tiles' },
        cesium: { output: 'features', note: 'MVT 미지원 → GeoJSON 사용.' },
      },
    },
    ...serverRecipes({ category: 'vector-2d', layer: 'trdar', preprocess: gdalPreprocess.slice(0, 2), load: serverLoad, geom: 'polygon', bounds: BOUNDS }),
  ],
  alternatives: [
    { tool: 'geopandas', cmd: "gpd.read_file('seoul_trdar.zip', encoding='cp949').to_crs(4326).to_file('trdar.geojson')", note: 'Python 스크립트로 같은 처리.' },
    { tool: 'mapshaper', cmd: 'mapshaper seoul_trdar.shp -proj wgs84 -simplify 10% -o format=geojson trdar.geojson', note: '도형 단순화 → 용량 축소.' },
  ],
  upload: vectorUpload({
    accept: ['.zip'],
    note: '.shp, .shx, .dbf, .prj(, .cpg)를 zip 하나로. .shp 단독은 속성·좌표계 없음.',
    open: '/vsizip/$INPUT',
    prepare: [shpEncoding],
    opts: '$(cat /work/open_options)',
  }),
  view: { center: [126.979, 37.565], zoom: 14 },
} satisfies FormatSpec
