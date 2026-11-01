// MCP 서버 (Streamable HTTP, 요청마다 새 서버 = 상태 없음). 공간 데이터 파일을 받아 형식 판별 → 형식·방식 고르기 → 변환 → 결과 주소.
// MCP App(ui://geo/app.html, server/assets/mcp-app.html): Claude 대화 안에 업로드·고르기·진행·지도 화면을 띄운다.
// 로컬 Claude Desktop: claude_desktop_config.json에 cmd /c npx mcp-remote http://localhost:3000/mcp (README "MCP")
import { EXTENSION_ID, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { registerLinkTools } from '../mcp/link'
import { readLimitedBody } from '../services/link/access'
import { mcpLinkOwner } from '../services/link/mcp-access'

const APP = 'ui://geo/app.html'

const INSTRUCTIONS = `공간 데이터 파일을 웹 지도용 파일로 변환하고 결과 화면·다운로드 주소를 준다.
MCP Apps 연동은 베타 기능이다. 대화 안 앱 화면과 내려받기 지원은 호스트에 따라 다르다.
geo_identify를 인자 없이 호출해 MCP Apps 업로드 화면을 연다 → 사용자가 파일을 올리고 형식·도구를 선택 → geo_convert → geo_status로 진행과 결과 확인. 같은 파일을 다시 처리하려면 geo_convert의 stage에 이전 작업 id를 쓴다. 받는 형식은 geo_formats.
공개 서버는 파일 업로드만 받는다. 채팅 첨부 파일을 자동으로 읽지 않으며 URL 가져오기·서버 로컬 경로·공유 공간 서버 발행은 제공하지 않는다. 최대 200MB, 한 번에 한 변환. 원본·결과는 운영자가 정리할 때까지 보관하며 결과 링크를 아는 사용자가 열 수 있다.
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

/** 판별 결과 → 모델이 읽을 글 (화면은 structuredContent) */
function identifyText(r: Awaited<ReturnType<typeof identify>>) {
  return [
    `판별: ${r.name} (${bytesText(r.bytes)}) — ${r.facts.join(' · ')}`,
    ...r.warns.map(w => `주의: ${w}`),
    ...(r.srs ? [`좌표계 필요: ${r.srs.why}${r.srs.guess ? ` (기본값 ${r.srs.guess})` : ''} → geo_convert의 srs에 EPSG:번호`] : []),
    ...(r.note ? [`받을 수 없음: ${r.note}`] : []),
    ...r.formats.map((f, i) => `${i + 1}. ${f.id} ${f.name} (${f.category})${f.best ? ' ← 판별 결과' : ''}\n   방식: ${f.methods.map(m => `${m.id}[${m.way}] ${m.title} → ${m.outputs.join('·')}${m.when ? ` — ${m.when}` : ''}`).join(' / ')}`),
    r.formats.length ? `다음: geo_convert({ stage: "${r.stage}", format, method${r.srs ? ', srs' : ''} }). 방식 생략 = 첫 번째` : '',
  ].filter(Boolean).join('\n')
}

function statusText(s: Awaited<ReturnType<typeof jobInfo>>) {
  const head = `작업 ${s.job} (${s.name}) ${s.format} · ${s.method?.title ?? ''}: ${({ running: '변환 중', done: '완료', failed: '실패' })[s.state]}`

  if (s.state === 'running') return `${head} — ${s.progress.done}/${s.progress.total} 단계${s.progress.current ? `, 지금: ${s.progress.current}` : ''}. 잠시 뒤 다시 geo_status`

  if (s.state === 'failed') return `${head} — ${s.error}\n단계 로그: ${s.view.replace('/view?', '/convert?')}`

  return [
    `${head} (${(s.progress.ms / 1000).toFixed(0)}초)`, `지도 화면: ${s.view}`,
    ...s.outputs.map(o => `${o.label}: ${o.url}${o.download ? `\n  내려받기${o.zip ? '(zip)' : ''}: ${o.download}` : ''}`),
    '원본·결과는 운영자가 정리할 때까지 보관합니다. 결과 링크를 아는 사용자가 열 수 있습니다.',
    `다른 형식·방식으로 다시: geo_convert({ stage: "${s.job}", format, method })`,
    s.engine ? `엔진(Unreal) 실시간 보기: geo_engine({ job: "${s.job}" })` : '',
  ].filter(Boolean).join('\n')
}

function engineText(e: Awaited<ReturnType<typeof engineInfo>>) {
  if (e.state === 'off') return `엔진 실시간 보기 꺼짐 (작업 ${e.job})${e.log ? `\n마지막 기록:\n${e.log}` : ''}`

  return [
    e.state === 'ready' ? `엔진(Unreal) 실시간 보기 준비됨 — 보는 사람 ${e.viewers}명` : '엔진(Unreal) 실시간 보기 준비 중 — 언리얼이 장면을 불러오는 중(첫 실행은 셰이더 컴파일로 수 분). 잠시 뒤 geo_engine으로 다시 확인',
    `플레이어: ${e.player} — 이 PC·사내망 브라우저에서 열기. 화면 클릭 후 마우스로 시점, WASD·QE로 이동`,
    `${e.idleMin}분 동안 아무도 안 보면 꺼짐. 한 번에 하나. 끄기: geo_engine({ job: "${e.job}", stop: true })`,
  ].join('\n')
}

function buildServer(origin: string, owner: string) {
  const server = new McpServer({ name: 'geo-web', version: '1.0.0' }, { instructions: INSTRUCTIONS, capabilities: { extensions: { [EXTENSION_ID]: {} } } })
  const ui = { ui: { resourceUri: APP } }

  registerAppTool(server, 'geo_identify', {
    title: '공간 데이터 판별',
    description: '이미 맡긴 파일의 stage 또는 이전 작업 id로 형식을 확인한다. 인자 없이 호출하면 MCP Apps 업로드 화면을 연다. URL 가져오기와 서버 로컬 경로는 제공하지 않는다.',
    inputSchema: {
      stage: z.string().optional().describe('이미 맡긴 파일의 stage 또는 이전 작업 id'),
    },
    _meta: ui,
  }, async (args: { stage?: string }) => {
    if (args.stage) {
      const r = await identify(await readStage(args.stage))

      return { content: [{ type: 'text', text: identifyText(r) }], structuredContent: { mode: 'choose', origin, ...r } }
    }

    return {
        content: [{ type: 'text', text: `대화 안에 업로드 화면을 띄웠다. 사용자가 파일을 놓으면 화면에 판별 결과와 형식·방식 선택이 나온다. 사용자가 화면에서 변환을 시작하면 그 내용이 대화에 전달된다. 화면을 지원하지 않는 클라이언트는 ${origin}/viz/upload를 사용자에게 전달한다.` }],
        structuredContent: { mode: 'upload', origin },
      }
  })

  registerAppTool(server, 'geo_convert', {
    title: '웹 형태로 변환',
    description: 'geo_identify로 맡긴 파일(stage)을 고른 형식(format)·방식(method)으로 변환 시작. 바로 작업 id를 준다 → geo_status로 진행·결과 확인. 한 번에 한 작업.',
    inputSchema: {
      stage: z.string().describe('geo_identify 결과의 stage, 또는 이전 작업 id (같은 파일을 다른 방식으로 다시)'),
      format: z.string().describe('형식 id (예: vector-2d/shp)'),
      method: z.string().optional().describe('방식·도구 id (예: tippecanoe, geoserver). 생략 = 첫 번째'),
      srs: z.string().optional().describe('파일에 좌표계가 없을 때 원본 좌표계 (예: EPSG:5186)'),
    },
    _meta: ui,
  }, async ({ stage, format, method, srs }) => {
    const s = await readStage(stage)
    const job = await startJob({ format, name: s.name, ext: s.ext, file: s.file, method, srs })
    const info = await jobInfo(job, origin)

    return {
      content: [{ type: 'text', text: `변환 시작: 작업 ${job} — ${info.format} · ${info.method?.title}. 진행: geo_status({ job: "${job}" }). 끝나면 지도 화면: ${info.view}` }],
      structuredContent: { mode: 'progress', origin, ...info },
    }
  })

  server.registerTool('geo_status', {
    title: '변환 상태',
    description: '작업 진행(단계 수·지금 단계), 실패 이유, 끝났으면 지도 화면·결과 파일·서비스 주소.',
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
    description: '업로드를 받는 형식 전체와 형식마다 고를 수 있는 방식·도구.',
  }, async () => ({
    content: [{
      type: 'text',
      text: uploadFormats.map(describeFormat).map(f => `${f.id} ${f.name} (${f.category}) 받는 확장자 ${f.upload.accept?.join(' ') ?? '-'} — 방식: ${f.methods.map(m => `${m.id}[${m.way}]`).join(', ')}`).join('\n'),
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

    return { content: [{ type: 'text', text: identifyText(info) }], structuredContent: { mode: 'choose', origin, upload: r.upload, ...info } }
  })

  registerAppResource(server, '공간 데이터 시각화 도구 (MCP Apps 베타)', APP, { description: '베타: 업로드·형식 고르기·변환 진행·결과 지도. 호스트별 앱 지원 필요.' }, async () => {
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
