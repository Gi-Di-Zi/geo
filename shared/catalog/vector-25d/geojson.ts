import type { FormatSpec, Step } from '../../types.ts'
import { serverRecipes } from '../_server.ts'
import { buildingRecipes, buildingUpload } from './_buildings.ts'

const RAW = '/raw/sf_buildings.geojson'
const API = 'https://data.sf.gov/resource/ynuv-fyni.geojson'

// 세 레시피가 같이 쓰는 높이 채우기. 결과(/work/buildings.geojson: name, height, height_source)는 _buildings.ts 레시피가 받는다
const preprocess: Step[] = [
  {
    title: '무결성 확인',
    why: '전체 건물 수 vs 높이(hgt_median_m) 있는 건물 수. Socrata API: 숫자도 문자열로 응답.',
    tool: 'gdal',
    run: `ogrinfo -q -sql "SELECT COUNT(*) AS total, COUNT(hgt_median_m) AS has_height FROM sf_buildings" ${RAW}`,
  },
  {
    title: '높이 숫자 변환·빈 높이 채우기',
    why: 'CAST: 문자열 높이 → 숫자, 빈 값은 9m. height_source: 사용 값 출처. -explodecollections: MultiPolygon → 다각형 단위(mago 3DTiler가 MultiPolygon 건너뜀). WHERE: 높이 1m 미만·면적 1㎡ 미만 조각 제외(납작한 벽 → mago 중단).',
    tool: 'gdal',
    run: `ogr2ogr -f GeoJSON /work/buildings_raw.geojson ${RAW} -makevalid -explodecollections -dialect SQLite -sql "SELECT geometry, mblr AS name, ROUND(COALESCE(CAST(hgt_median_m AS REAL), 9.0), 1) AS height, CASE WHEN hgt_median_m IS NOT NULL THEN '실측 높이(지붕 중앙값)' ELSE '기본값 9m' END AS height_source FROM sf_buildings WHERE COALESCE(CAST(hgt_median_m AS REAL), 9.0) >= 1 AND ST_Area(geometry) > 1e-10"`,
  },
  {
    title: '작은 구멍 메우기',
    why: '수 ㎡ 구멍(채광창 등) → mago 3DTiler 벽 생성 실패·전체 중단. 10㎡ 미만 구멍만 메움, 큰 안뜰은 유지.',
    tool: 'python',
    run: 'python /scripts/fill_holes.py /work/buildings_raw.geojson /work/buildings.geojson 10',
  },
]

export default {
  id: 'geojson',
  category: 'vector-25d',
  name: 'GeoJSON (높이 속성)',
  extensions: ['.geojson', '.json'],
  summary: '높이 속성을 가진 GeoJSON 도형. 뷰어가 이 값으로 건물을 세운다.',
  description: '도형은 2D, 높이는 height 같은 속성. 바닥면을 높이만큼 밀어 올리는 돌출(extrusion) 방식, 지붕 모양 없음 → 2.5D. 높이 속성 이름·형식(숫자/문자열)이 데이터마다 달라 통일이 전처리 핵심.',
  anatomy: [
    { name: 'geometry', role: '바닥면 다각형 (경도, 위도)' },
    { name: 'hgt_median_m', role: '지붕 높이 중앙값(m). 이 API는 문자열' },
    { name: 'gnd_min_m', role: '바닥 최저 높이(m). 경사지 건물 띄우기용' },
  ],
  convertible: true,
  collect: {
    source: 'datasf',
    dataset: 'DataSF Building Footprints (ynuv-fyni), 다운타운·파이낸셜 디스트릭트',
    url: 'https://data.sf.gov/Geographic-Locations-and-Boundaries/Building-Footprints/ynuv-fyni',
    how: '샌프란시스코 오픈데이터 API: 범위(within_box)에 걸치는 건물을 GeoJSON으로 응답. 국내 건물 높이 데이터는 SHP 배포뿐 → 해외 데이터 사용.',
    derived: '시 전체 17만 동 중 다운타운 범위(위도 37.775~37.800, 경도 -122.420~-122.390)에 걸치는 건물만.',
    steps: [
      {
        title: '다운타운 건물 GeoJSON 다운로드',
        why: '.geojson 주소: GeoJSON 응답. $select: 필요한 열. $where within_box: 범위. $limit=50000: 기본 1000개 제한 해제.',
        tool: 'curl',
        run: `curl -sSG ${API} --data-urlencode '$select=sf16_bldgid,mblr,hgt_median_m,gnd_min_m,peak_1st_m,shape' --data-urlencode '$where=within_box(shape, 37.800, -122.420, 37.775, -122.390)' --data-urlencode '$limit=50000' -o ${RAW}`,
      },
    ],
  },
  otherSources: [
    { source: 'vworld', dataset: 'GIS건물통합정보 (지상층수·높이)', note: '국내 건물 높이 데이터. SHP 로그인 다운로드, 약관 확인 전.' },
    { source: 'nsdi', dataset: 'GIS건물통합정보 (시도별 SHP)', note: 'GeoJSON이 아닌 SHP로 배포. 로그인 필요.' },
    { source: 'overture', dataset: 'buildings/building (height 속성)', note: 'CLI -f geojson + 범위로 한국 추출. 높이는 일부 건물만.' },
    { source: 'overpass-turbo', dataset: 'building + height / building:levels 질의', note: '한국 높이 태그 채움 정도 미확인.' },
  ],
  recipes: [
    ...buildingRecipes(preprocess, '원본도 GeoJSON — 문자열 높이→숫자, 빈 높이 9m, MultiPolygon 분해, 작은 구멍 메움, 좌표 7자리. 뷰어가 height만큼 바닥면 돌출.'),
    ...serverRecipes({ category: 'vector-25d', layer: 'sf_buildings', preprocess, work: '/work/buildings.geojson', geom: 'polygon', bounds: [-122.420006, 37.775001, -122.390007, 37.8], height: 'height' }),
  ],
  alternatives: [
    { tool: 'py3dtiles', note: 'PostGIS 테이블 → 3D Tiles 직접 생성([postgres] 확장).' },
  ],
  upload: buildingUpload({ accept: ['.geojson', '.json'], note: '건물 등 면(Polygon) GeoJSON. 높이 열(height, 높이 …) 또는 층수 열(num_floors, GRND_FLR, 지상층수 …) 사용, 없으면 9m.' }),
  view: { center: [-122.399, 37.7915], zoom: 15.3, pitch: 58, bearing: -25, basemap: 'osm' },
  noDomestic: '높이·층수 포함 국내 건물 GeoJSON 배포처 없음. 국내 건물 높이는 SHP로만 배포(2.5D SHP 참고).',
} satisfies FormatSpec
