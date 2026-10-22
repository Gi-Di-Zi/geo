import type { FormatSpec, Step } from '../../types.ts'
import { serverRecipes } from '../_server.ts'
import { vectorRecipe, vectorUpload } from './_vector.ts'

const ZIP = '/raw/semas_dining_areas.zip'
const NAME = '소상공인시장진흥공단_소상공인365_회식상권_AI친화고가치'
// zip 안 폴더·파일 이름이 CP949라 GDAL에 알려 줘야 열린다
const ENC = '--config CPL_ZIP_ENCODING CP949'
const RAW = `/vsizip/${ZIP}/${NAME}/2.개방데이터/${NAME}_2024-01.geojson`

// 파일 레시피(GDAL)와 서버 레시피(GeoServer·martin)가 같이 쓰는 전처리
const preprocess: Step[] = [
  {
    title: '무결성 확인',
    why: '/vsizip/: 압축 해제 없이 읽기. CPL_ZIP_ENCODING CP949: zip 안 한글 경로 해석. 전국 상권 904개, 위경도(CRS84) 다각형, 한글 속성 이름.',
    tool: 'gdal',
    run: `ogrinfo -so -al ${ENC} ${RAW} | grep -E 'Geometry|Feature Count|주요상권명|시도명|라벨명|면적'`,
  },
  {
    title: '서울 상권 추출·속성 정리',
    why: 'WHERE 시도명: 서울특별시만. AS name·label·area_m2: 한글 키 → 영문(뷰어 스타일·코드용).',
    tool: 'gdal',
    run: `ogr2ogr -f GPKG /work/areas.gpkg ${ENC} ${RAW} -nln areas -dialect SQLite -sql "SELECT geometry, 주요상권명 AS name, 라벨명 AS label, 면적 AS area_m2 FROM \\"${NAME}_2024-01\\" WHERE 시도명 = '서울특별시'"`,
  },
]

export default {
  id: 'geojson',
  category: 'vector-2d',
  name: 'GeoJSON',
  extensions: ['.geojson', '.json'],
  summary: '웹의 공용어인 텍스트 벡터 포맷. 브라우저가 변환 없이 바로 읽는다.',
  description: 'JSON에 도형 좌표·속성을 함께 적는 IETF 표준(RFC 7946). 사람이 읽을 수 있고 거의 모든 라이브러리 지원. 한계: 텍스트라 대용량에 무거움, 공간 인덱스 없음 → 부분 읽기 어려움. 좌표계는 위경도(WGS84)만.',
  anatomy: [
    { name: 'FeatureCollection', role: '피처 목록을 감싸는 최상위 객체' },
    { name: 'geometry', role: 'Point, LineString, Polygon 등과 [경도, 위도] 좌표' },
    { name: 'properties', role: '이름·분류 등 속성. 한글 키 가능' },
  ],
  convertible: true,
  collect: {
    source: 'datagokr',
    dataset: '소상공인시장진흥공단 소상공인365 회식상권(AI친화 고가치) 15167536',
    url: 'https://www.data.go.kr/data/15167536/fileData.do',
    how: '공공데이터포털의 전국 회식상권 경계 zip (GeoJSON·CSV·Parquet 포함).',
    license: '이용허락범위 제한 없음',
    attribution: '소상공인시장진흥공단 (공공데이터포털)',
    steps: [
      {
        title: '회식상권 zip 다운로드',
        why: '2단계: 파일 번호(atchFileId) 조회 → 그 번호로 다운로드. 포털 표기는 CSV지만 zip 안에 GeoJSON 포함.',
        tool: 'curl',
        run: `FID=$(curl -sS 'https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?publicDataPk=15167536&publicDataDetailPk=uddi:00e9a5cd-f732-4c41-bb98-e193ae1cafbf&fileDetailSn=1&publicDataTyCode=PR0051' | grep -oE '"atchFileId":"[^"]+' | head -1 | cut -d'"' -f4) && curl -sSL "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=$FID&fileDetailSn=1" -o ${ZIP}`,
      },
    ],
  },
  otherSources: [
    { source: 'datagokr', dataset: '기관별 GeoJSON 파일데이터', note: '기관 직접 업로드 GeoJSON. 포털 확장자 표기 오류 잦음 → 받아서 확인 필요.' },
    { source: 'vworld', dataset: '2D 데이터 API (GeoJSON 응답)', note: '인증키 필요, 약관 확인 전.' },
    { source: 'geoboundaries', dataset: 'geoBoundaries-KOR-ADM2.geojson', note: '한국 시군구 229개. 간략화본·TopoJSON도 제공.' },
    { source: 'admdongkor', dataset: 'HangJeongDong_ver20261001.geojson', note: '전국 행정동 약 35MB, EPSG:4326, UTF-8.' },
    { source: 'southkorea-maps', dataset: 'kostat/2013/json/skorea_municipalities_geo_simple.json', note: '통계청 2013 시군구 단순화본.' },
    { source: 'click-that-hood', dataset: 'public/data/seoul.geojson', note: '서울 행정동 약 1.3MB, 원출처 admdongkor.' },
    { source: 'bbbike', dataset: 'Seoul.osm.geojson.xz', note: '서울 OSM, xz 압축 약 74MB.' },
    { source: 'overpass-turbo', dataset: 'Export → GeoJSON', note: '질의 영역·태그 자유 지정.' },
    { source: 'naturalearth', dataset: 'ne_10m_admin_0_countries.geojson (GitHub 미러)', note: '약 13MB.' },
  ],
  recipes: [
    vectorRecipe({
      work: '/work/areas.gpkg',
      layer: 'areas',
      minzoom: 10,
      maxzoom: 15,
      key: 'name || label',
      sameWhy: '원본도 GeoJSON — 전국→서울 추림, 한글 키→영문, 좌표 7자리, OGC API Features 경로(/collections/{id}/items)로 재배치.',
      preprocess,
    }),
    ...serverRecipes({ category: 'vector-2d', layer: 'areas', preprocess, work: '/work/areas.gpkg', geom: 'polygon', bounds: [126.81, 37.45, 127.16, 37.66] }),
  ],
  alternatives: [
    { tool: 'mapshaper', cmd: 'mapshaper areas.geojson -simplify 10% -o areas_small.geojson', note: '경계 꼭짓점 축소 → 용량 절감.' },
    { tool: 'tippecanoe', cmd: 'tippecanoe -o areas.pmtiles -zg areas.geojson', note: '도형이 많을 때 줌별 솎아내기 + 타일화.' },
  ],
  upload: vectorUpload({ accept: ['.geojson', '.json'], note: 'FeatureCollection GeoJSON. 좌표계 표기 없으면 위경도로 간주.' }),
  view: { center: [126.985, 37.545], zoom: 11 },
} satisfies FormatSpec
