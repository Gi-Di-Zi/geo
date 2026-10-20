import { categories } from '#shared/catalog/categories'
import { originLabels, origins } from '#shared/catalog/origins'
import { sources } from '#shared/catalog/sources'
import { tools, toolTypes } from '#shared/catalog/tools'
import type { FormatSpec, OutputKind, Recipe, ViewerId } from '#shared/types'

// <category>/<format>.ts만 spec이다 (_로 시작하는 파일은 spec을 만드는 도우미). 목록은 nuxt.config.ts의 모듈이 만든다
// @ts-expect-error 빌드 때 생기는 파일이라 타입 검사기가 모른다
import specs from '#build/catalog-formats'
export const formats = specs as FormatSpec[]

export { categories, origins, originLabels, sources, tools, toolTypes }

/** 확장자 하나를 따라가는 네 단계. 상단 단계 막대와 페이지가 같이 쓴다 */
export const flow = [
  { id: 'collect', name: '수집', text: '공개 원본 수집 또는 내 파일 업로드.' },
  { id: 'preprocess', name: '전처리', text: '무결성 확인, 좌표계·인코딩·범위·속성 정리.' },
  { id: 'convert', name: '웹 형태 변환', text: '브라우저가 바로 읽는 포맷으로 변환. 뷰어별 처리 방식.' },
  { id: 'view', name: '화면 비교', text: '지도 라이브러리 4종에서 결과 확인.' },
] as const
export type FlowStep = (typeof flow)[number]['id']

/** 뷰어가 결과물 종류마다 쓰는 API (components/viewers의 실제 코드와 같다) */
export const viewerApi: Record<ViewerId, Partial<Record<OutputKind, string>>> = {
  ol: {
    'geojson': 'VectorLayer + VectorSource(GeoJSON)',
    'mvt': 'VectorTileLayer + VectorTileSource(MVT)',
    'pmtiles': 'VectorTileLayer + PMTilesVectorSource (ol-pmtiles)',
    'cog': 'WebGLTileLayer + GeoTIFF 소스 — 블록 Range 요청',
    'xyz-raster': 'TileLayer + XYZ',
    'image': 'ImageLayer + ImageStatic — 네 모서리 범위',
  },
  maplibre: {
    'geojson': 'geojson 소스 + fill·line·circle (높이 있으면 fill-extrusion)',
    'mvt': 'vector 소스 + fill·line·circle',
    'pmtiles': 'pmtiles:// 프로토콜 + vector 소스',
    'xyz-raster': 'raster 소스',
    'image': 'image 소스 — 네 모서리 좌표',
    'terrain-rgb': 'raster-dem 소스 + setTerrain + hillshade',
  },
  deck: {
    'geojson': 'GeoJsonLayer (높이 있으면 extruded)',
    'mvt': 'MVTLayer',
    'pmtiles': 'MVTLayer + PMTiles getZxy (fetch 교체)',
    'xyz-raster': 'TileLayer + BitmapLayer',
    'image': 'BitmapLayer — 네 모서리 범위',
    'terrain-rgb': 'TerrainLayer — RGB → 높이 디코딩',
    '3dtiles': 'Tile3DLayer (loaders.gl Tiles3DLoader)',
    'glb': 'ScenegraphLayer',
  },
  cesium: {
    'geojson': 'GeoJsonDataSource',
    'xyz-raster': 'UrlTemplateImageryProvider',
    'image': 'SingleTileImageryProvider',
    'quantized-mesh': 'CesiumTerrainProvider',
    '3dtiles': 'Cesium3DTileset',
    'glb': 'Model.fromGltfAsync',
  },
}

/** 확장자 자체가 웹 결과물 종류인 경우. 결과물이 원본과 같은 형식인지 표시하는 데 쓴다 */
export const nativeKind: Record<string, OutputKind> = { geojson: 'geojson', mvt: 'mvt', pmtiles: 'pmtiles', cog: 'cog', terrain: 'quantized-mesh', pnts: '3dtiles', i3dm: '3dtiles', glb: 'glb' }

/** 단계 주소. 첫 단계는 확장자 주소 그대로 */
export const stepPath = (f: FormatSpec, step: FlowStep) => `/${f.category}/${f.id}${step === 'collect' ? '' : `/${step}`}`

export const categoryOf = (id: string) => categories.find(c => c.id === id)
export const toolOf = (id: string) => tools.find(t => t.id === id)
export const sourceOf = (id: string) => sources.find(s => s.id === id)
export const formatsOf = (categoryId: string) => formats.filter(f => f.category === categoryId)
export const formatOf = (categoryId: string, id: string) => formats.find(f => f.category === categoryId && f.id === id)

export const supports = (recipe: Recipe, viewer: ViewerId) => 'output' in recipe.viewers[viewer]

/** 확장자 검색: '.laz', 'laz', 'LAS' 모두 찾는다 */
export function searchFormats(q: string) {
  const s = q.trim().toLowerCase().replace(/^\./, '')
  if (!s) return []
  return formats.filter(f => f.extensions.some(e => e.slice(1).startsWith(s)) || f.name.toLowerCase().includes(s))
}

/** 이 도구를 쓰는 곳 (실행 레시피·대안) */
export function usagesOf(toolId: string) {
  return formats.flatMap(f => [
    ...f.recipes.filter(r => [...f.collect.steps, ...r.preprocess, ...r.convert].some(s => s.tool === toolId))
      .map(r => ({ format: f, recipe: r as Recipe | undefined, ran: true })),
    ...f.alternatives.filter(a => a.tool === toolId).map(() => ({ format: f, recipe: undefined, ran: false })),
  ])
}

export function formatsFromSource(sourceId: string) {
  return formats.flatMap(f => [
    ...(f.collect.source === sourceId ? [{ format: f, used: true }] : []),
    ...f.otherSources.filter(o => o.source === sourceId).map(() => ({ format: f, used: false })),
  ])
}

export const bytes = (n: number) =>
  n < 1024 ? `${n}B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1024 ** 2).toFixed(1)}MB`

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}초`
