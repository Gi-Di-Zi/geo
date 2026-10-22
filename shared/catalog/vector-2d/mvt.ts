import type { FormatSpec } from '../../types.ts'

// 시청 일대를 덮는 줌 13~14 타일 (VersaTiles는 줌 14까지 제공)
const TILES = ['13/6985/3172', '14/13970/6344', '14/13970/6345', '14/13971/6344', '14/13971/6345']

export default {
  id: 'mvt',
  category: 'vector-2d',
  name: 'Mapbox Vector Tile',
  extensions: ['.mvt', '.pbf'],
  summary: '벡터 데이터를 타일 한 장 크기로 자른 이진 포맷. 웹 지도 배경의 표준.',
  description: '타일 하나에 여러 레이어(도로·건물·물 등), Protocol Buffers 인코딩. 좌표는 타일 내 정수 격자(보통 4096칸) → 작고 빠름. z/x/y 주소로 필요한 타일만 요청. 확장자 .mvt·.pbf (.pbf는 OSM 원본 포맷 확장자와 겹쳐 혼동 쉬움).',
  anatomy: [
    { name: '레이어', role: 'streets·buildings 등 이름별 묶음' },
    { name: '피처', role: '타일 격자(0~4096) 정수 좌표 도형·속성' },
    { name: 'z/x/y 주소', role: '줌·타일 번호. 파일 경로 = 위치 정보' },
  ],
  convertible: true,
  collect: {
    source: 'versatiles',
    dataset: 'VersaTiles OSM 벡터타일 (shortbread 스키마, 시청 일대 5장)',
    url: 'https://versatiles.org',
    how: '공개 벡터타일 서버에서 시청 일대 타일 5장을 z/x/y 주소 그대로 다운로드. 지도 앱 배경지도 타일과 동일.',
    steps: [
      {
        title: '타일 5장 다운로드',
        why: 'z/x/y 주소 → 폴더 경로 그대로. --compressed: 서버 gzip 응답 해제 후 저장.',
        tool: 'curl',
        run: `for t in ${TILES.join(' ')}; do mkdir -p /raw/tiles/$(dirname $t) && curl -sSf --compressed -o /raw/tiles/$t.pbf https://tiles.versatiles.org/tiles/osm/$t; done`,
      },
    ],
  },
  otherSources: [
    { source: 'geofabrik', dataset: 'south-korea shortbread MBTiles', note: '한국 전체 벡터타일, MBTiles 한 파일(약 480MB).' },
    { source: 'protomaps', dataset: '배경지도 PMTiles', note: '같은 벡터타일의 PMTiles 아카이브(.pmtiles 페이지).' },
    { source: 'gsi-japan', dataset: '地理院ベクトルタイル experimental_bvmap/{z}/{x}/{y}.pbf', note: '일본 전역 벡터타일.' },
    { source: 'bbbike', dataset: 'Seoul.osm.mbtiles-shortbread.zip', note: 'MBTiles 안의 MVT 타일.' },
  ],
  recipes: [
    {
      id: 'gdal',
      title: 'GDAL',
      preprocess: [
        {
          title: '무결성 확인',
          why: '타일 한 장에 레이어 16개(주소·건물·도로·물…). GDAL: 경로의 z/x/y로 위치 계산.',
          tool: 'gdal',
          run: 'ogrinfo -so /raw/tiles/14/13970/6344.pbf',
        },
      ],
      convert: [
        {
          title: '타일 그대로 복사',
          why: '원본 그대로 — OpenLayers·MapLibre·Deck.gl이 z/x/y 타일 직접 읽기. 변환 불필요.',
          tool: 'shell',
          run: 'cp -r /raw/tiles /out/tiles',
        },
        {
          title: 'Cesium용 건물 GeoJSON 추출',
          why: '-append: 줌 14 타일 4장의 buildings 레이어 → 한 파일로 병합. -nlt MULTIPOLYGON: 도형 종류 통일. 타일 경계에서 잘린 건물은 분리된 채 유지.',
          tool: 'gdal',
          run: 'for f in /raw/tiles/14/*/*.pbf; do ogr2ogr -append -f GPKG /work/buildings.gpkg $f buildings -nln buildings -nlt MULTIPOLYGON; done && ogr2ogr -f GeoJSON /out/ogc/collections/buildings/items.json /work/buildings.gpkg -lco RFC7946=YES -lco COORDINATE_PRECISION=7',
        },
      ],
      outputs: [
        { id: 'tiles', kind: 'mvt', path: 'tiles/{z}/{x}/{y}.pbf', minzoom: 13, maxzoom: 14, layer: 'buildings', label: 'MVT 타일 (원본 그대로)', why: '원본 그대로 — 변환 불필요. buildings 레이어만 표시. 줌 14 초과 시 줌 14 타일 확대.' },
        { id: 'features', kind: 'geojson', path: 'ogc/collections/buildings/items.json', label: 'GeoJSON (건물)', why: '타일에서 추출한 건물. Cesium용.' },
      ],
      viewers: {
        ol: { output: 'tiles' },
        maplibre: { output: 'tiles' },
        deck: { output: 'tiles' },
        cesium: { output: 'features', note: 'MVT 미지원 → 타일에서 추출한 GeoJSON 사용.' },
      },
    },
  ],
  alternatives: [
    { tool: 'go-pmtiles', cmd: 'pmtiles convert south-korea.mbtiles south-korea.pmtiles', note: '타일 수만 장 → 파일 하나로 묶어 관리.' },
    { tool: 'martin', note: 'PostGIS·PMTiles에서 요청마다 MVT 생성하는 서버.' },
  ],
  upload: { unsupported: '타일 한 장(.pbf)만으로는 위치(z/x/y) 불명. 타일 묶음 → pmtiles convert로 PMTiles 변환 후 .pmtiles 페이지에서 업로드.' },
  view: { center: [126.979, 37.5625], zoom: 15.5 },
  noDomestic: '국내 기관 MVT 벡터타일 공개 원본 없음. OSM 서울 타일(VersaTiles)은 해외 플랫폼.',
} satisfies FormatSpec
