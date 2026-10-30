import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { inputRowSchema, linkOptionsSchema } from '../../shared/link/types.ts'
import type { LinkBatch } from '../../shared/link/types.ts'
import { lookupRegions } from '../../shared/link/core.ts'
import { getReference } from '../services/link/reference.ts'
import { getAdministrativeReference } from '../services/link/administrative-reference.ts'
import { exportLegalBoundary } from '../services/link/boundary.ts'
import { lookupAdministrative } from '../../shared/link/administrative.ts'
import { capabilities, previewUpload, resolveInput } from '../services/link/service.ts'
import { createLinkExport, getLinkJob, readLinkArtifact, startLinkJob } from '../services/link/jobs.ts'
import { LINK_CHUNK_BYTES, linkUploadChunk } from '../services/link/chunks.ts'
import { LinkServiceError, linkLimits } from '../services/link/files.ts'

export const LINK_APP = 'ui://geo/link.html'
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()
const settings = { sheet: z.string().max(200).optional(), headerRow: z.union([z.boolean(), z.number().int().min(1).max(linkLimits.rows)]).optional(), column: z.number().int().min(0).max(linkLimits.columns - 1).optional() }
const input = {
  text: z.string().max(400_000).optional(), rows: z.array(inputRowSchema).max(linkLimits.rows).optional(),
  uploadId: z.string().uuid().optional(), uploadToken: tokenSchema, ...settings, options: linkOptionsSchema.optional(),
}
const modelOptions = (options: LinkBatch['options']) => {
  const { selections, conversionSelections, ...values } = options
  return { ...values, selectionCount: Object.keys(selections || {}).length + Object.values(conversionSelections || {}).reduce((sum, selected) => sum + Object.keys(selected || {}).length, 0) }
}
const inputPreview = (rows: string[][]) => rows.slice(0, 10).map(row => row.slice(0, 10).map(value => value.slice(0, 300)))
function preview(batch: LinkBatch) {
  return { ...batch, options: modelOptions(batch.options), rows: batch.rows.slice(0, 10).map(row => ({ ...row,
    original: Object.fromEntries(Object.entries(row.original).slice(0, 10).map(([k, v]) => [k.slice(0, 100), v.slice(0, 300)])),
    value: row.value.slice(0, 300), candidates: row.candidates.slice(0, 10),
    ...(row.conversions && { conversions: Object.fromEntries(Object.entries(row.conversions).map(([key, result]) => [key, { ...result, candidates: result.candidates.slice(0, 10) }])) }),
  })), returned: Math.min(batch.rows.length, 10), total: batch.summary.total, truncated: batch.summary.total > Math.min(batch.rows.length, 10), previewOnly: true }
}
const answer = (data: Record<string, unknown>, message: string, meta?: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: message }], structuredContent: data, ...(meta && { _meta: meta }),
})
const safe = (fn: (...args: any[]) => Promise<any>) => async (...args: any[]) => {
  try { return await fn(...args) }
  catch (error) {
    const known = error instanceof LinkServiceError
    return { isError: true, ...answer({ error: { code: known ? error.code : 'INVALID_INPUT', message: known ? error.message : '입력·옵션 또는 접근권한을 확인하세요.' } }, known ? error.message : '입력·옵션 또는 접근권한을 확인하세요.') }
  }
}

export function registerLinkTools(server: McpServer, origin: string, owner: string, appSdk: () => Promise<string>) {
  const ui = { ui: { resourceUri: LINK_APP } }
  const access = (token?: string) => ({ owner, token })
  server.registerTool('geo_link_capabilities', { title: '주소·코드 지원 범위', description: '실제 기준자료 버전·지원 기능·한도·보관 및 미지원 범위를 확인한다.', annotations: { readOnlyHint: true } }, safe(async () => {
    const info = await capabilities()
    return answer({ ...info, web: `${origin}/link`, referenceWeb: `${origin}/link/reference`, app: LINK_APP, modelPreviewRows: 10 }, `입력·출력: PNU·법정동코드 / 행정동코드 / 주소 / 위치. 경계 SHP는 출력 전용이며 원천 권한이 필요합니다. PNU 앞 2·5·8·10자리는 법정구역 코드이며 행정동과 다릅니다. 법정동 기준 ${info.reference.version}, 행정동 기준 ${info.administrative.version}. 웹 ${origin}/link`)
  }))
  registerAppTool(server, 'geo_link_resolve', { title: '주소·코드 변환', description: '입력은 pnu_legal(PNU·법정동코드), administrative(행정동코드), address(주소), location(X,Y). target=all로 주소·PNU·법정동 단계코드·행정동·위치를 한 번에 조회한다(최대 20행). 각 conversions 항목의 상태·후보·오류는 독립적이다. conversionSelections에 결과 항목별 후보를 지정한다. sourceCrs·outputCrs로 EPSG 지정. SHP는 변환 시 조회하지 않고 앱·웹의 별도 다운로드 버튼으로 받는다. 기존 단일 target도 유지한다. 입력이 없으면 화면. 모델 미리보기 최대 10행.', inputSchema: input, _meta: ui }, safe(async args => {
    if (args.text === undefined && args.rows === undefined && !args.uploadId) return answer({ mode: 'input', origin, web: `${origin}/link` }, `입력 유형과 값을 지정하면 주소·PNU·법정동·행정동·위치를 한 번에 확인합니다. SHP는 별도 다운로드 버튼을 사용하세요. 화면 미지원 환경은 text와 options={inputType,target:"all"}로 호출하거나 ${origin}/link 를 이용하세요.`, { ownerSession: true })
    const batch = await resolveInput(args, access(args.uploadToken))
    return answer({ mode: 'result', origin, ...preview(batch) }, `입력 ${batch.summary.input}행: 정상 ${batch.summary.ok}, 후보 ${batch.summary.needs_selection}, 실패 행 ${batch.summary.invalid + batch.summary.not_found + batch.summary.unavailable}. ${batch.options.target === 'all' ? '주소·PNU·법정동·행정동·위치의 상태와 오류는 conversions에서 각각 확인하세요. ' : ''}기준 ${batch.version}. 모델 미리보기 최대 10행.`, { linkResult: batch })
  }))
  server.registerTool('geo_link_regions', { title: '법정동·행정동 조회', description: '법정동 또는 행정동 체계를 명시해 코드·명칭을 조회한다. 필지 목록 조회와 구분한다. 최대 50개.', inputSchema: { codeSystem: z.enum(['legal_region', 'administrative_region']).default('legal_region'), query: z.string().max(200).optional(), parentCode: z.string().regex(/^\d{10}$/).optional(), descendants: z.boolean().optional(), includeRetired: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }, annotations: { readOnlyHint: true } }, safe(async args => {
    if (args.codeSystem === 'administrative_region') {
      const reference = await getAdministrativeReference(), result = lookupAdministrative({ ...args, limit: args.limit || 20 }, reference)
      return answer({ ...result, codeSystem: 'administrative_region' }, `행정동 조회. 기준 ${reference.version}. 법정동코드와 다른 주민센터 관할 코드입니다.`)
    }
    const reference = await getReference(), result = lookupRegions({ ...args, limit: args.limit || 20 }, reference)
    return answer({ version: reference.version, ...result }, `법정구역 조회. 기준 ${reference.version}. ${reference.available ? '코드 사전 조회이며 필지 목록은 포함하지 않음.' : '기준자료 미준비.'}`)
  }))
  registerAppTool(server, 'geo_link_run', { title: '주소·코드 일괄 작업', description: '검증된 목록 또는 geo_link_upload_chunk로 맡긴 CSV·XLSX의 작업을 시작. 작업 ID 반환. 기준자료·옵션을 시작 시 고정하며 동일 세션·멱등 키의 중복 실행을 제어한다. cookie 유지가 없는 호스트는 웹 또는 앱의 접근 토큰이 필요하다.', inputSchema: { ...input, idempotencyKey: z.string().min(1).max(200).optional() }, _meta: ui }, safe(async ({ idempotencyKey, ...args }) => {
    const { accessToken, ...job } = await startLinkJob(args, access(args.uploadToken), idempotencyKey)
    return answer({ mode: 'job', origin, ...job, options: modelOptions(job.options), web: `${origin}/link#job=${job.id}` }, `일괄 작업 ${job.id}. geo_link_status로 진행 확인. 웹 ${origin}/link (동일 소유자 권한 필요).`, { ...(accessToken && { accessToken }), web: `${origin}/link#job=${job.id}${accessToken ? `&token=${accessToken}` : ''}` })
  }))
  registerAppTool(server, 'geo_link_status', { title: '주소·코드 작업 상태', description: '작업 소유자·만료 확인 후 상태·오류 요약·최대 10행 미리보기. 전체 결과를 모델 문맥에 넣지 않는다.', inputSchema: { job: z.string().uuid(), accessToken: tokenSchema }, _meta: ui }, safe(async ({ job, accessToken }) => {
    const info = await getLinkJob(job, access(accessToken), 0, 10)
    const result = info.result ? preview(info.result) : undefined
    return answer({ mode: 'job', origin, ...info, options: modelOptions(info.options), ...(result && { result }), web: `${origin}/link#job=${job}` }, `작업 ${job}: ${info.state}. ${result ? `전체 ${result.summary.total}행, 정상 ${result.summary.ok}, 후보 ${result.summary.needs_selection}. 기준 ${result.version}.` : '진행·오류 요약을 확인하세요.'}`, accessToken ? { accessToken, web: `${origin}/link#job=${job}&token=${accessToken}` } : undefined)
  }))
  server.registerTool('geo_link_export', { title: '주소·코드 파일 출력', description: '완료 작업에서 선택 열의 CSV·XLSX·JSON 파일을 생성하고 파일 참조만 반환. XLSX 코드는 문자형. CSV 인용은 숫자 자동 해석을 막지 못하므로 Excel에는 XLSX 권장. 다운로드는 동일 소유자 권한 필요.', inputSchema: { job: z.string().uuid(), accessToken: tokenSchema, format: z.enum(['csv', 'xlsx', 'json']), columns: z.array(z.string().max(200)).max(250).optional() } }, safe(async ({ job, accessToken, format, columns }) => {
    const artifact = await createLinkExport(job, access(accessToken), format, columns)
    return answer({ ...artifact, url: new URL(artifact.url, origin).href, job, web: `${origin}/link#job=${job}` }, `파일 생성: ${artifact.filename} (${artifact.bytes} bytes). ${new URL(artifact.url, origin).href} — 동일 연결의 Mcp-Session-Id 헤더, 소유자 쿠키 또는 Bearer 권한 필요. SDK 클라이언트는 transport.sessionId를 다운로드 요청 헤더에 전달하세요. 브라우저에는 인증된 웹 결과 화면을 사용하세요.`, accessToken ? { accessToken, web: `${origin}/link#job=${job}&token=${accessToken}` } : undefined)
  }))
  server.registerTool('geo_link_upload_chunk', { title: '연계 파일 조각 업로드', description: '앱 전용. 권한·순서·크기·재전송을 검사하는 CSV·XLSX 직접 업로드.', inputSchema: { upload: z.string().uuid().optional(), accessToken: tokenSchema, name: z.string().max(200), sequence: z.number().int().min(0), data: z.string().max(Math.ceil(LINK_CHUNK_BYTES / 3) * 4), last: z.boolean() }, _meta: { ui: { visibility: ['app'] } } }, safe(async args => {
    const { accessToken, staged, ...part } = await linkUploadChunk(args, owner)
    if (!staged) return answer({ ...part }, '업로드 조각 수신.', { accessToken })
    const { accessToken: uploadToken, issues, ...info } = staged
    return answer({ ...part, staged: { ...info, preview: inputPreview(info.preview) } }, '파일 업로드 완료. 미리보기는 최대 10행·10열이며 셀은 300자까지입니다. 시트·헤더·입력 열을 확인하세요.', { accessToken, uploadToken })
  }))
  server.registerTool('geo_link_preview', { title: '연계 파일 매핑 확인', description: '앱 전용. 시트·헤더·입력 열 미리보기.', inputSchema: { uploadId: z.string().uuid(), accessToken: tokenSchema, ...settings }, _meta: { ui: { visibility: ['app'] } } }, safe(async ({ uploadId, accessToken, ...mapping }) => {
    const info = await previewUpload(uploadId, access(accessToken), mapping)
    return answer({ ...info, preview: inputPreview(info.preview), issues: undefined }, '입력 파일 매핑 미리보기 (최대 10행·10열, 셀 300자).')
  }))
  server.registerTool('geo_link_download', { title: '연계 파일 앱 다운로드', description: '앱 전용. 권한을 확인한 파일을 호스트 다운로드에 전달한다.', inputSchema: { job: z.string().uuid(), artifactId: z.string().uuid(), accessToken: tokenSchema }, _meta: { ui: { visibility: ['app'] } } }, safe(async ({ job, artifactId, accessToken }) => {
    const file = await readLinkArtifact(job, artifactId, access(accessToken))
    if (file.data.length > linkLimits.uncompressedBytes) throw new LinkServiceError('FILE_TOO_LARGE', '앱 다운로드 한도를 넘었습니다. 인증된 웹 화면에서 내려받으세요.', 413)
    return answer({ filename: file.filename, bytes: file.data.length }, '파일을 호스트 다운로드에 전달합니다.', { resource: { type: 'resource', resource: { uri: `geo-link://exports/${artifactId}/${file.filename}`, mimeType: file.mime, blob: file.data.toString('base64') } } })
  }))
  server.registerTool('geo_link_boundary', { title: '법정동 경계 SHP', description: '앱 전용 출력. 확인한 법정구역 코드의 공식 다각형을 SHP ZIP으로 받는다. 경계 원천 권한이 없으면 설정 사유를 반환하며 도형을 만들지 않는다.', inputSchema: { codes: z.array(z.string().regex(/^(?:\d{2}|\d{5}|\d{8}|\d{10})$/)).min(1).max(20), crs: z.literal('EPSG:4326').default('EPSG:4326') }, _meta: { ui: { visibility: ['app'] } } }, safe(async ({ codes, crs }) => {
    const file = await exportLegalBoundary(codes, crs)
    return answer({ filename: file.filename, bytes: file.data.length, codes, crs, sourceDate: file.sourceDate, checkedAt: file.checkedAt }, '공식 법정구역 경계 SHP 묶음입니다.', { resource: { type: 'resource', resource: { uri: 'geo-link://boundary/' + file.filename, mimeType: file.mime, blob: file.data.toString('base64') } } })
  }))
  registerAppResource(server, '국내 주소·코드 연계 도구', LINK_APP, { description: '입력 유형 선택·직접 입력·출력 유형 선택·바로 변환' }, async () => {
    const code = await appSdk()
    return { contents: [{
    uri: LINK_APP, mimeType: RESOURCE_MIME_TYPE,
    text: String(await useStorage('assets:server').getItem('mcp-link.html')).replace('__LINK_ORIGIN__', () => JSON.stringify(origin).replaceAll('<', '\\u003c')).replace('__MCP_APPS_SDK__', () => code),
    _meta: { ui: { csp: { connectDomains: [origin] }, permissions: { clipboardWrite: {} }, prefersBorder: true } },
    }] }
  })
}
