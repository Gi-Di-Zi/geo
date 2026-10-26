import type { FormatSpec } from '../../types.ts'

const RAW = '/raw/seoul_basemap.pmtiles'

export default {
  id: 'pmtiles',
  category: 'vector-2d',
  name: 'PMTiles',
  extensions: ['.pmtiles'],
  summary: '타일 수천 장을 담은 단일 파일 아카이브. 서버 없이 HTTP Range 요청으로 읽는다.',
  description: 'z/x/y 폴더는 파일 수만 개, MBTiles는 SQLite라 서버 필요. PMTiles: 타일을 한 파일에 이어 붙이고 앞에 목차 → 정적 호스팅(S3, GitHub Pages)만으로 지도 서비스. COG의 벡터타일판.',
  anatomy: [
    { name: '헤더 (127바이트)', role: '줌 범위, 영역, 목차 위치' },
    { name: '디렉터리', role: '타일 번호 → 파일 안 위치(오프셋, 길이) 목록' },
    { name: '타일 데이터', role: 'MVT 타일들을 이어 붙인 본문' },
  ],
  convertible: true,
  collect: {
    source: 'protomaps',
    dataset: 'Protomaps 배경지도 빌드 2026-08-11 (스키마 4.15.1, 시청 일대 추출)',
    url: 'https://docs.protomaps.com/basemaps/downloads',
    how: '전 세계 OSM 배경지도 PMTiles(약 130GB, 일일 빌드) → pmtiles extract가 Range 요청으로 시청 일대만 작은 PMTiles로 추출.',
    steps: [
      {
        title: '전 세계 파일에서 시청 일대 추출',
        why: '130GB 전체 다운로드 없음 — 목차 읽고 필요한 타일 구간만 요청. --bbox: 시청 범위. --maxzoom=15: 최대 줌. 20260811: 일일 빌드는 약 1주 뒤 삭제 → 스키마 버전(4.15.1)마다 남기는 빌드로 고정.',
        tool: 'go-pmtiles',
        run: `pmtiles extract https://build.protomaps.com/20260811.pmtiles ${RAW} --bbox=126.970,37.555,126.990,37.570 --maxzoom=15`,
      },
    ],
  },
  otherSources: [
    { source: 'geofabrik', dataset: 'south-korea shortbread MBTiles', note: 'MBTiles 다운로드 → pmtiles convert로 변환 가능.' },
    { source: 'overture', dataset: 'tiles/<릴리스>/buildings.pmtiles 등 테마별', note: '확인용(운영 비권장).' },
    { source: 'source-coop', dataset: 'VIDA 건물 KOR.pmtiles', note: '한국 건물, ODbL.' },
    { source: 'bbbike', dataset: 'Seoul.osm.pmtiles-shortbread.zip', note: '서울 shortbread 스키마, 약 29MB.' },
  ],
  recipes: [
    {
      id: 'gdal',
      title: 'go-pmtiles + GDAL',
      preprocess: [
        {
          title: '무결성 확인',
          why: '줌 범위·영역·레이어(도로·건물·물…) 확인.',
          tool: 'go-pmtiles',
          run: `pmtiles show ${RAW}`,
        },
      ],
      convert: [
        {
          title: 'PMTiles 그대로 복사',
          why: '원본 그대로 — 변환 불필요. OpenLayers·MapLibre: 플러그인, Deck.gl: 타일 요청 함수 교체로 직접 읽기.',
          tool: 'shell',
          run: `cp ${RAW} /out/seoul.pmtiles`,
        },
        {
          title: 'Cesium용 도로 GeoJSON 추출',
          why: 'Cesium 벡터타일 미지원 → roads 레이어를 GeoJSON 한 파일로. -nlt MULTILINESTRING: 도형 종류 통일. COORDINATE_PRECISION=7(약 1cm): 6자리(약 10cm)면 짧은 선이 점으로 뭉개져 GeometryCollection 발생.',
          tool: 'gdal',
          run: `ogr2ogr -f GeoJSON /out/ogc/collections/roads/items.json ${RAW} roads -nlt MULTILINESTRING -lco RFC7946=YES -lco COORDINATE_PRECISION=7`,
        },
      ],
      outputs: [
        { id: 'pmtiles', kind: 'pmtiles', path: 'seoul.pmtiles', minzoom: 0, maxzoom: 15, layer: 'roads', label: 'PMTiles', why: '원본 그대로 — 뷰어가 직접 읽어 변환 불필요. 필요한 타일만 Range 요청.' },
        { id: 'features', kind: 'geojson', path: 'ogc/collections/roads/items.json', label: 'GeoJSON (도로)', why: '타일로 나뉘지 않은 도로 전체. Cesium용.' },
      ],
      viewers: {
        ol: { output: 'pmtiles', note: 'ol-pmtiles 플러그인으로 직접 읽기.' },
        maplibre: { output: 'pmtiles', note: 'pmtiles 프로토콜 등록 후 직접 읽기.' },
        deck: { output: 'pmtiles', note: 'MVTLayer 타일 요청 → PMTiles 읽기로 교체.' },
        cesium: { output: 'features', note: '벡터타일 미지원 → GeoJSON 사용.' },
      },
    },
  ],
  alternatives: [],
  upload: {
    accept: ['.pmtiles'],
    note: '벡터 PMTiles. 레이어가 여러 개면 모두 표시.',
    recipes: [{
      id: 'gdal',
      title: 'go-pmtiles + GDAL',
      preprocess: [
        { title: '무결성 확인', why: '줌 범위·영역·레이어 확인.', tool: 'go-pmtiles', run: 'pmtiles show $INPUT' },
      ],
      convert: [
        { title: 'PMTiles 그대로 복사', why: '원본 그대로 — OpenLayers·MapLibre·Deck.gl 직접 읽기, 변환 불필요.', tool: 'shell', run: 'cp $INPUT /out/data.pmtiles' },
        {
          title: 'Cesium용 GeoJSON 추출',
          why: 'Cesium 벡터타일 미지원 → 최대 줌 타일을 GeoJSON 한 파일로. -addfields: 여러 레이어 병합. -nlt GEOMETRY: 도형 종류 혼합 허용. 타일 경계에서 잘린 도형은 분리된 채 유지.',
          tool: 'gdal',
          run: 'ogr2ogr -f GPKG /work/data.gpkg $INPUT -nln data -nlt GEOMETRY -addfields && ogr2ogr -f GeoJSON /out/ogc/collections/data/items.json /work/data.gpkg -lco RFC7946=YES -lco COORDINATE_PRECISION=7',
        },
      ],
      outputs: [
        { id: 'pmtiles', kind: 'pmtiles', path: 'data.pmtiles', label: 'PMTiles (올린 파일 그대로)', why: '올린 파일 그대로 — 변환 불필요. 레이어 이름은 파일 내 목록에서.' },
        { id: 'features', kind: 'geojson', path: 'ogc/collections/data/items.json', label: 'GeoJSON', why: '타일에서 추출한 도형. Cesium용.' },
      ],
      viewers: {
        ol: { output: 'pmtiles' },
        maplibre: { output: 'pmtiles', note: '레이어 이름 미지정 → 파일 내 목록(vector_layers)의 레이어 모두 표시.' },
        deck: { output: 'pmtiles' },
        cesium: { output: 'features', note: '벡터타일 미지원 → GeoJSON 사용.' },
      },
    }],
  },
  view: { center: [126.979, 37.5635], zoom: 15 },
  noDomestic: '국내 기관 PMTiles 배포처 없음. OSM 서울 추출본(Protomaps)은 해외 플랫폼.',
} satisfies FormatSpec
