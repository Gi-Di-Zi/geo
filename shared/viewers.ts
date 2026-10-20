import type { OutputKind, ViewerId } from './types.ts'

export const viewers: { id: ViewerId; name: string; dims: string; summary: string }[] = [
  { id: 'ol', name: 'OpenLayers', dims: '2D', summary: '2D 지도의 정석. 좌표계·래스터(COG) 직접 처리에 강점.' },
  { id: 'maplibre', name: 'MapLibre', dims: '2.5D', summary: '벡터타일 기반 지도. 기울이기, 건물 돌출, 지형.' },
  { id: 'deck', name: 'MapLibre + Deck.gl', dims: '3D', summary: 'MapLibre 위에 Deck.gl 레이어 오버레이. 대용량·3D 데이터.' },
  { id: 'cesium', name: 'Cesium', dims: '3D', summary: '지구본 위 실제 3D. 지형, 3D Tiles, 점군.' },
]

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
