import type { FormatSpec, Step } from '../../types.ts'
import { serverRecipes } from '../_server.ts'
import { vectorRecipe, vectorUpload } from './_vector.ts'

const RAW = '/raw/hrdk_test_sites.gpkg'
const LAYER = '국가기술자격시험장소_GIS'

// 파일 레시피(GDAL)와 서버 레시피(GeoServer·martin)가 같이 쓰는 전처리
const preprocess: Step[] = [
  {
    title: '무결성 확인',
    why: '레이어·피처 수·범위·좌표계(EPSG:4326)·필드. 필드명이 한글·공백·괄호 포함(도로명 주소, 경도(X)).',
    tool: 'gdal',
    run: `ogrinfo -so -al ${RAW}`,
  },
  {
    title: '속성 정리',
    why: '-sql: 한글 필드명 → 영문(name·address·uses). 좌표 중복 필드(경도(X)·위도(Y))와 우편번호 제외. 큰따옴표: 공백 포함 필드명.',
    tool: 'gdal',
    run: `ogr2ogr -f GPKG /work/sites.gpkg ${RAW} -nln sites -dialect SQLite -sql "SELECT geom, 시험장 AS name, \\"도로명 주소\\" AS address, 기술자격사용횟수 AS uses FROM \\"${LAYER}\\""`,
  },
]

export default {
  id: 'gpkg',
  category: 'vector-2d',
  name: 'GeoPackage',
  extensions: ['.gpkg'],
  summary: 'SQLite 파일 하나에 여러 레이어를 담는 OGC 표준. SHP의 한계를 해결.',
  description: '파일 하나에 레이어·공간 인덱스(R-tree)·좌표계 정보. 필드 이름 길이 제한·인코딩 문제 없음(UTF-8, 한글 필드명 가능). 데스크톱 GIS의 SHP 후계. 브라우저는 SQLite 직접 읽기 어려움 → 웹 포맷 변환.',
  anatomy: [
    { name: 'gpkg_contents', role: '레이어 목록' },
    { name: 'gpkg_spatial_ref_sys', role: '레이어별 좌표계 정의' },
    { name: '레이어 테이블 + rtree_*', role: '도형·속성 테이블과 R-tree 공간 인덱스' },
  ],
  convertible: true,
  collect: {
    source: 'datagokr',
    dataset: '한국산업인력공단 국가기술자격 시험장 위치 및 이용통계 15150897',
    url: 'https://www.data.go.kr/data/15150897/fileData.do',
    how: '공공데이터포털에 GeoPackage로 공개된 전국 국가기술자격 시험장 9,490곳(점).',
    license: '이용허락범위 제한 없음',
    attribution: '한국산업인력공단 (공공데이터포털)',
    steps: [
      {
        title: '시험장 GeoPackage zip 다운로드',
        why: '공공데이터포털 2단계 다운로드: 파일 번호(atchFileId) 조회 → 다운로드. 로그인 불필요.',
        tool: 'curl',
        run: `FID=$(curl -sS 'https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?publicDataPk=15150897&publicDataDetailPk=uddi:84367266-aa04-438c-b45b-c2f5d7f4c1e2&fileDetailSn=1&publicDataTyCode=PR0051' | grep -oE '"atchFileId":"[^"]+' | head -1 | cut -d'"' -f4) && curl -sSL "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=$FID&fileDetailSn=1" -o /work/hrdk.zip`,
      },
      {
        title: 'zip 해제',
        why: 'zip 안 파일명이 CP949 한글 → GDAL /vsizip/ 목록 실패, Python zipfile로 꺼내 영문 파일명으로 저장. 내용은 그대로.',
        tool: 'gdal',
        run: `python3 -c "import zipfile, shutil; z = zipfile.ZipFile('/work/hrdk.zip'); n = [x for x in z.namelist() if x.endswith('.gpkg')][0]; shutil.copyfileobj(z.open(n), open('${RAW}', 'wb'))" && ls -la /raw`,
      },
    ],
  },
  otherSources: [
    { source: 'ngii', dataset: '수치지형도 (NGI)', note: '로그인 다운로드. GDAL로 GeoPackage 변환 후 레이어별 정리 가능.' },
    { source: 'naturalearth', dataset: 'natural_earth_vector.gpkg', note: '전체 벡터 테마, 436MB.' },
    { source: 'gadm', dataset: 'gadm41_KOR.gpkg', note: '재배포 불가(비상업·학술 전용).' },
    { source: '3dbag', dataset: '3DBAG 타일 GPKG', note: '네덜란드 건물. 높이 속성(b3_h_max 등) → 2.5D 압출 가능.' },
    { source: 'bbbike', dataset: 'Seoul.osm.geopackage.zip', note: '서울 OSM, 약 107MB.' },
  ],
  recipes: [
    vectorRecipe({
      work: '/work/sites.gpkg',
      layer: 'sites',
      minzoom: 6,
      maxzoom: 14,
      // 같은 시험장 행이 원본에 중복 → 이름·주소·사용 횟수 조합
      key: 'name || address || uses',
      preprocess,
    }),
    ...serverRecipes({ category: 'vector-2d', layer: 'sites', preprocess, work: '/work/sites.gpkg', geom: 'point', bounds: [124.67, 33.24, 129.57, 38.45] }),
  ],
  alternatives: [
    { tool: 'geopandas', cmd: "gpd.read_file('hrdk_test_sites.gpkg')", note: '레이어 하나면 이름 없이 읽기.' },
    { tool: 'postgis', cmd: 'ogr2ogr -f PostgreSQL PG:dbname=gis hrdk_test_sites.gpkg', note: '모든 레이어 → DB 테이블 일괄 이전.' },
  ],
  upload: vectorUpload({ accept: ['.gpkg'], note: '레이어가 여러 개면 하나로 병합.' }),
  view: { center: [127.8, 36.3], zoom: 6.6 },
} satisfies FormatSpec
