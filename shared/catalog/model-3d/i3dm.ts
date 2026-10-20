import type { FormatSpec, Step } from '../../types.ts'
import { bundleUpload } from '../_bundle.ts'

const TILESET = 'https://3d.geo.admin.ch/ch.swisstopo.vegetation.3d/v1/20250728/tileset.json'

const no2d = {
  ol: { unsupported: '2D 지도 — 3D 모델 미지원.' },
  maplibre: { unsupported: '3D Tiles 기본 레이어 없음.' },
}
const noDeck = { unsupported: 'loaders.gl: i3dm 외부 모델 경로를 타일 아닌 페이지 기준으로 탐색, 인스턴스 방향(NORMAL_UP·NORMAL_RIGHT) 미적용 → 나무 위치 오류.' }

// 두 레시피가 같이 쓰는 살펴보기
const inspect: Step[] = [
  {
    title: '무결성 확인 (tileset.json)',
    why: '루트 경계: 위경도 region. 외부 tileset.json을 가리키는 타일 혼재 → 스위스 전역을 여러 파일로 분할한 구조.',
    tool: 'shell',
    run: 'head -c 900 /raw/tiles/tileset.json',
  },
  {
    title: '무결성 확인 (타일 헤더)',
    why: '헤더·피처 테이블 → 나무 수(INSTANCES_LENGTH), 위치·방향·크기 저장 방식. 수종별 모델 → i3dm 여러 개를 복합 타일(cmpt) 하나로 묶은 경우 다수. gltfFormat 0: 모델 없이 외부 glb 주소만.',
    tool: 'python',
    run: "python /scripts/tile_header.py $(find /raw/tiles -name '*.i3dm' | sort | head -1)",
  },
]

export default {
  id: 'i3dm',
  category: 'model-3d',
  name: 'Instanced 3D Model',
  extensions: ['.i3dm'],
  summary: '모델 하나를 위치·방향·크기만 바꿔 반복 배치하는 3D Tiles 타일. 가로수, 가로등.',
  description: '나무 1,000그루를 각각 모델로 → 같은 형상 1,000번 중복. i3dm: 모델 1회 저장 + 점별 위치·방향·크기 → GPU 반복 그리기(인스턴싱). 3D Tiles 1.1부터 glb의 EXT_mesh_gpu_instancing 확장이 대체.',
  anatomy: [
    { name: '헤더 (32바이트)', role: 'b3dm보다 4바이트 많음. gltfFormat 1: GLB 통째, 0: 주소(URI)만' },
    { name: '피처 테이블', role: 'INSTANCES_LENGTH, POSITION, 방향(NORMAL_UP/RIGHT 또는 EAST_NORTH_UP), SCALE' },
    { name: '배치 테이블', role: '인스턴스별 속성 (수종 등)' },
    { name: 'glTF', role: '반복할 모델 1개. 외부 glb 하나를 여러 타일이 공유하는 경우도' },
  ],
  convertible: true,
  collect: {
    source: 'swisstopo',
    dataset: 'swisstopo 3D 식생 (ch.swisstopo.vegetation.3d, 2025-07-28), 취리히 플라츠슈피츠 공원 일대',
    url: 'https://docs.geo.admin.ch/visualize-data/3d-tiles.html',
    how: '스위스 연방 지형청의 전국 나무 i3dm 타일 서비스. 그중 취리히 공원 한 곳만.',
    derived: '스위스 전역 타일셋 중 플라츠슈피츠 일대(경도 8.534~8.546°, 위도 47.374~47.386°)와 겹치는 타일만, tileset.json(외부 타일셋 포함)에서 나머지 제거. 타일·나무 모델(glb)은 원본 그대로.',
    steps: [
      {
        title: '공원 일대 타일만 다운로드',
        why: '위경도 경계(region)가 구역과 겹치는 타일만, 모든 깊이. 외부 타일셋(json)도 같은 규칙으로 추림. i3dm이 참조하는 나무 모델(glb) 포함.',
        tool: 'python',
        run: `python /scripts/tiles_subset.py ${TILESET} 8.540 47.380 0.006 /raw/tiles`,
      },
    ],
  },
  otherSources: [
    { source: 'seoul', dataset: '서울시 가로수 위치정보 OA-23040', note: 'i3dm 아닌 점 데이터. 공공누리 4유형(변경금지·비상업) → 변환 결과 게시 불가.' },
    { source: 'vworld', dataset: '3D 시설물 모델', note: '공개제한 → 사용 불가.' },
  ],
  recipes: [
    {
      id: 'tiles',
      title: '그대로 올리기',
      preprocess: inspect,
      convert: [
        {
          title: '타일셋 올리기',
          why: '원본도 3D Tiles — 웹 배포용 포맷, 변환 불필요. 모델 상대 경로 참조(../../Tree-3.glb) → 폴더 구조 유지.',
          tool: 'shell',
          run: 'cp -r /raw/tiles/. /out/tiles/',
        },
      ],
      outputs: [
        { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles 1.0 (i3dm)', why: '원본 그대로 — 이미 웹용 3D Tiles. 나무 모델은 별도 glb 몇 개, 타일엔 위치·방향·크기 목록만. Cesium용.' },
      ],
      viewers: { ...no2d, deck: noDeck, cesium: { output: 'tiles' } },
    },
    {
      id: 'upgrade',
      title: '3d-tiles-tools (1.1로 올리기)',
      preprocess: [
        ...inspect,
        {
          title: '모델 경로 맞춤 배치',
          why: '규격: 모델 주소(../../Tree-3.glb)는 타일 기준. 3d-tiles-tools 0.5.4: tileset.json 기준 탐색 → "Could not resolve external GLB" 실패. 타일셋을 두 단계 아래 폴더로 옮겨 도구 탐색 위치에 모델 배치.',
          tool: 'shell',
          run: 'mkdir -p /work/a/b && cp -r /raw/tiles /work/a/b/tiles && cp /raw/tiles/*.glb /work/a/ && ls /work/a',
        },
      ],
      convert: [
        {
          title: '3D Tiles 1.1 변환',
          why: 'i3dm별 외부 모델 → glb 하나로 병합. 인스턴스 위치·방향·크기 → glTF 확장 EXT_mesh_gpu_instancing. 1.1은 타일 전부 glb → 뷰어의 i3dm 전용 해석 불필요.',
          tool: '3d-tiles-tools',
          run: '3d-tiles-tools upgrade -i /work/a/b/tiles/tileset.json -o /out/tiles --targetVersion 1.1 --force',
        },
      ],
      outputs: [
        { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles 1.1 (glb + EXT_mesh_gpu_instancing)', why: '타일별 모델 + 인스턴스 목록 glb. Cesium용.' },
      ],
      viewers: {
        ...no2d,
        deck: { unsupported: 'loaders.gl glTF 로더 EXT_mesh_gpu_instancing 미지원 → 나무 한 그루씩만 표시.' },
        cesium: { output: 'tiles' },
      },
    },
  ],
  alternatives: [
    { tool: 'mago-3d-tiler', cmd: 'mago-3d-tiler -i ./trees -o ./tiles -it geojson -ot i3dm -if tree.glb', note: '나무 점(GeoJSON) + 모델 1개 → i3dm 직접 생성.' },
    { tool: 'i3dm-export', note: 'PostGIS 표(위치·방향·크기·모델) → i3dm 타일.' },
  ],
  upload: bundleUpload({
    marker: 'tileset.json',
    dest: 'tiles',
    note: 'tileset.json + .i3dm 타일 + 참조 모델 파일을 zip 하나로.',
    outputs: [{ id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (올린 그대로)', why: '이미 웹용 3D Tiles — 변경 없이 그대로 배포.' }],
    viewers: { ...no2d, deck: noDeck, cesium: { output: 'tiles' } },
  }),
  view: { center: [8.5405, 47.3805], zoom: 17, pitch: 55, bearing: 20, height: 450, basemap: 'osm' },
  closed: '국내 i3dm 공개 원본 없음.',
} satisfies FormatSpec
