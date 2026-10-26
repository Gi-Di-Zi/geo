import type { FormatSpec } from '../../types.ts'
import { bundleUpload } from '../_bundle.ts'

export default {
  id: 'terrain',
  category: 'terrain',
  name: 'Quantized-mesh',
  extensions: ['.terrain'],
  summary: 'Cesium용 지형 타일. 높이 격자 대신 타일마다 삼각형 메시.',
  description: '평지는 큰 삼각형, 험지는 작은 삼각형 → 같은 정확도에서 높이 이미지보다 가벼움. 위경도 격자(TMS, 줌 0에 2장) 타일, layer.json에 타일 목록. 사실상 Cesium 전용.',
  anatomy: [
    { name: 'layer.json', role: '포맷, 타일 주소 규칙({z}/{x}/{y}.terrain), 줌별로 있는 타일 범위' },
    { name: '헤더', role: '타일 중심(지구 중심 좌표), 최저·최고 높이, 경계 구' },
    { name: '정점·삼각형', role: '0~32767로 양자화한 u, v, 높이와 삼각형 인덱스' },
    { name: '확장', role: '조명용 법선(octvertexnormals), 물 마스크 등' },
  ],
  convertible: true,
  collect: {
    source: 'swisstopo',
    dataset: 'swisstopo 3D 지형 (ch.swisstopo.terrain.3d), 마터호른 일대',
    url: 'https://docs.geo.admin.ch/visualize-data/terrain-service.html',
    how: '스위스 연방 지형청의 Cesium용 quantized-mesh 지형 서비스. 마터호른 일대 타일만 수신.',
    derived: '스위스 전역 중 마터호른 일대(경도 7.60~7.72°, 위도 45.95~46.03°) 줌 0~14 타일만. layer.json 타일 목록을 그 범위로 수정. 타일은 원본 그대로.',
    steps: [
      {
        title: '마터호른 일대 타일만 받기',
        why: 'layer.json 주소 규칙 → 범위에 걸치는 타일만 줌별 수신 (TMS라 y는 남쪽부터). 줌 0 두 장: Cesium 지구 표시에 필수 → 항상 포함. metadata 확장(서버 전체 하위 타일 정보): 일부만 올리므로 layer.json에서 제거.',
        tool: 'python',
        run: 'python /scripts/qm_fetch.py https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/ 7.60 45.95 7.72 46.03 14 /raw/terrain',
      },
    ],
  },
  otherSources: [],
  recipes: [
    {
      id: 'cesium',
      title: '그대로 올리기',
      preprocess: [
        {
          title: '무결성 확인 (layer.json)',
          why: 'tiles: 주소 규칙, scheme: tms, available: 줌별 타일 범위.',
          tool: 'shell',
          run: 'head -c 900 /raw/terrain/layer.json',
        },
        {
          title: '무결성 확인 (타일 헤더)',
          why: '마터호른 봉우리 줌 13 타일(x 8540, y 6188) 헤더: 중심 위치, 높이 범위, 정점·삼각형 수. TMS라 y는 남쪽부터.',
          tool: 'python',
          run: 'python /scripts/qm_header.py /raw/terrain/13/8540/6188.terrain',
        },
      ],
      convert: [
        {
          title: '타일 폴더 그대로 올리기',
          why: '원본도 quantized-mesh — 이미 Cesium용 웹 형태라 변환 없이 복사. 정적 호스팅: 타일 gzip 해제 또는 Content-Encoding 헤더 필요.',
          tool: 'shell',
          run: 'cp -r /raw/terrain /out/terrain',
        },
      ],
      outputs: [
        { id: 'mesh', kind: 'quantized-mesh', path: 'terrain', label: 'quantized-mesh 타일', why: '원본 그대로 — 이미 Cesium용 웹 형태. .terrain 타일 + layer.json(범위 수정본).' },
      ],
      viewers: {
        ol: { unsupported: '2D 지도 — 지형 입체 미지원.' },
        maplibre: { unsupported: 'raster-dem(높이 이미지)만 지원 — quantized-mesh 미지원 → DEM에서 Terrain-RGB 별도 생성.' },
        deck: { unsupported: 'TerrainLayer: 높이 이미지 타일 전용. TMS quantized-mesh 타일 기본 레이어 없음.' },
        cesium: { output: 'mesh' },
      },
    },
  ],
  alternatives: [],
  upload: bundleUpload({
    id: 'cesium',
    marker: 'layer.json',
    dest: 'terrain',
    note: 'layer.json + {z}/{x}/{y}.terrain 타일 zip 하나. 타일 한 장만으로는 위치 불명.',
    outputs: [{ id: 'mesh', kind: 'quantized-mesh', path: 'terrain', label: 'quantized-mesh 타일', why: '올린 그대로 — 이미 Cesium용 웹 형태, 변환 불필요. 타일 + layer.json.' }],
    viewers: {
      ol: { unsupported: '2D 지도 — 지형 입체 미지원.' },
      maplibre: { unsupported: 'raster-dem(높이 이미지)만 지원.' },
      deck: { unsupported: 'quantized-mesh 타일 기본 레이어 없음.' },
      cesium: { output: 'mesh' },
    },
  }),
  view: { center: [7.6586, 45.9763], zoom: 12, pitch: 60, bearing: 20, height: 3000, basemap: 'osm' },
  noDomestic: '국내 quantized-mesh 공개 원본 없음. 대구 3D지도 지형은 공공누리 미표시 → 대구시 정책상 사전 협의 필요.',
} satisfies FormatSpec
