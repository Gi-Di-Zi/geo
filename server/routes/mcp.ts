// MCP 서버 (Streamable HTTP, 요청마다 새 서버 = 상태 없음). 공간 데이터 파일을 받아 형식 판별 → 목적·대상 뷰어에 맞는 방식 추천 → 변환 → 결과.
// MCP App(ui://geo/app.html, server/assets/mcp-app.html): 대화 안에 업로드·추천·진행·결과 화면을 띄운다.
// 추천 규칙은 shared/recommend.ts 한 곳 (웹 업로드 화면과 같음). 화면 없이도 geo_identify → geo_recommend → geo_convert → geo_status로 같은 결과
// 로컬 Claude Desktop: claude_desktop_config.json에 cmd /c npx mcp-remote http://localhost:3000/mcp (README "MCP")
import { EXTENSION_ID, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { SERVICE_HOURS } from '#shared/conversion'
import { deliveries, priorities, readIntent, recommend, viewerName, type Intent, type Recommendation } from '#shared/recommend'
import { kindLabels } from '#shared/viewers'
import { registerLinkTools } from '../mcp/link'
import { readLimitedBody } from '../services/link/access'
import { mcpLinkOwner } from '../services/link/mcp-access'

const APP = 'ui://geo/app.html'

const INSTRUCTIONS = `공간 데이터 파일을 사용자가 고른 웹 지도 라이브러리(OpenLayers·MapLibre GL JS·Deck.gl·CesiumJS)에 맞는 결과로 변환한다. 도구 이름(GDAL·tippecanoe·mago 등)을 사용자가 몰라도 된다.
MCP Apps 연동은 베타 기능이다. 대화 안 앱 화면과 내려받기 지원은 호스트에 따라 다르다.
흐름: 사용자 요청에서 대상 라이브러리(viewer)·목적(priority)·원하는 결과 형식(outputKind)·제공 방식(delivery)을 읽어 geo_identify에 넘긴다 → 앱 화면이 그 조건을 미리 고른 채 열리고 파일을 올리면 서버가 추천을 계산 → 사용자가 확인·변경 후 변환 → geo_status로 결과.
앱 화면이 없는 클라이언트: 파일의 stage(또는 이전 작업 id)로 geo_identify → geo_recommend → geo_convert(method 생략 = 추천) → geo_status.
조건을 모르면 묻지 말고 생략해도 된다(viewer 생략 = 뷰어별 후보 제시, priority 기본 balanced). 결과 형식만 말했으면 outputKind만 넘긴다.
제공 방식: file(기본) = 사용자의 웹 프로젝트에 가져가 쓰는 완성형 결과 파일(내려받기·적용 코드). service = ${SERVICE_HOURS}시간 임시 공간 서비스(WMS·WFS 등 실제 응답·연동 확인용, 발행 완료 후 ${SERVICE_HOURS}시간 뒤 자동 만료). 공개 서버는 service를 제공하지 않으며 이때 file로 바꾸지 말고 이유를 전한다.
채팅 첨부 파일을 자동으로 읽지 않으며 URL 가져오기·서버 로컬 경로는 제공하지 않는다. 최대 200MB, 한 번에 한 변환. 서버의 원본·결과 파일은 운영자가 정리할 때까지 보관(기간 보장 없음), 결과 링크를 아는 사용자가 열 수 있다.
MCP Apps를 지원하지 않는 클라이언트는 웹 업로드 화면과 도구 결과의 view 주소를 이용한다.`

// MCP Apps SDK(app-with-deps.js, 외부 import 없는 한 파일): 끝의 export { 내부 이름 as 공개 이름, … }을 globalThis.McpApps 대입으로 바꿔 화면 HTML 안에 넣는다
let sdk: Promise<string> | undefined

const appSdk = () => sdk ??= useStorage('assets:mcp-sdk').getItem('app-with-deps.js').then(raw => {
  const src = String(raw)
  const m = /export\s*\{([^}]*)\};?\s*$/.exec(src)

  if (!m) throw new Error('MCP Apps SDK 끝에 export 없음 — 판이 바뀌었으면 mcp.ts appSdk 확인')
  const names = m[1]!.split(',').map(p => p.trim().split(/\s+as\s+/)).map(([local, name]) => `${name ?? local}:${local}`)

  return `${src.slice(0, m.index)}globalThis.McpApps={${names.join(',')}}`
})

const bytesText =(n: number) => (n < 1024 ** 2 ? `${Math.round(n / 1024)}KB` : `${(n / 1024 ** 2).toFixed(1)}MB`)

/** 목적 인자: 도구 셋(geo_identify·geo_recommend·geo_convert)이 같은 이름·값을 쓴다. 표시 이름 ↔ id는 설명에 */
const intentArgs = {
  viewer: z.enum(['auto', 'ol', 'maplibre', 'deck', 'cesium']).optional()
    .describe('대상 웹 지도 라이브러리: ol=OpenLayers, maplibre=MapLibre GL JS, deck=Deck.gl(MapLibre 위 오버레이), cesium=CesiumJS. auto·생략 = 미지정(뷰어별 후보 제시)'),
  priority: z.enum(['balanced', 'fast_preview', 'large_data', 'fidelity']).optional()
    .describe('목적: balanced 일반(기본), fast_preview 빠른 미리보기, large_data 대용량 웹 표출, fidelity 원본 정보·정밀도 보존'),
  outputKind: z.enum(['auto', 'geojson', 'mvt', 'pmtiles', 'image', 'cog', 'xyz-raster', 'terrain-rgb', 'quantized-mesh', '3dtiles', 'glb']).optional()
    .describe('원하는 결과 형식. auto·생략 = 자동'),
  delivery: z.enum(['file', 'service']).optional()
    .describe(`file = 웹 프로젝트에 가져가 쓰는 결과 파일(기본). service = ${SERVICE_HOURS}시간 임시 공간 서비스(WMS·WFS 응답·연동 확인용, 서비스 발행이 허용된 서버만)`),
}

type IntentArgs = { viewer?: string; priority?: string; outputKind?: string; delivery?: string }

/** zod가 값을 확인한 도구 인자 → 목적 (auto = 미지정) */
const toIntent = (a: IntentArgs): Intent => readIntent({ viewer: a.viewer, priority: a.priority, output: a.outputKind, delivery: a.delivery }) ?? {}

/** 앱 화면에 넘길 목적 (미지정은 auto) */
const intentView = (i: Intent) => ({ viewer: i.viewer ?? 'auto', priority: i.priority ?? 'balanced', outputKind: i.output ?? 'auto', delivery: i.delivery ?? 'file' })

const intentText = (i: Intent) => [
  `대상: ${i.viewer ? viewerName(i.viewer) : '미지정'}`,
  `목적: ${priorities.find(p => p.id === (i.priority ?? 'balanced'))?.name}`,
  i.output ? `결과 형식: ${kindLabels[i.output]}` : '',
  `제공: ${i.delivery === 'service' ? `서비스(${SERVICE_HOURS}시간 임시)` : '파일'}`,
].filter(Boolean).join(' · ')

/** 판별 결과 → 모델이 읽을 글 (화면은 structuredContent) */
function identifyText(r: Awaited<ReturnType<typeof identify>>) {
  return [
    `판별: ${r.name} (${bytesText(r.bytes)}) — ${r.facts.join(' · ')}`,
    ...r.warns.map(w => `주의: ${w}`),
    ...(r.blocked ? [`변환 불가: ${r.blocked}`] : []),
    ...(r.srs ? [`좌표계 필요: ${r.srs.why}${r.srs.guess ? ` (기본값 ${r.srs.guess})` : ''} → geo_convert의 srs에 EPSG:번호`] : []),
    ...(r.note ? [`받을 수 없음: ${r.note}`] : []),
    ...r.formats.map((f, i) => `${i + 1}. ${f.id} ${f.name} (${f.category})${f.best ? ' ← 판별 결과' : ''}`),
  ].filter(Boolean).join('\n')
}

/** 추천 → 모델이 읽을 글 */
function recommendText(r: Recommendation, stage?: string) {
  const c = r.recommended
  const head = `추천 조건: ${intentText({ viewer: r.intent.viewer ?? undefined, priority: r.intent.priority, output: r.intent.output ?? undefined, delivery: r.intent.delivery })} · 형식 ${r.format}`
  const lines = [head]

  if (c) {
    lines.push(
      `추천: ${c.title} [${c.method}, ${c.way === 'service' ? `서비스 ${SERVICE_HOURS}시간 임시` : '파일'}${c.fit === 'limited' ? ', 제약 있음' : ''}] → 주력 결과물 ${c.primary ? `${kindLabels[c.primary.kind]} (${c.primary.label})` : '-'}${c.extras.length ? `, 함께: ${c.extras.map(e => kindLabels[e.kind]).join('·')}` : ''}`,
      ...c.reasons.map(x => `  이유: ${x}`),
      ...c.warnings.map(x => `  주의: ${x}`),
    )
  }

  if (r.conflict) lines.push(`조건 충돌: ${r.conflict}`)

  if (r.blocked) lines.push(`변환 불가: ${r.blocked}`)

  for (const a of r.candidates) {
    if (a === c) continue
    lines.push(`- ${a.fit === 'unsupported' ? '미지원' : a.fit === 'limited' ? '제약' : '대안'}: ${a.title} [${a.method}] ${a.primary ? `→ ${kindLabels[a.primary.kind]}` : ''} — ${a.reasons[0] ?? ''}${a.warnings[0] ? ` / ${a.warnings[0]}` : ''}`)
  }

  if (!r.intent.viewer) lines.push(`뷰어별: ${r.byViewer.map(b => `${b.name} ${b.output ? `→ ${kindLabels[b.output.kind]} (${b.title})` : `미지원 (${b.reason})`}`).join(' · ')}`)
  lines.push(...r.needs.map(n => `필요: ${n}`), ...r.notes.map(n => `알림: ${n}`))

  if (c && stage && !r.blocked) lines.push(`다음: 사용자 확인 뒤 geo_convert({ stage: "${stage}", format: "${r.format}", method: "${c.method}"${r.intent.viewer ? `, viewer: "${r.intent.viewer}"` : ''}, priority: "${r.intent.priority}"${r.intent.output ? `, outputKind: "${r.intent.output}"` : ''}${r.intent.delivery === 'service' ? ', delivery: "service"' : ''} }). 변환은 자동으로 시작하지 않음`)

  return lines.join('\n')
}

const localTime = (iso: string | null) => (iso ? `${iso} (UTC)` : '-')

function statusText(s: Awaited<ReturnType<typeof jobInfo>>) {
  const head = `작업 ${s.job} (${s.name}) ${s.format} · ${s.method?.title ?? ''} · ${s.delivery === 'service' ? `서비스(${SERVICE_HOURS}시간 임시)` : '파일'}${s.intent?.viewerName ? ` · 대상 ${s.intent.viewerName}` : ''}`

  if (s.state === 'running') return `${head}: 변환 중 — ${s.progress.done}/${s.progress.total} 단계${s.progress.current ? `, 지금: ${s.progress.current}` : ''}. 잠시 뒤 다시 geo_status`

  if (s.state === 'failed') return `${head}: 실패 — ${s.error}\n단계 로그: ${s.view.replace('/view?', '/convert?')}`

  // 결과가 약속과 다르면 완료로 안내하지 않는다
  if (s.problems.length) return `${head}: 변환은 끝났지만 결과 확인 실패 — ${s.problems.join(' / ')}\n결과를 쓰지 말고 다른 방식으로 다시: geo_convert({ stage: "${s.job}", … })`
  const lines = [`${head}: 완료 (${(s.progress.ms / 1000).toFixed(0)}초)`, `지도 화면: ${s.view}`]

  if (s.service) {
    const v = s.service
    const left = v.remainingSec > 0 ? `남은 시간 ${Math.floor(v.remainingSec / 3600)}시간 ${Math.floor((v.remainingSec % 3600) / 60)}분` : '이용 불가'

    lines.push(
      `서비스 상태: ${v.status} · 레이어 ${v.layer} · 발행 ${localTime(v.publishedAt)} · 만료 ${localTime(v.expiresAt)} · ${left}`,
      ...s.outputs.filter(o => o.service).map(o => `  ${o.label} (${o.kindLabel}): ${o.available ? o.url : `${o.url} — 만료됨, 이용 불가`}`),
      `서비스는 발행 완료 후 ${SERVICE_HOURS}시간 뒤 자동 만료(이후 410). 연장 없음. 계속 쓰려면 파일 방식으로 변환해 내려받아 직접 호스팅`,
    )
  }

  for (const o of s.outputs.filter(x => !x.service)) {
    lines.push(`${o.primary ? '주력 결과물' : '추가 결과물'}: ${o.label} (${o.kindLabel}) — ${o.crs}${o.layer ? ` · 레이어 ${o.layer}` : ''}${o.features ? ` · 피처 ${o.features}` : ''}`)

    if (o.download) lines.push(`  내려받기${o.zip ? '(zip, 폴더 구조 그대로)' : ''}: ${o.download}`)
    lines.push(`  지도에서 참조할 리소스 URL (이 서버 사본): ${o.url}`)

    if (o.hosting) lines.push(`  직접 호스팅: ${o.hosting}`)

    if (o.check) lines.push(`  결과 파일 검사: ${o.check.ok ? `통과 — ${o.check.checked.join(', ')}` : `문제 — ${o.check.problems.join(', ')}`}${o.check.fields?.length ? ` · 속성: ${o.check.fields.slice(0, 12).join(', ')}` : ''}`)
  }

  for (const u of s.usages) lines.push(`${u.name} 적용 (${u.api}) — URL은 내려받아 올린 곳 주소로 바꿔 사용:\n\`\`\`js\n${u.code}\n\`\`\``)
  lines.push(
    ...s.limits.map(x => `주의: ${x}`),
    '브라우저 렌더링은 서버가 검증하지 않음 → 지도 화면에서 확인',
    s.retention,
    `다른 조건·방식으로 다시: geo_convert({ stage: "${s.job}", format, method?, viewer?, priority? })`,
    s.engine ? `엔진(Unreal) 실시간 보기: geo_engine({ job: "${s.job}" })` : '',
  )

  return lines.filter(Boolean).join('\n')
}

function engineText(e: Awaited<ReturnType<typeof engineInfo>>) {
  if (e.state === 'off') return `엔진 실시간 보기 꺼짐 (작업 ${e.job})${e.log ? `\n마지막 기록:\n${e.log}` : ''}`

  return [
    e.state === 'ready' ? `엔진(Unreal) 실시간 보기 준비됨 — 보는 사람 ${e.viewers}명` : '엔진(Unreal) 실시간 보기 준비 중 — 언리얼이 장면을 불러오는 중(첫 실행은 셰이더 컴파일로 수 분). 잠시 뒤 geo_engine으로 다시 확인',
    `플레이어: ${e.player} — 이 PC·사내망 브라우저에서 열기. 화면 클릭 후 마우스로 시점, WASD·QE로 이동`,
    `${e.idleMin}분 동안 아무도 안 보면 꺼짐. 한 번에 하나. 끄기: geo_engine({ job: "${e.job}", stop: true })`,
  ].join('\n')
}

/** 맡긴 파일의 판별 + 고른 형식(없으면 판별 1순위)에 대한 추천 */
async function planFor(stage: string, format: string | undefined, intent: Intent) {
  const found = await identify(await readStage(stage))
  const pick = format ? found.formats.find(f => f.id === format) : found.formats[0]

  if (!pick) throw createError({ statusCode: 400, statusMessage: format ? `이 파일의 형식 후보가 아님: ${format} (후보: ${found.formats.map(f => f.id).join(', ') || '없음'})` : `받을 수 없는 파일: ${found.note ?? ''}` })
  const spec = uploadFormats.find(f => `${f.category}/${f.id}` === pick.id)

  if (!spec) throw createError({ statusCode: 400, statusMessage: `업로드를 받지 않는 형식: ${pick.id}` })

  return { found, recommendation: recommend(spec, intent, { bytes: found.bytes, count: found.count ?? undefined, srs: found.srs, blocked: found.blocked, schema: found.schema }, serviceEnabled()) }
}

function buildServer(origin: string, owner: string) {
  const server = new McpServer({ name: 'geo-web', version: '1.1.0' }, { instructions: INSTRUCTIONS, capabilities: { extensions: { [EXTENSION_ID]: {} } } })
  const ui = { ui: { resourceUri: APP } }
  const service = { enabled: serviceEnabled(), hours: SERVICE_HOURS, deliveries }

  registerAppTool(server, 'geo_identify', {
    title: '공간 데이터 판별',
    description: '인자 없이(또는 목적만) 호출하면 MCP Apps 업로드 화면을 연다 — 사용자 요청에서 읽은 viewer·priority·outputKind·delivery를 넘기면 화면이 그 조건을 미리 고른다. stage(맡긴 파일 또는 이전 작업 id)를 주면 형식을 판별하고 그 조건의 추천까지 준다. 변환은 시작하지 않는다. URL 가져오기와 서버 로컬 경로는 제공하지 않는다.',
    inputSchema: {
      stage: z.string().optional().describe('이미 맡긴 파일의 stage 또는 이전 작업 id'),
      ...intentArgs,
    },
    _meta: ui,
  }, async (args: { stage?: string } & IntentArgs) => {
    const intent = toIntent(args)

    if (args.stage) {
      const staged = await identify(await readStage(args.stage))

      // 받을 수 없는 파일은 판별 결과(이유)만 — 오류가 아니라 안내
      if (!staged.formats[0]) return { content: [{ type: 'text', text: identifyText(staged) }], structuredContent: { mode: 'choose', origin, intent: intentView(intent), service, ...staged, recommendation: null } }
      const { found, recommendation } = await planFor(args.stage, undefined, intent)

      return {
        content: [{ type: 'text', text: `${identifyText(found)}\n\n${recommendText(recommendation, found.stage)}` }],
        structuredContent: { mode: 'choose', origin, intent: intentView(intent), service, ...found, recommendation },
      }
    }

    const query = new URLSearchParams(Object.entries(intentView(intent)).filter(([, v]) => v !== 'auto' && v !== 'balanced' && v !== 'file'))

    return {
      content: [{ type: 'text', text: `대화 안에 업로드 화면을 띄웠다 (${intentText(intent)} — 화면에 미리 선택). 사용자가 파일을 놓으면 서버가 판별·추천을 계산하고, 사용자가 조건·방식을 확인하거나 바꾼 뒤 변환을 시작하면 그 내용이 대화에 전달된다. 화면을 지원하지 않는 클라이언트는 ${origin}/viz/upload${query.size ? `?${query}` : ''}를 사용자에게 전달한다.${intent.delivery === 'service' && !service.enabled ? ' 이 서버는 서비스 발행을 제공하지 않음 → 화면에 미지원으로 표시.' : ''}` }],
      structuredContent: { mode: 'upload', origin, intent: intentView(intent), service },
    }
  })

  server.registerTool('geo_recommend', {
    title: '변환 방식 추천',
    description: '대상 웹 지도 라이브러리·목적·결과 형식·제공 방식과 파일 특성으로 변환 방식을 추천한다 (서버의 명시 규칙, 읽기 전용 — 변환은 시작하지 않음). 추천·대안·제약·미지원과 이유, 주력 결과물, 손실·배치 주의, 필요한 추가 입력을 준다. stage가 없으면 format만으로(파일 크기 기준 없이).',
    inputSchema: {
      stage: z.string().optional().describe('맡긴 파일의 stage 또는 이전 작업 id'),
      format: z.string().optional().describe('형식 id (예: vector-2d/shp). stage가 있으면 생략 = 판별 1순위'),
      ...intentArgs,
    },
    annotations: { readOnlyHint: true },
  }, async (args: { stage?: string; format?: string } & IntentArgs) => {
    const intent = toIntent(args)

    if (args.stage) {
      const { found, recommendation } = await planFor(args.stage, args.format, intent)

      return { content: [{ type: 'text', text: recommendText(recommendation, found.stage) }], structuredContent: { stage: found.stage, ...recommendation } }
    }

    const spec = uploadFormats.find(f => `${f.category}/${f.id}` === args.format)

    if (!spec) throw createError({ statusCode: 400, statusMessage: 'stage 또는 업로드 받는 형식 id(format) 필요 — geo_formats 참고' })
    const recommendation = recommend(spec, intent, {}, serviceEnabled())

    return { content: [{ type: 'text', text: recommendText(recommendation) }], structuredContent: { ...recommendation } }
  })

  registerAppTool(server, 'geo_convert', {
    title: '웹 형태로 변환',
    description: '맡긴 파일(stage)을 고른 형식(format)·방식(method)으로 변환 시작. method 생략 = 그 조건의 추천 방식. viewer·priority·outputKind·delivery를 넘기면 서버가 그 조건으로 다시 확인(뷰어 미지원·형식 불일치·서비스 미허용이면 거절)하고 작업에 남긴다. 바로 작업 id를 준다 → geo_status로 진행·결과 확인. 한 번에 한 작업.',
    inputSchema: {
      stage: z.string().describe('geo_identify 결과의 stage, 또는 이전 작업 id (같은 파일을 다른 방식으로 다시)'),
      format: z.string().describe('형식 id (예: vector-2d/shp)'),
      method: z.string().optional().describe('방식·도구 id (예: tippecanoe, gdal). 생략 = 추천 방식'),
      srs: z.string().optional().describe('파일에 좌표계가 없을 때 원본 좌표계 (예: EPSG:5186). 판별의 기본값이 있으면 생략 가능'),
      ...intentArgs,
    },
    _meta: ui,
  }, async (args: { stage: string; format: string; method?: string; srs?: string } & IntentArgs) => {
    const s = await readStage(args.stage)
    const job = await startJob({ format: args.format, name: s.name, ext: s.ext, file: s.file, method: args.method, srs: args.srs, intent: toIntent(args) })
    const info = await jobInfo(job, origin)

    return {
      content: [{ type: 'text', text: `변환 시작: 작업 ${job} — ${info.format} · ${info.method?.title} (${info.delivery === 'service' ? `서비스 ${SERVICE_HOURS}시간 임시` : '파일'})${info.intent?.viewerName ? ` · 대상 ${info.intent.viewerName}` : ''}${info.intent?.recommended && info.intent.recommended !== info.method?.id ? ` · 추천(${info.intent.recommended})과 다른 방식` : ''}. 진행: geo_status({ job: "${job}" }). 끝나면 지도 화면: ${info.view}` }],
      structuredContent: { mode: 'progress', origin, ...info },
    }
  })

  server.registerTool('geo_status', {
    title: '변환 상태',
    description: '작업 진행(단계 수·지금 단계), 실패 이유, 끝났으면 대상 뷰어용 주력 결과물·내려받기·리소스 URL·적용 코드·결과 파일 검사·손실 주의. 서비스 작업은 서비스 상태·발행·만료 시각·남은 시간.',
    inputSchema: { job: z.string().describe('geo_convert가 준 작업 id') },
  }, async ({ job }) => {
    const info = await jobInfo(job, origin)

    return { content: [{ type: 'text', text: statusText(info) }], structuredContent: info }
  })

  if (process.env.GEO_ENGINE_ENABLED === '1') {
  registerAppTool(server, 'geo_engine', {
    title: '엔진(Unreal) 실시간 보기',
    description: '변환을 마친 작업의 3D Tiles·지형 결과를 이 서버 PC의 언리얼 엔진(Cesium for Unreal)으로 띄우고 Pixel Streaming 플레이어 주소를 준다. 이 PC·사내망 브라우저에서만 열림. 첫 실행은 셰이더 컴파일로 수 분 → 다시 부르면 상태(starting → ready). 한 번에 하나(다른 작업을 띄우면 앞의 것은 꺼짐), 보는 사람이 없으면 저절로 꺼짐. stop = 끄기.',
    inputSchema: {
      job: z.string().describe('geo_convert가 준 작업 id (3D Tiles·지형 결과)'),
      stop: z.boolean().optional().describe('true = 끄기'),
    },
    _meta: ui,
  }, async ({ job, stop }) => {
    const host = new URL(origin).hostname

    if (stop) engineStop(job)
    const e = stop ? await engineInfo(job, host) : await engineStart(job, host)

    return { content: [{ type: 'text', text: engineText(e) }], structuredContent: { mode: 'engine', origin, ...e } }
  })

  }

  server.registerTool('geo_formats', {
    title: '받는 형식',
    description: '업로드를 받는 형식 전체, 형식마다 고를 수 있는 파일 방식·도구와 뷰어별 지원.',
  }, async () => ({
    content: [{
      type: 'text',
      text: uploadFormats.map(f => {
        const d = describeFormat(f)
        const r = recommend(f, {})

        return `${d.id} ${d.name} (${d.category}) 받는 확장자 ${d.upload.accept?.join(' ') ?? '-'} — 방식: ${d.methods.map(m => `${m.id}[${m.way}]`).join(', ')} — 뷰어: ${r.byViewer.map(b => `${b.name} ${b.output ? kindLabels[b.output.kind] : '미지원'}`).join(' · ')}`
      }).join('\n') + `\n서비스 방식(${SERVICE_HOURS}시간 임시 GeoServer·martin): ${serviceEnabled() ? '이 서버에서 제공 — geo_recommend에 delivery: "service"' : '이 서버는 미제공 (파일만)'}`,
    }],
  }))

  // 업로드 화면 전용: 화면이 서버에 바로 못 보낼 때(로컬 연결의 브라우저 보안 등) 도구 호출로 조각조각 보낸다
  server.registerTool('geo_stage_chunk', {
    title: '파일 조각 올리기 (업로드 화면 전용)',
    description: '업로드 화면이 쓰는 내부 도구.',
    inputSchema: { upload: z.string().optional(), name: z.string(), data: z.string(), last: z.boolean() },
    _meta: { ui: { visibility: ['app'] } },
  }, async c => {
    const r = await stageChunk(c)

    if (!r.staged) return { content: [{ type: 'text', text: 'ok' }], structuredContent: { upload: r.upload } }
    const info = await identify(r.staged)

    return { content: [{ type: 'text', text: identifyText(info) }], structuredContent: { mode: 'choose', origin, service, upload: r.upload, ...info } }
  })

  registerAppResource(server, '공간 데이터 시각화 도구 (MCP Apps 베타)', APP, { description: '베타: 업로드·목적에 맞는 변환 추천·변환 진행·결과. 호스트별 앱 지원 필요.' }, async () => {
    const code = await appSdk()

    return { contents: [{
      uri: APP,
      mimeType: RESOURCE_MIME_TYPE,
      // 함수로 바꿔 넣는다: 문자열이면 SDK 안의 $&·$' 등을 치환 패턴으로 읽는다
      text: String(await useStorage('assets:server').getItem('mcp-app.html')).replaceAll('__ORIGIN__', origin).replace('__MCP_APPS_SDK__', () => code),
      // origin: 파일 바로 올리기(connect)·결과 지도(frame), clipboardWrite: 주소 복사 버튼. 외부 스크립트 없음 (SDK는 화면 안)
      _meta: { ui: { csp: { connectDomains: [origin], frameDomains: [origin] }, permissions: { clipboardWrite: {} }, prefersBorder: true } },
    }] }
  })

  if (process.env.GEO_PUBLIC_CONVERSIONS !== '1') registerLinkTools(server, origin, owner, appSdk)

  return server
}

export default defineEventHandler(async event => {
  const url = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true })
  const origin = (process.env.PUBLIC_URL || url.origin).replace(/\/$/, '')
  const requestOrigin = getHeader(event, 'origin')
  const allowedOrigins = new Set([origin, 'https://claude.ai', 'https://chatgpt.com'])

  if (requestOrigin && !allowedOrigins.has(requestOrigin)) throw createError({ statusCode: 403, statusMessage: 'Origin unavailable' })

  if (process.env.GEO_PUBLIC_CONVERSIONS !== '1' && event.method === 'DELETE' && getHeader(event, 'mcp-session-id')) {
    await mcpLinkOwner(event)
    setResponseStatus(event, 204)

    return ''
  }

  if (event.method !== 'POST') {
    setResponseStatus(event, 405)

    return { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }
  }

  let parsed: ReturnType<typeof JSONRPCMessageSchema.safeParse>

  try { parsed = JSONRPCMessageSchema.safeParse(JSON.parse((await readLimitedBody(event, 2 * 1024 ** 2)).toString('utf8'))) }
  catch (error) {
    if (error instanceof SyntaxError) return { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error.' }, id: null }
    throw error
  }

  if (!parsed.success) return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid request.' }, id: null }

  const body = parsed.data
  const owner = process.env.GEO_PUBLIC_CONVERSIONS === '1' ? '' : await mcpLinkOwner(event, 'method' in body && body.method === 'initialize')
  const server = buildServer(origin, owner)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  event.node.res.on('close', () => { transport.close(); server.close() })
  await server.connect(transport)
  await transport.handleRequest(event.node.req, event.node.res, body)
})
