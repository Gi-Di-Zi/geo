// 사용 목적 중심 변환 추천: 대상 뷰어·목적·원하는 결과 형식·제공 방식 + 파일 특성 → 업로드 레시피 중 추천·대안·제약·미지원과 이유.
// 근거는 카탈로그에 적힌 것만 쓴다: 레시피의 뷰어별 결과(Recipe.viewers), 뷰어가 구현한 결과 종류(viewerKinds), 도구 장단점(toolNotes),
// 유형별 "데이터 상태 → 방식" 표의 크기 어림(delivery.ts byCategory), 업로드 단계 설명에 적힌 손실·배치. 처리 시간·메모리는 추정하지 않는다.
// MCP 도구(geo_recommend, geo_convert 검증)와 웹 업로드 화면이 같이 쓴다 → 규칙은 여기 한 곳
import { noteOf } from './catalog/delivery.ts'
import { fileUploadRecipes, publishesService, SERVICE_HOURS } from './conversion.ts'
import { kindLabels, viewerKinds, viewers } from './viewers.ts'
import type { Form, FormatSpec, Output, OutputKind, Priority, Recipe, ViewerId } from './types.ts'

export type Delivery = 'file' | 'service'

/** 제공 방식: 파일 = 가져가 쓰는 완성형 산출물, 서비스 = 공간 서버 동작을 확인하는 48시간 임시 환경 */
export const deliveries: { id: Delivery; title: string; text: string }[] = [
  { id: 'file', title: '실제 웹 프로젝트에서 사용할 수 있는 공간데이터 파일 생성', text: '변환된 결과 파일을 다운로드하고 자신의 웹 서버 또는 애플리케이션에서 사용할 수 있습니다.' },
  { id: 'service', title: `${SERVICE_HOURS}시간 임시 공간 서비스 — 실제 조회·연동 테스트`, text: `WMS·WFS 등 공간 서비스의 실제 응답과 웹 지도 연동을 확인하는 용도입니다. 발행 완료 후 ${SERVICE_HOURS}시간이 지나면 자동 만료됩니다.` },
]

/** 파일 방식의 최종본 형태. 같은 변환 결과로 둘 다 받을 수 있고, 고른 쪽을 먼저 보여 준다 */
export const forms: { id: Form; title: string; text: string }[] = [
  { id: 'files', title: '결과 파일 + 적용 코드', text: '이미 있는 웹 프로젝트에 결과 파일을 올리고, 라이브러리별 코드를 붙여 씁니다.' },
  { id: 'html', title: '바로 열리는 HTML 지도', text: '결과 파일과 지도 페이지(index.html)·라이브러리를 한 폴더로 받습니다. 정적 호스팅에 폴더째 올리면 그대로 열립니다.' },
]

export const priorities: { id: Priority; name: string; text: string }[] = [
  { id: 'balanced', name: '일반적인 사용', text: '뷰어가 쓰는 기본 결과물. 데이터 크기에 맞춰 통째·타일' },
  { id: 'fast_preview', name: '빠른 미리보기', text: '작은 데이터는 한 파일 통째, 큰 데이터는 타일' },
  { id: 'large_data', name: '대용량 웹 표출', text: '타일·LOD로 화면에 보이는 부분만' },
  { id: 'fidelity', name: '원본 정보 보존', text: '단순화·양자화·손실 압축 없는 결과 우선' },
]

/** 고를 수 있는 결과 형식 (WMS는 서비스 결과로만 나옴) */
export const outputKinds: OutputKind[] = ['geojson', 'mvt', 'pmtiles', 'image', 'cog', 'xyz-raster', 'terrain-rgb', 'quantized-mesh', '3dtiles', 'glb']

export interface Intent {
  viewer?: ViewerId
  priority?: Priority
  output?: OutputKind
  delivery?: Delivery
  /** 파일 방식의 최종본 형태 (서비스 방식에는 해당 없음) */
  form?: Form
}

/** 파일 특성 (shared/sniff.ts): 크기, 머리글로 확인한 피처·점 수, 좌표계 입력 필요, 변환이 실패할 이유 */
export interface DataFacts {
  bytes?: number
  count?: number
  srs?: { why: string; guess?: string } | null
  blocked?: string | null
  /** 파일 머리글의 스키마·판 (예: IFC FILE_SCHEMA = IFC4). 레시피 입력 조건 확인용 */
  schema?: string | null
}

/** recommended = 지금 조건에 맞는 방식, alternative = 쓸 수 있지만 절충, limited = 쓸 수 있지만 중요한 제약, unsupported = 조건을 못 채움 */
export type Fit = 'recommended' | 'alternative' | 'limited' | 'unsupported'

export interface Product { id: string; kind: OutputKind; label: string }

export interface Candidate {
  method: string
  title: string
  way: Delivery
  fit: Fit
  /** 대상 뷰어(없으면 목적)에 맞춰 고른 주력 결과물. 미지원이면 null */
  primary: Product | null
  /** 같이 나오는 나머지 결과물 */
  extras: Product[]
  /** 이 사이트의 뷰어가 이 방식의 결과 중 그리는 것 */
  viewers: { viewer: ViewerId; output: string }[]
  /** 추천·선택 이유, 미지원이면 그 이유 */
  reasons: string[]
  /** 주력 결과물의 손실·배치 제약·뷰어 주의·서비스 만료 */
  warnings: string[]
  pros: string[]
  cons: string[]
  steps: number
}

export type Size = 'small' | 'medium' | 'large' | 'unknown'

export interface Recommendation {
  format: string
  intent: { viewer: ViewerId | null; priority: Priority; output: OutputKind | null; delivery: Delivery; form: Form }
  size: Size
  /** 이 실행 환경에서 서비스 발행 가능 여부 */
  service: { enabled: boolean; hours: number }
  recommended: Candidate | null
  /** 요청한 제공 방식의 방식 전체, 맞는 순 (미지원은 뒤). 서비스를 못 쓰면 파일 방식을 대안으로 */
  candidates: Candidate[]
  /** 조건을 채우는 방식이 없을 때 이유와 대안 */
  conflict: string | null
  /** 형식은 맞지만 이대로는 변환 실패 (예: 좌표계 기록 없는 LAS) */
  blocked: string | null
  /** 더 받아야 하는 입력. (선택)으로 시작하면 없어도 진행 */
  needs: string[]
  /** 같은 목적으로 각 뷰어를 골랐을 때 추천 방식·결과물, 못 쓰면 이유 */
  byViewer: { viewer: ViewerId; name: string; method: string | null; title: string | null; output: Product | null; reason: string }[]
  /** 이 형식 업로드 공통 주의 (catalog 업로드 안내 + 배치·색·높이 처리) */
  notes: string[]
}

/** 타일·LOD: 화면에 보이는 부분만 받음 */
const TILED: OutputKind[] = ['mvt', 'pmtiles', 'xyz-raster', 'terrain-rgb', 'quantized-mesh', '3dtiles']

/** 한 파일 통째: 받으면 도형·속성·모델을 한 번에 가짐 */
const WHOLE: OutputKind[] = ['geojson', 'cog', 'image', 'glb']

// 유형별 "데이터 상태 → 방식" 표(delivery.ts byCategory)의 어림: 수 MB·수만 개 이하 = 통째 한 파일, 수십 MB·수십만 개 이상 = 타일
// ponytail: 고정 경계값. 단말·뷰어별 첫 화면 실측이 생기면 그 값으로
const SMALL = { bytes: 10 * 1024 ** 2, count: 50_000 }
const LARGE = { bytes: 30 * 1024 ** 2, count: 200_000 }

/** 업로드 레시피 단계가 원본을 줄이는 곳 (각 단계 why·도구 설명에 적힌 내용). 키: 유형/확장자/레시피:종류 → 유형/레시피:종류 → 레시피:종류 → 종류 */
const losses = {
  'tippecanoe:pmtiles': '줌별 도형 단순화, 무거운 타일은 밀집 구간부터 피처 생략(--drop-densest-as-needed)',
  'mvt': '타일 격자(4096칸)로 좌표 양자화 → 낮은 줌일수록 거칠어짐, 너무 큰 타일은 해상도 낮춤',
  'martin:mvt': 'PostGIS ST_AsMVT 타일 격자로 좌표 양자화 → 작은 도형은 낮은 줌에서 줄거나 사라짐',
  'vector-2d/pmtiles/gdal:geojson': '타일에서 꺼낸 도형 → 타일 경계에서 잘리고 타일 해상도 좌표',
  'raster/gdal:cog': '8비트 RGB로 변환(16비트·다중 밴드는 앞 3밴드를 최솟값~최댓값으로 스트레치) + WebP 손실 압축 → 보기용, 원본 값 아님',
  'xyz-raster': '8비트 RGB WebP(품질 80) 손실 압축 타일 → 보기용, 원본 값 아님',
  'image': '웹 메르카토르(EPSG:3857)로 재투영해 다시 저장 (리샘플링)',
  'terrain-rgb': '높이를 0.1m 단위로 RGB에 담음',
  'gdal-mago:quantized-mesh': '격자 높이를 삼각망으로 근사, 줌(LOD)별 단순화',
  'pointcloud/mago:3dtiles': '좌표 16비트 정수 양자화 (용량 축소)',
  '3d-tiles-tools:glb': 'meshopt 형상 압축·WebP 텍스처 압축 (손실 압축)',
  '3d-tiles-tools:3dtiles': 'meshopt 형상 압축·WebP 텍스처 압축 (손실 압축)',
  'indoor-bim/ifcconvert:glb': '형상만 → 부재 속성(층·실·설비) 손실',
  'indoor-bim/ifcconvert:3dtiles': '형상만 → 부재 속성(층·실·설비) 손실',
  'mago:3dtiles': '단순화 단계(LOD)별 타일 → 멀리서는 단순화된 모델',
} satisfies Record<string, string>

/** 원본 위치를 쓰지 않고 고정 위치에 세우는 업로드 → 결과를 실제 위치로 안내하지 않는다 (catalog 업로드 안내와 같은 내용) */
const fixedPlace = {
  'model-3d/glb': '모델에 지도 위치 없음 → 서울광장 고정 위치에 배치 (실제 위치 아님)',
  'model-3d/gltf': '모델에 지도 위치 없음 → 서울광장 고정 위치에 배치 (실제 위치 아님)',
  'indoor-bim/ifc': 'IfcMapConversion(지도 좌표·방향) 또는 IfcSite 위경도가 있으면 그 위치, 없으면 서울시청 앞 고정 위치 (실제 위치 아님). 높이는 0(지도 바닥) 기준, 대지 위경도만 있으면 방향 미보정',
} satisfies Record<string, string>

const POINT_NOTES = [
  '원본 RGB를 높이(Z)별 색으로 덮어씀',
  '가장 낮은 점(노이즈 제외)을 높이 0m로 내림 — 지형 없는 바닥지도 기준, 점 사이 상대 높이 유지',
  '노이즈 분류(7·18) 점 제외, 웹 메르카토르(EPSG:3857)로 재투영',
]

/** 업로드 단계가 원본 색·높이·위치를 바꾸는 형식 */
const formatNotes = {
  'pointcloud/las': POINT_NOTES,
  'pointcloud/laz': POINT_NOTES,
  'model-3d/citygml': ['srsName 좌표계 기준 제자리 배치 (위도 우선 좌표계는 x·y 교환)', '텍스처 미사용'],
} satisfies Record<string, string[]>

/** 원본을 바꾸지 않고 그대로 내는 결과 (이미 웹 형식인 업로드). 같은 레시피의 다른 결과(원본에서 다시 꺼낸 것)보다 우선 */
const passthrough = {
  'vector-2d/pmtiles/gdal:pmtiles': '올린 PMTiles 그대로 (변환 없음)',
} satisfies Record<string, string>

/** 레시피가 받는 입력 조건 (업로드 단계의 검사와 같은 내용). 머리글로 확인했는데 안 맞으면 그 방식은 미지원 */
const requires = {
  'indoor-bim/ifc/mago': { schema: /^IFC2X3$/i, why: 'mago 내부 Assimp는 IFC2x3만 읽음' },
} satisfies Record<string, { schema: RegExp; why: string }>

/** 키가 표에 있을 때만 값 */
const lookup = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined)

export const SERVICE_OFF = '이 실행 환경은 공간 서비스 발행을 제공하지 않음 (공개 배포는 파일 결과만). 서비스 응답을 확인하려면 파일 결과를 받아 자체 공간 서버(GeoServer·martin 등)에 올리기'

export const SERVICE_EXPIRY = `서비스 발행 완료 후 ${SERVICE_HOURS}시간 뒤 자동 만료 → 같은 URL은 계속 쓸 수 없음. 장기 사용은 파일 결과를 받아 직접 호스팅`

export const viewerName = (v: ViewerId) => viewers.find(x => x.id === v)?.name ?? v

const product = (o: Output): Product => ({ id: o.id, kind: o.kind, label: o.label })

const lossOf = (spec: FormatSpec, r: Recipe, o: Output) =>
  lookup(losses, `${spec.category}/${spec.id}/${r.id}:${o.kind}`) ?? lookup(losses, `${spec.category}/${r.id}:${o.kind}`) ?? lookup(losses, `${r.id}:${o.kind}`) ?? lookup(losses, o.kind)

/** 서비스 방식 레시피 (업로드 받는 형식에서 서버에 발행하는 것) */
const serviceRecipes = (spec: FormatSpec) => ('recipes' in spec.upload ? spec.upload.recipes.filter(publishesService) : [])

function sizeOf(f: DataFacts): Size {
  if (f.bytes === undefined && f.count === undefined) return 'unknown'

  if ((f.bytes ?? 0) >= LARGE.bytes || (f.count ?? 0) >= LARGE.count) return 'large'

  return (f.bytes ?? 0) <= SMALL.bytes && (f.count ?? 0) <= SMALL.count ? 'small' : 'medium'
}

/** 이 사이트 뷰어가 그리는 결과 (뷰어 → 결과 id) */
function shownBy(r: Recipe) {
  const list: { viewer: ViewerId; output: string }[] = []

  for (const v of viewers) {
    const use = r.viewers[v.id]

    if ('output' in use) list.push({ viewer: v.id, output: use.output })
  }

  return list
}

/** 결과물 하나의 점수와 이유. 규칙은 목적별로 명시, 같은 점수면 이 사이트 뷰어가 그리는 결과 → 앞 레시피(기본값) */
function scoreOf(spec: FormatSpec, r: Recipe, index: number, o: Output, viewer: ViewerId | undefined, priority: Priority, size: Size) {
  const why: string[] = []
  const tiled = TILED.includes(o.kind), whole = WHOLE.includes(o.kind)
  const users = shownBy(r).filter(s => s.output === o.id)
  const shown = viewer ? users.some(s => s.viewer === viewer) : users.length > 0
  let score = -index * 0.05
  const kept = lookup(passthrough, `${spec.category}/${spec.id}/${r.id}:${o.kind}`)

  if (kept) { score += 1.5; why.push(kept) }

  if (shown) {
    score += 0.5
    why.push(viewer ? `이 사이트의 ${viewerName(viewer)} 화면이 그리는 결과물` : `이 사이트 뷰어(${users.map(s => viewerName(s.viewer)).join('·')})가 그리는 결과물`)
  }

  if (priority === 'large_data') {
    if (tiled) { score += 2; why.push('타일·LOD → 화면에 보이는 부분만 받음') }

    if (o.kind === 'pmtiles') { score += 1; why.push('PMTiles 한 파일 + Range 요청 → 서버 없이 큰 데이터 배포, 타일 수만 개를 올리지 않음') }
  } else if (priority === 'fidelity') {
    if (whole) { score += 2; why.push('한 파일 통째 → 타일 분할·줌별 단순화 없음') }

    if (lossOf(spec, r, o)) score -= 1
  } else if (priority === 'fast_preview') {
    if (whole && size !== 'large') { score += 2; why.push('한 파일 통째 → 받자마자 표시') }

    if (tiled && size === 'large') { score += 2; why.push('큰 데이터 → 통째 로드 대신 보이는 타일만') }

    score -= (r.preprocess.length + r.convert.length) * 0.01
  } else {
    if (whole && size === 'small') { score += 1; why.push('수 MB·수만 개 이하 → 한 번 받고 끝 (유형별 데이터 상태 표 기준)') }

    if (tiled && size === 'large') { score += 1; why.push('수십 MB·수십만 개 이상 → 타일 (유형별 데이터 상태 표 기준)') }
  }

  return { output: o, score, why }
}

type Ranked = { candidate: Candidate; score: number }

function evaluate(spec: FormatSpec, r: Recipe, index: number, intent: Intent, priority: Priority, size: Size, facts: DataFacts): Ranked {
  const note = noteOf(spec.category, spec.id, r.id)
  const way: Delivery = publishesService(r) ? 'service' : 'file'
  const v = intent.viewer

  const base: Candidate = {
    method: r.id, title: r.title, way, fit: 'unsupported', primary: null, extras: r.outputs.map(product),
    viewers: shownBy(r), reasons: [], warnings: [], pros: note?.pros ?? [], cons: note?.cons ?? [], steps: r.preprocess.length + r.convert.length,
  }

  const use = v ? r.viewers[v] : undefined

  if (v && use && 'unsupported' in use) return { candidate: { ...base, reasons: [`${viewerName(v)}: ${use.unsupported}`] }, score: -Infinity }
  const need = lookup(requires, `${spec.category}/${spec.id}/${r.id}`)

  if (need && facts.schema && !need.schema.test(facts.schema)) return { candidate: { ...base, reasons: [`${need.why} (이 파일: ${facts.schema})`] }, score: -Infinity }
  const want = intent.output
  const pool = r.outputs.filter(o => (!v || viewerKinds[v].includes(o.kind)) && (!want || o.kind === want))

  if (!pool[0]) {
    const made = [...new Set(r.outputs.map(o => kindLabels[o.kind]))].join('·')
    // 뷰어가 그 결과 형식을 아예 못 그리면 그 이유가 먼저 (방식의 결과 목록은 부차적)
    const viewerCannot = !!(want && v && !viewerKinds[v].includes(want))
    const reason = want && !viewerCannot && !r.outputs.some(o => o.kind === want) ? `이 방식의 결과에 ${kindLabels[want]} 없음 (만드는 것: ${made})` : `${v ? viewerName(v) : '뷰어'}에서 ${want ? kindLabels[want] : '이 결과'} 미지원`

    return { candidate: { ...base, reasons: [reason] }, score: -Infinity }
  }

  let best = scoreOf(spec, r, index, pool[0], v, priority, size)

  for (const o of pool.slice(1)) {
    const s = scoreOf(spec, r, index, o, v, priority, size)

    if (s.score > best.score) best = s
  }

  const caution = use && 'caution' in use ? use.caution : undefined
  const fixed = lookup(fixedPlace, `${spec.category}/${spec.id}`)
  const how = use && 'note' in use && use.note && use.output === best.output.id ? use.note : undefined
  const warnings = [lossOf(spec, r, best.output), caution, fixed, way === 'service' ? SERVICE_EXPIRY : undefined].filter((w): w is string => !!w)
  const extras: Product[] = []

  for (const o of r.outputs) if (o.id !== best.output.id) extras.push(product(o))

  const candidate: Candidate = {
    ...base,
    fit: caution || fixed ? 'limited' : 'alternative',
    primary: product(best.output),
    extras,
    reasons: [
      ...(want ? [`요청한 결과 형식 ${kindLabels[want]}`] : []), ...best.why, ...(how ? [how] : []),
      // 원본 보존을 원했지만 이 뷰어에서 쓸 결과가 모두 손실 처리를 거친다 → 숨기지 않고 말한다
      ...(priority === 'fidelity' && lossOf(spec, r, best.output) ? ['원본 값을 그대로 두는 결과 없음 → 아래 손실을 감안. 원본 값이 필요하면 원본 파일 그대로 사용'] : []),
    ],
    warnings,
  }

  return { candidate, score: best.score }
}

function rank(spec: FormatSpec, recipes: Recipe[], intent: Intent, priority: Priority, size: Size, facts: DataFacts) {
  return recipes.map((r, i) => evaluate(spec, r, i, intent, priority, size, facts)).sort((a, b) => b.score - a.score)
}

/** 바깥 입력(도구 인자·폼 필드)의 목적 값 확인. 'auto'·빈 값 = 지정 안 함. 모르는 값이면 null */
export function readIntent(raw: { viewer?: string; priority?: string; output?: string; delivery?: string; form?: string }): Intent | null {
  const pick = (v: string | undefined) => (v && v !== 'auto' ? v : undefined)
  const viewer = viewers.find(x => x.id === pick(raw.viewer))?.id
  const priority = priorities.find(p => p.id === pick(raw.priority))?.id
  const output = outputKinds.find(k => k === pick(raw.output))
  const delivery = deliveries.find(d => d.id === pick(raw.delivery))?.id
  const form = forms.find(f => f.id === pick(raw.form))?.id

  if ((pick(raw.viewer) && !viewer) || (pick(raw.priority) && !priority) || (pick(raw.output) && !output) || (pick(raw.delivery) && !delivery) || (pick(raw.form) && !form)) return null
  const intent: Intent = {}

  if (viewer) intent.viewer = viewer

  if (priority) intent.priority = priority

  if (output) intent.output = output

  if (delivery) intent.delivery = delivery

  if (form) intent.form = form

  return intent
}

/**
 * 형식 하나(spec)에 대한 추천. facts 없음 = 파일을 올리기 전 (크기 기준 없이 기본 결과물).
 * service = 이 실행 환경이 서비스 발행을 허용하는지 (공개 배포는 false). 못 쓰면 파일로 바꾸지 않고 이유·대안만
 */
export function recommend(spec: FormatSpec, intent: Intent, facts: DataFacts = {}, service = false): Recommendation {
  const priority = intent.priority ?? 'balanced'
  const delivery = intent.delivery ?? 'file'
  const size = sizeOf(facts)
  const wantService = delivery === 'service'
  const recipes = wantService && service ? serviceRecipes(spec) : fileUploadRecipes(spec)
  const ranked = rank(spec, recipes, intent, priority, size, facts)
  const usable = ranked.filter(x => x.candidate.fit !== 'unsupported')
  const top = wantService && !service ? undefined : usable[0]?.candidate

  if (top?.fit === 'alternative') top.fit = 'recommended'

  const byViewer = viewers.map(v => {
    const best = (intent.viewer === v.id ? ranked : rank(spec, recipes, { ...intent, viewer: v.id }, priority, size, facts))[0]
    const ok = best && best.score > -Infinity ? best.candidate : null

    return {
      viewer: v.id, name: v.name, method: ok?.method ?? null, title: ok?.title ?? null, output: ok?.primary ?? null,
      reason: ok ? ok.reasons[0] ?? '' : best?.candidate.reasons[0] ?? (wantService ? '서비스 발행 레시피 없음' : '업로드 변환 없음'),
    }
  })

  const alternatives: string[] = []

  for (const b of byViewer) if (b.title && b.output) alternatives.push(`${b.name} — ${b.title} → ${kindLabels[b.output.kind]}`)
  const reasons = [...new Set(ranked.map(x => x.candidate.reasons[0] ?? ''))].join(' / ')
  let conflict: string | null = null

  if (wantService && !service) conflict = `${SERVICE_OFF}. 파일 결과 대안: ${usable.map(x => `${x.candidate.title} → ${x.candidate.primary ? kindLabels[x.candidate.primary.kind] : ''}`).join(' · ') || '없음'}`
  else if (!recipes.length) conflict = wantService ? '이 형식은 서비스 발행 레시피 없음 → 파일 결과만' : '이 형식은 업로드 변환 없음'
  else if (!usable.length) conflict = `${reasons.replace(/\.$/, '')}${alternatives.length ? `. 가능한 대안: ${alternatives.join(' · ')}` : ''}`

  const needs: string[] = []

  if (facts.srs) needs.push(`원본 좌표계(EPSG) 지정 — ${facts.srs.why}${facts.srs.guess ? ` (기본값 ${facts.srs.guess})` : ''}`)

  if (facts.blocked) needs.push(facts.blocked)

  if (!intent.viewer && !intent.output) needs.push('(선택) 대상 라이브러리 미지정 → 뷰어별 결과물이 다름 (byViewer). 정해지면 viewer로 다시 추천')

  if (size === 'unknown') needs.push('(선택) 파일 크기·개수 미확인 → 파일을 올린 뒤 다시 계산')

  return {
    format: `${spec.category}/${spec.id}`,
    intent: { viewer: intent.viewer ?? null, priority, output: intent.output ?? null, delivery, form: delivery === 'file' ? intent.form ?? 'files' : 'files' },
    size,
    service: { enabled: service, hours: SERVICE_HOURS },
    recommended: top ?? null,
    candidates: ranked.map(x => x.candidate),
    conflict,
    blocked: facts.blocked ?? null,
    needs,
    byViewer,
    notes: [...('note' in spec.upload ? [spec.upload.note] : []), ...(lookup(formatNotes, `${spec.category}/${spec.id}`) ?? [])],
  }
}
