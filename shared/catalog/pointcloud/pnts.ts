import type { FormatSpec } from '../../types.ts'
import { bundleUpload } from '../_bundle.ts'

const TILESET = 'https://yamanashi-tile.geospatial.jp/tile/2024/01/tileset.json'

export default {
  id: 'pnts',
  category: 'pointcloud',
  name: '3D Tiles Point Cloud',
  extensions: ['.pnts'],
  summary: '3D Tiles 1.0의 점군 타일. tileset.json이 .pnts 파일 수십~수천 개를 엮는다.',
  description: '.pnts 1개 = 점 묶음 1개. 위치·로딩 시점은 tileset.json이 결정. 가까울수록 촘촘한 타일(LOD) → 수억 개 점도 웹 표시 가능. 3D Tiles 1.1부터 점군도 glb 권장.',
  anatomy: [
    { name: 'tileset.json', role: '타일 나무 구조, 경계 상자, 기하 오차(geometricError), refine(ADD/REPLACE)' },
    { name: '.pnts 헤더', role: '28바이트: 종류, 버전, 길이, 피처·배치 테이블 크기' },
    { name: '피처 테이블', role: 'POINTS_LENGTH, POSITION(또는 POSITION_QUANTIZED), RGB, RTC_CENTER' },
    { name: '배치 테이블', role: '분류 코드 같은 점별 속성 (있을 때만)' },
  ],
  convertible: true,
  collect: {
    source: 'geospatial-jp',
    dataset: '야마나시현 MMS 점군 2024 (3D Tiles), 01 구간',
    url: 'https://www.geospatial.jp/ckan/dataset/yamanashi-pointcloud-2024',
    how: '야마나시현 차량 측량(MMS) 점군, 3D Tiles(pnts)로 직접 공개. 그중 한 구역만.',
    license: 'CC BY 4.0 (또는 ODbL)',
    attribution: '山梨県',
    derived: '타일 4,294장 중 타일셋 중심 80m 구역과 겹치는 타일만, tileset.json에서 나머지 제거. 타일 자체는 원본 그대로. refine ADD → 상위 타일의 성긴 점은 전체 범위에 잔존.',
    steps: [
      {
        title: '구역 타일만 다운로드',
        why: '루트 transform 기준 지역 좌표(m)에서 경계 상자가 구역과 겹치는 타일만, 모든 깊이.',
        tool: 'python',
        run: `python /scripts/tiles_subset.py ${TILESET} 0 0 40 /raw/tiles`,
      },
    ],
  },
  otherSources: [
    { source: 'cesium-samples', dataset: '3d-tiles-samples PointCloud 예제', note: 'LICENSE 파일이 없어 재배포 조건이 불명확.' },
  ],
  recipes: [
    {
      id: 'tiles',
      title: '그대로 올리기',
      preprocess: [
        {
          title: '무결성 확인 (tileset.json)',
          why: '루트 아래 타일 트리. geometricError 클수록 거친 단계. refine ADD → 자식 점을 부모 점에 추가.',
          tool: 'shell',
          run: 'head -c 900 /raw/tiles/tileset.json',
        },
        {
          title: '무결성 확인 (타일 헤더)',
          why: '헤더·피처 테이블 → 점 수·저장 방식. 3DTILES_draco_point_compression: 위치·색 Draco 압축 → 뷰어가 Draco 디코더로 해제.',
          tool: 'python',
          run: 'python /scripts/tile_header.py /raw/tiles/0/0.pnts',
        },
      ],
      convert: [
        {
          title: '타일셋 올리기',
          why: '원본도 3D Tiles — 웹 배포용 포맷, 변환 불필요. tileset.json의 상대 경로 참조 → 폴더 구조 유지.',
          tool: 'shell',
          run: 'cp -r /raw/tiles/. /out/tiles/',
        },
      ],
      outputs: [
        { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (pnts)', why: '원본 그대로 — 이미 웹용 3D Tiles. tileset.json만 지정 → 뷰어가 필요한 .pnts 선택 요청.' },
      ],
      viewers: {
        ol: { unsupported: '2D 지도 — 3D 점군 미지원.' },
        maplibre: { unsupported: '3D Tiles 레이어 없음.' },
        deck: { output: 'tiles' },
        cesium: { output: 'tiles' },
      },
    },
  ],
  alternatives: [
    { tool: '3d-tiles-tools', cmd: 'npx 3d-tiles-tools upgrade -i tileset.json -o tileset_1_1 --targetVersion 1.1', note: '3D Tiles 1.1(glb 기반)로 업그레이드.' },
    { tool: 'mago-3d-tiler', cmd: 'mago-3d-tiler -i ./las -o ./tiles -it las', note: '다른 도구로 만든 pnts 타일셋(LAS 페이지 비교 참고).' },
  ],
  upload: bundleUpload({
    marker: 'tileset.json',
    dest: 'tiles',
    note: 'tileset.json + .pnts 타일을 zip 하나로. .pnts 단독으로는 위치·구조 불명.',
    outputs: [{ id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (올린 그대로)', why: '이미 웹용 3D Tiles — 변경 없이 그대로 배포.' }],
    viewers: {
      ol: { unsupported: '2D 지도 — 3D 점군 미지원.' },
      maplibre: { unsupported: '3D Tiles 레이어 없음.' },
      deck: { output: 'tiles' },
      cesium: { output: 'tiles' },
    },
  }),
  view: { center: [138.452, 35.35], zoom: 17, pitch: 55, bearing: 30, height: 270, basemap: 'osm' },
  noDomestic: '국내 3D Tiles 점군 공개 원본 없음.',
} satisfies FormatSpec
