import type { FormatSpec } from '../../types.ts'
import { vectorRecipe, vectorUpload } from './_vector.ts'

const RAW = '/raw/countries.fgb'

export default {
  id: 'fgb',
  category: 'vector-2d',
  name: 'FlatGeobuf',
  extensions: ['.fgb'],
  summary: '공간 인덱스를 품은 이진 벡터 파일. HTTP Range 요청으로 필요한 영역만 읽는다.',
  description: 'FlatBuffers로 피처를 이어 쓰고 파일 앞에 R-tree 인덱스. 서버 없이 파일 하나로 "이 범위 피처만" 요청 가능(벡터판 COG). GeoJSON보다 작고 빠름. 국내 공공데이터 배포 사례 없음 → FlatGeobuf 프로젝트의 세계 국가 경계 사용.',
  anatomy: [
    { name: '헤더', role: '도형 종류, 좌표계, 속성 목록' },
    { name: '공간 인덱스 (packed R-tree)', role: '범위 → 피처 위치. Range 요청으로 먼저 읽기' },
    { name: '피처', role: 'FlatBuffers 직렬화 도형·속성' },
  ],
  convertible: true,
  collect: {
    source: 'flatgeobuf',
    dataset: 'FlatGeobuf 테스트 데이터 countries.fgb (세계 179개국 경계)',
    url: 'https://github.com/flatgeobuf/flatgeobuf/tree/master/test/data',
    how: 'FlatGeobuf 프로젝트 공개 .fgb 파일 그대로.',
    steps: [
      {
        title: '세계 국가 경계 FGB 다운로드',
        why: '프로젝트 사이트에서 직접 다운로드. 변환 없음.',
        tool: 'curl',
        run: `curl -sSL https://flatgeobuf.org/test/data/countries.fgb -o ${RAW}`,
      },
    ],
  },
  otherSources: [],
  recipes: [
    vectorRecipe({
      work: '/work/countries.gpkg',
      layer: 'countries',
      minzoom: 0,
      maxzoom: 5,
      preprocess: [
        {
          title: '무결성 확인',
          why: '피처 수·범위·좌표계 확인. 이미 위경도(EPSG:4326) → 좌표계 변환 불필요.',
          tool: 'gdal',
          run: `ogrinfo -so -al ${RAW}`,
        },
        {
          title: '꼬인 도형 수정',
          why: '-makevalid: 남극·캐나다의 비정상 다각형(안 닫힘·자기 교차) 수정. 미수정 시 GeoJSON 변환에서 "LinearRing 미폐합" 오류.',
          tool: 'gdal',
          run: `ogr2ogr -f GPKG /work/countries.gpkg ${RAW} -nln countries -makevalid`,
        },
      ],
    }),
  ],
  alternatives: [
    { tool: 'gdal', cmd: 'ogrinfo /vsicurl/https://flatgeobuf.org/test/data/countries.fgb -spat 124 33 132 39', note: '원격 FGB에서 범위 내 피처만 Range 요청. 브라우저는 flatgeobuf 라이브러리로 동일.' },
    { tool: 'tippecanoe', cmd: 'tippecanoe -o countries.pmtiles -zg countries.fgb', note: 'FGB 입력이 GeoJSON보다 빠름.' },
  ],
  upload: vectorUpload({ accept: ['.fgb'], note: 'FlatGeobuf 파일 하나.' }),
  view: { center: [127, 30], zoom: 1.6, basemap: 'osm' },
  closed: '국내 FlatGeobuf 배포처 없음.',
} satisfies FormatSpec
