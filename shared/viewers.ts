import type { Output, OutputKind, Recipe, ViewerId } from './types.ts'

export const viewers: { id: ViewerId; name: string; dims: string; summary: string }[] = [
  { id: 'ol', name: 'OpenLayers', dims: '2D', summary: '2D 지도의 정석. 좌표계·래스터(COG) 직접 처리에 강점.' },
  { id: 'maplibre', name: 'MapLibre', dims: '2.5D', summary: '벡터타일 기반 지도. 기울이기, 건물 돌출, 지형.' },
  { id: 'deck', name: 'MapLibre + Deck.gl', dims: '3D', summary: 'MapLibre 위에 Deck.gl 레이어 오버레이. 대용량·3D 데이터.' },
  { id: 'cesium', name: 'CesiumJS', dims: '3D', summary: '지구본 위 실제 3D. 지형, 3D Tiles, 점군.' },
]

/**
 * 엔진 렌더러. 웹 페이지 밖(언리얼 에디터)에서 그려 파이프라인이 자동 확인하지 못한다 → 불러오는 방법만 안내, 상태는 수동 확인.
 * CesiumJS와 같은 회사·같은 형식, 구현은 C++ 런타임(cesium-native). kinds = 이 사이트 결과물 중 연결하는 것 (배경 영상 WMS·WMTS도 읽지만 3D 결과만 잇는다)
 */
export const engine = {
  name: 'Cesium for Unreal', dims: '엔진', family: 'cesium' as ViewerId,
  summary: '언리얼 엔진 플러그인. CesiumJS와 같은 형식(3D Tiles·quantized-mesh 지형)을 C++ 런타임(cesium-native)으로 읽음. 게임 엔진급 화질·시뮬레이션·VR.',
  kinds: ['3dtiles', 'quantized-mesh'] as OutputKind[],
}

/** 엔진이 읽을 결과물: CesiumJS가 쓰는 것이 3D Tiles·지형이면 그것, 아니면 첫 3D Tiles·지형. 사이트 카드와 scripts/unreal.ts가 같이 쓴다 */
export function engineOutput(recipe: Recipe): Output | undefined {
  const use = recipe.viewers[engine.family]
  const own = 'output' in use ? recipe.outputs.find(o => o.id === use.output) : undefined
  return own && engine.kinds.includes(own.kind) ? own : recipe.outputs.find(o => engine.kinds.includes(o.kind))
}
/** 엔진에 넘길 주소 경로: 지형 폴더는 layer.json을 가리켜야 quantized-mesh로 읽는다 */
export const engineTarget = (o: Output) => o.path + (o.kind === 'quantized-mesh' ? '/layer.json' : '')

/** 각 뷰어 컴포넌트가 구현한 출력 종류. check 스크립트와 화면이 같이 쓴다 */
export const viewerKinds: Record<ViewerId, OutputKind[]> = {
  ol: ['geojson', 'mvt', 'pmtiles', 'image', 'cog', 'xyz-raster', 'wms'],
  maplibre: ['geojson', 'mvt', 'pmtiles', 'image', 'xyz-raster', 'terrain-rgb'],
  deck: ['geojson', 'mvt', 'pmtiles', 'image', 'xyz-raster', 'terrain-rgb', '3dtiles', 'glb'],
  cesium: ['geojson', 'image', 'xyz-raster', 'quantized-mesh', '3dtiles', 'glb', 'wms'],
}

export const kindLabels: Record<OutputKind, string> = {
  'geojson': 'GeoJSON',
  'mvt': 'MVT 벡터타일',
  'pmtiles': 'PMTiles',
  'image': '단일 이미지',
  'cog': 'COG',
  'xyz-raster': 'XYZ 래스터 타일',
  'terrain-rgb': 'Terrain-RGB 타일',
  'quantized-mesh': 'Quantized-mesh',
  '3dtiles': '3D Tiles',
  'glb': 'glTF (GLB)',
  'wms': 'WMS 이미지',
}
