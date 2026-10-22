export type ViewerId = 'ol' | 'maplibre' | 'deck' | 'cesium'

export type OutputKind =
  | 'geojson' | 'mvt' | 'pmtiles' | 'image' | 'cog' | 'xyz-raster'
  | 'terrain-rgb' | 'quantized-mesh' | '3dtiles' | 'glb' | 'wms'

export type ToolType = 'basic' | 'engine' | 'tiling' | '3dtiles' | 'model' | 'python' | 'db' | 'server'

export interface Category {
  id: string
  name: string
  color: string
  summary: string
}

export interface Tool {
  id: string
  name: string
  type: ToolType
  lang: string
  license: string
  version: string
  status: 'active' | 'stale' | 'dead'
  /** 실행하는 도구만 가짐. 'local:tools' = pipeline/Dockerfile 로컬 빌드. 서버 도구는 compose.yaml의 이미지 (단계는 curl 이미지에서 서버로 요청) */
  image?: string
  /** 서버 도구: 사이트에 여는 로컬 주소. 사이트는 /svc/<id>/** 를 여기로 프록시하고, pipeline은 결과 확인 요청을 보낸다 */
  endpoint?: string
  /** 서버 도구: 시작할 때만 테이블을 찾는 서버. 이 도구의 단계 전에 pipeline이 다시 띄운다 */
  restart?: true
  /** 이미지 기본 셸 앞에 붙는 숨은 준비 코드 (예: 래퍼 함수 정의). 화면에는 Step.run만 보인다 */
  prelude?: string
  summary: string
  description: string
  io: string
  example: string
  url: string
  serves?: OutputKind[]
  /** 서버 도구: 이 사이트의 이미지(image)로 직접 돌려 본 입력·출력별 지원. 공식 문서 목록과 다를 수 있다(빌드 기능·확장 설치) */
  checked?: { what: string; level: Support; note: string }[]
}

/**
 * 처리 수준. direct = 원본과 같은 형식을 그대로 읽음, converted = 다른 형식으로 바꾼 뒤 처리,
 * partial = 처리하지만 빠지는 기능 있음, untested = 성공한 실행 기록 없음, no = 미지원
 */
export type Support = 'direct' | 'converted' | 'partial' | 'untested' | 'no'

export interface Source {
  id: string
  name: string
  url: string
  provides: string
  access: 'auto' | 'key' | 'login' | 'approval'
  license: string
  redistribute: 'yes' | 'conditional' | 'no'
  /** 재배포가 조건부/불가일 때 이유 한 줄 */
  note?: string
  attribution?: string
  /** 국내 = 국내 공공기관, 해외 = 해외 기관·글로벌 플랫폼, 개인 = 개인·커뮤니티(블로그, 개인 저장소). 수집 단계 "데이터 받는 곳"과 /sources가 이 순서로 묶는다 */
  scope: 'domestic' | 'abroad' | 'personal'
}

export interface Step {
  title: string
  why: string
  tool: string
  run: string
}

export interface Output {
  id: string
  kind: OutputKind
  /** 레시피 출력 폴더 기준 경로. 타일은 {z}/{x}/{y} 템플릿. /svc/<서버 id>/로 시작하면 서버 주소 (서비스 레시피) */
  path: string
  label: string
  why: string
  minzoom?: number
  maxzoom?: number
  /** MVT source-layer 이름, WMS LAYERS 이름 */
  layer?: string
  /** image: [west, south, east, north] (EPSG:4326). 타일·WMS에 있으면 이 범위 밖은 요청하지 않는다 */
  bounds?: [number, number, number, number]
  /** glb: 모델을 놓을 위치 [경도, 위도, 높이(m)] */
  anchor?: [number, number, number]
  /** glb: 모델을 반복해 세울 점 GeoJSON 경로 (heading·scale 속성). 있으면 anchor 대신 쓴다 */
  instances?: string
  style?: { height?: string }
}

/** note = 이 뷰어가 어떻게 그리는지 설명, caution = 그리긴 하지만 문제가 있는 경우(비교표에 * 표시) */
export type ViewerUse = { output: string; note?: string; caution?: string } | { unsupported: string }

export interface Recipe {
  id: string
  title: string
  preprocess: Step[]
  convert: Step[]
  outputs: Output[]
  viewers: Record<ViewerId, ViewerUse>
  /** 도구마다 결과 위치가 다를 때 이 레시피를 고르면 쓰는 시점 */
  view?: FormatSpec['view']
  /** DB 단계에 띄울 DB. 없으면 PostGIS (postgis/postgis) */
  db?: { image: string; env?: Record<string, string> }
}

export interface FormatSpec {
  id: string
  category: string
  name: string
  extensions: string[]
  summary: string
  description: string
  /** 포맷 구조 설명 (구성 파일·내부 구조) */
  anatomy?: { name: string; role: string }[]
  convertible: boolean
  /**
   * derived: 같은 형식에서 범위만 잘라 낸 샘플이면 어떻게 잘랐는지 (다른 형식에서 만든 샘플은 쓰지 않는다).
   * converted: 그 형식 원본이 없어 다른 형식 원본을 바꿔 만든 샘플이면 무엇을 어떻게 바꿨는지 (기타 데이터로 분류).
   * license·attribution: 수급처 안에서도 데이터셋마다 다를 때 덮어쓴다
   */
  collect: { source: string; dataset: string; url: string; how: string; steps: Step[]; derived?: string; converted?: string; license?: string; attribution?: string }
  otherSources: { source: string; dataset: string; note: string }[]
  recipes: Recipe[]
  alternatives: { tool: string; cmd?: string; note: string }[]
  /** height: 시점이 바라보는 지점의 높이(m). 산지 지형이나 높은 곳의 3D Tiles처럼 데이터가 해발 0m보다 한참 위에 있을 때 */
  view: { center: [number, number]; zoom: number; pitch?: number; bearing?: number; height?: number; basemap?: 'osm' }
  /** 사용자가 올린 파일로 돌리는 레시피. 올린 파일은 $INPUT 경로로 넘어간다 */
  upload: Upload
  /** 이 확장자 그대로 배포되는 원본 샘플을 찾지 못해 닫아 둔 이유. 있으면 선택할 수 없고 파이프라인도 건너뛴다 */
  closed?: string
  /** 국내 원본 대신 해외·기타 샘플을 쓴 이유 (국내 수급처 조사 결과) */
  noDomestic?: string
}

/**
 * accept = 받는 확장자 (spec.extensions 중 일부이거나 묶음 .zip),
 * recipe = 내용(필드 이름, 범위)을 가정하지 않는 일반 레시피. 출력의 범위·줌은 실행 뒤 결과에서 채운다
 */
export type Upload = { accept: string[]; note: string; recipe: Recipe } | { unsupported: string }

/** 업로드 작업 상태 (.data/jobs/<id>/job.json) */
export interface Job {
  id: string
  format: string
  name: string
  bytes: number
  state: 'running' | 'done' | 'failed'
  createdAt: string
  error?: string
  /** 실행 뒤 출력 범위·줌과 시점을 채운 레시피 */
  recipe?: Recipe
}

/** pipeline이 레시피마다 쓰는 실측 기록 (public/data/<cat>/<fmt>/<recipe>/report.json) */
export interface Report {
  recipe: string
  ranAt: string
  totalMs: number
  /** 측정 환경. cores·memGB는 Docker가 쓰는 자원(Docker Desktop은 VM 한도) */
  env?: { cpu: string; cores: number; memGB: number; os: string; docker: string }
  steps: { stage: 'preprocess' | 'convert'; title: string; run: string; ms: number; code: number; log: string }[]
  /** 서버 출력(/svc/)은 확인 요청 하나의 응답 크기와 시간(ms). cachedMs = 같은 요청을 바로 다시 보낸 시간(서버 캐시 적중) */
  outputs: { id: string; bytes: number; files: number; features?: number; ms?: number; cachedMs?: number }[]
}

/** 엔진 렌더러(Cesium for Unreal) 기록 (public/data/<cat>/<fmt>/<recipe>/unreal.json + unreal.png). scripts/unreal.ts가 쓴다 */
export interface EngineReport {
  ranAt: string
  ok: boolean
  /** 엔진이 읽은 주소 (file:///…) */
  url: string
  /** 시작부터 타일·셰이더 준비 끝까지 (첫 실행은 셰이더 컴파일 포함) */
  loadMs: number
  gpu: string
  engine: string
  cesium?: string
  error?: string
}

/** 수집 기록 (public/data/<cat>/<fmt>/collect.json) */
export interface CollectReport {
  ranAt: string
  ms: number
  log: string
  files: { name: string; bytes: number }[]
  published: boolean
}

/** 확장자별 현황 (public/data/status.json). pipeline이 실행할 때마다 다시 쓴다 */
export interface StatusEntry {
  format: string
  /** 받아 둔 원본 (pipeline/raw) */
  raw: { files: number; bytes: number } | null
  /** 원본을 사이트에서 내려받을 수 있는지 (재배포 가능 + 50MB 미만, pipeline.ts PUBLISH_LIMIT) */
  published: boolean
  /** engine: 엔진 렌더러 기록이 있으면 그 결과 (unreal.json) */
  recipes: { id: string; state: 'done' | 'failed' | 'none'; ranAt?: string; totalMs?: number; bytes?: number; failedStep?: string; engine?: 'done' | 'failed' }[]
}
