import type { FormatSpec } from '../../types.ts'
import { vectorRecipe, vectorUpload } from './_vector.ts'

const RAW = '/raw/nl_provinces.gml'
const WFS = 'https://service.pdok.nl/cbs/gebiedsindelingen/2025/wfs/v1_0?service=WFS&version=2.0.0&request=GetFeature&typeNames=gebiedsindelingen:provincie_gegeneraliseerd'

export default {
  id: 'gml',
  category: 'vector-2d',
  name: 'GML',
  extensions: ['.gml', '.xml'],
  summary: 'OGC의 XML 기반 지리 데이터 언어. WFS 응답과 국가 표준 데이터에 쓰인다.',
  description: '도형·속성을 XML 태그로 기술. 스키마(.xsd)로 구조를 엄격히 정의 → 기관 간 교환용. 한계: 장황해서 용량 큼, 좌표계마다 좌표 순서(위도 먼저? 경도 먼저?)가 바뀌는 "축 순서" 함정. CityGML·IndoorGML의 바탕.',
  anatomy: [
    { name: 'wfs:member', role: '피처 하나' },
    { name: 'gml:posList', role: '좌표 목록. srsName 축 순서 따름' },
    { name: '.xsd', role: '속성 이름·형식 정의 스키마' },
  ],
  convertible: true,
  collect: {
    source: 'pdok',
    dataset: 'CBS 행정구역 2025, 주(provincie) 경계 일반화본 (WFS)',
    url: 'https://service.pdok.nl/cbs/gebiedsindelingen/2025/wfs/v1_0?request=GetCapabilities&service=WFS',
    how: 'WFS GetFeature 응답(GML 3.2)을 그대로 파일로 저장.',
    steps: [
      {
        title: 'WFS 주 경계 GML 다운로드',
        why: 'outputFormat 생략 → WFS 2.0 기본 응답 GML 3.2.',
        tool: 'curl',
        run: `curl -sSL '${WFS}' -o ${RAW}`,
      },
    ],
  },
  otherSources: [
    { source: 'vworld', dataset: 'WFS GetFeature (GML 응답)', note: '인증키 필요, 약관 확인 전.' },
    { source: 'nsdi', dataset: '국가공간정보포털 WFS (GML 응답)', note: '인증키 필요.' },
  ],
  recipes: [
    vectorRecipe({
      work: '/work/provinces.gpkg',
      layer: 'provinces',
      minzoom: 5,
      maxzoom: 10,
      preprocess: [
        {
          title: '무결성 확인',
          why: 'srsName="urn:ogc:def:crs:EPSG::28992"(네덜란드 RD New, m)·posList 좌표 확인. 이 좌표계는 동쪽(X) 먼저, 위경도 GML은 위도 먼저.',
          tool: 'shell',
          run: `head -c 1600 ${RAW}`,
        },
        {
          title: '위경도 변환',
          why: 'GDAL: srsName 축 순서 해석 후 읽기. -t_srs EPSG:4326: 위경도 변환. 직접 파싱 시 X·Y 뒤바뀜 위험.',
          tool: 'gdal',
          run: `ogr2ogr -f GPKG /work/provinces.gpkg ${RAW} -nln provinces -t_srs EPSG:4326`,
        },
      ],
    }),
  ],
  alternatives: [
    { tool: 'geoserver', note: 'WFS 요청마다 GML 생성·응답.' },
  ],
  upload: vectorUpload({ accept: ['.gml'], note: 'GML 파일 하나. 스키마(.xsd) 없어도 GDAL이 구조 추측.' }),
  view: { center: [5.3, 52.2], zoom: 6.3, basemap: 'osm' },
  closed: '국내 GML 파일 배포처 없음. WFS(VWorld·국가공간정보포털)는 인증키 필요·재배포 제한.',
} satisfies FormatSpec
