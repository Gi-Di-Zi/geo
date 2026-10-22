import { categories } from '#shared/catalog/categories'
import { originLabels, origins } from '#shared/catalog/origins'
import { sources } from '#shared/catalog/sources'
import { tools, toolTypes } from '#shared/catalog/tools'
import type { FormatSpec, Output, OutputKind, Recipe, Report, Source, Support, ViewerId } from '#shared/types'

// <category>/<format>.ts만 spec이다 (_로 시작하는 파일은 spec을 만드는 도우미). 목록은 nuxt.config.ts의 모듈이 만든다
import specs from '#build/catalog-formats'
export const formats = specs as FormatSpec[]

export { categories, origins, originLabels, sources, tools, toolTypes }

/** 확장자 하나를 따라가는 네 단계. 상단 단계 막대와 페이지가 같이 쓴다 */
export const flow = [
  { id: 'collect', name: '수집', text: '공개 원본 수집 또는 내 파일 업로드.' },
  { id: 'preprocess', name: '전처리', text: '무결성 확인, 좌표계·인코딩·범위·속성 정리.' },
  { id: 'convert', name: '웹 형태 변환', text: '브라우저가 바로 읽는 포맷으로 변환. 뷰어별 처리 방식.' },
  { id: 'view', name: '시각화·렌더링', text: '렌더러별로 결과 그리기. 웹: OpenLayers·MapLibre·Deck.gl·CesiumJS, 엔진: Cesium for Unreal(수동 확인).' },
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
    'wms': 'ImageLayer + ImageWMS — 화면 범위 GetMap',
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
    'wms': 'WebMapServiceImageryProvider — 타일 단위 GetMap',
  },
}

/** 서비스 레시피: 떠 있는 서버(GeoServer·martin 등)에 발행하고 서버 주소를 결과물로 쓴다 */
export const isService = (r?: Recipe) => !!r?.convert.some(s => toolOf(s.tool)?.type === 'server')

/** 레시피 두 방식. 상단 선택 막대와 변환 방식 표가 같이 쓴다 */
export const recipeGroups = (f: FormatSpec) => [
  { name: '파일 방식', text: '결과를 파일로 구워 정적 호스팅. 브라우저가 파일을 직접 읽음.', recipes: f.recipes.filter(r => !isService(r)) },
  { name: '서버 방식', text: '떠 있는 서버에 발행. 요청마다 서버가 응답 생성.', recipes: f.recipes.filter(r => isService(r)) },
].filter(g => g.recipes.length)

/** 결과물 주소. 서버 출력(/svc/…)은 그대로, 파일 출력은 결과 폴더 기준 */
export const outPath = (dir: string, o: Output) => (o.path.startsWith('/') ? o.path : dir + o.path)

/** 확장자 자체가 웹 결과물 종류인 경우. 결과물이 원본과 같은 형식인지 표시하는 데 쓴다 */
export const nativeKind: Record<string, OutputKind> = { geojson: 'geojson', mvt: 'mvt', pmtiles: 'pmtiles', cog: 'cog', terrain: 'quantized-mesh', pnts: '3dtiles', i3dm: '3dtiles', glb: 'glb' }

/** 단계 주소. 첫 단계는 확장자 주소 그대로 */
export const stepPath = (f: FormatSpec, step: FlowStep) => `/${f.category}/${f.id}${step === 'collect' ? '' : `/${step}`}`

export const categoryOf = (id: string) => categories.find(c => c.id === id)
export const toolOf = (id: string) => tools.find(t => t.id === id)
export const sourceOf = (id: string) => sources.find(s => s.id === id)
export const formatsOf = (categoryId: string) => formats.filter(f => f.category === categoryId)
export const formatOf = (categoryId: string, id: string) => formats.find(f => f.category === categoryId && f.id === id)

export const scopeLabels: Record<Source['scope'], string> = { domestic: '국내', abroad: '해외', personal: '개인·커뮤니티' }
export const accessLabels: Record<Source['access'], string> = { auto: '로그인 없이', key: '인증키', login: '로그인', approval: '승인' }
export const redistLabels: Record<Source['redistribute'], string> = { yes: '재배포 가능', conditional: '조건부 (출처표시 등)', no: '재배포 불가' }
/** 확장자의 다른 수급처를 국내·해외·개인 순으로 묶는다 */
export const sourcesByScope = (f: FormatSpec) => (Object.keys(scopeLabels) as Source['scope'][])
  .map(scope => ({ scope, list: f.otherSources.filter(o => sourceOf(o.source)?.scope === scope) }))
  .filter(g => g.list.length)

/** 샘플 분류. 기타 = 다른 형식에서 바꾼 샘플이거나 개인·커뮤니티 자료 */
export type SampleKind = 'domestic' | 'abroad' | 'other' | 'none'
export const sampleLabels: Record<SampleKind, string> = { domestic: '국내 공공 데이터', abroad: '해외 데이터', other: '기타 데이터', none: '샘플 없음' }
export function sampleOf(f: FormatSpec): SampleKind {
  if (f.closed) return 'none'
  const scope = sourceOf(f.collect.source)?.scope
  return f.collect.converted || scope === 'personal' ? 'other' : scope === 'domestic' ? 'domestic' : 'abroad'
}

export const supports = (recipe: Recipe, viewer: ViewerId) => 'output' in recipe.viewers[viewer]

export const supportLabels: Record<Support, string> = { direct: '직접 처리', converted: '변환 후 처리', partial: '일부 기능만', untested: '미검증', no: '미지원' }
/** 좋은 순서. 여러 레시피 중 가장 좋은 수준을 고를 때 */
export const supportOrder: Support[] = ['direct', 'converted', 'partial', 'untested', 'no']

/** 뷰어가 레시피 결과를 처리하는 수준. ran = 그 레시피의 마지막 실행 성공 여부 */
export function supportOf(spec: FormatSpec, recipe: Recipe, viewer: ViewerId, ran: boolean): Support {
  const use = recipe.viewers[viewer]
  if (!('output' in use)) return 'no'
  if (!ran) return 'untested'
  if (use.caution) return 'partial'
  return nativeKind[spec.id] === recipe.outputs.find(o => o.id === use.output)?.kind ? 'direct' : 'converted'
}

/** 실행 기록이 레시피대로 끝까지 성공했는지 (pipeline writeStatus와 같은 기준) */
export const succeeded = (recipe: Recipe, rep?: Report | null) => !!rep && rep.outputs.length === recipe.outputs.length && rep.steps.every(s => s.code === 0)

/** 이 도구를 쓰는 곳 (실행 레시피·대안) */
export function usagesOf(toolId: string) {
  return formats.flatMap(f => [
    ...f.recipes.filter(r => [...f.collect.steps, ...r.preprocess, ...r.convert].some(s => s.tool === toolId))
      .map(r => ({ format: f, recipe: r as Recipe | undefined, ran: true })),
    ...f.alternatives.filter(a => a.tool === toolId).map(() => ({ format: f, recipe: undefined, ran: false })),
  ])
}

/** 이 수급처에서 받을 수 있는 확장자 (확장자당 하나, used = 샘플 출처) */
export const formatsFromSource = (sourceId: string) => formats
  .filter(f => f.collect.source === sourceId || f.otherSources.some(o => o.source === sourceId))
  .map(f => ({ format: f, used: f.collect.source === sourceId }))

export const bytes = (n: number) =>
  n < 1024 ? `${n}B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1024 ** 2).toFixed(1)}MB`

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}초`
