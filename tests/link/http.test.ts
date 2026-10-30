import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import ExcelJS from 'exceljs-community'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const base = process.env.LINK_TEST_URL || 'http://127.0.0.1:3017'
function client() {
  let cookie = '', sequence = 0
  const request = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie && { cookie }), ...(body !== undefined && !(body instanceof FormData) && { 'content-type': 'application/json' }), ...headers }, ...(body !== undefined && { body: body instanceof FormData ? body : JSON.stringify(body) }) })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]!
    return response
  }
  const rpc = async (method: string, params: object = {}) => {
    const response = await request('/mcp', { jsonrpc: '2.0', id: ++sequence, method, params }, { Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' })
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.error, undefined)
    return data.result
  }
  const tool = (name: string, args: object = {}) => rpc('tools/call', { name, arguments: args })
  return { request, rpc, tool }
}
const input = { text: '1111010100100010000\n1111010100200010000\ninvalid', options: { inputType: 'pnu', level: 'eupmyeondong', output: 'both', addressStyle: 'full' } }
async function completed(c: ReturnType<typeof client>, id: string) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const response = await c.request(`/api/link/jobs/${id}`), data = await response.json()
    assert.equal(response.status, 200)
    if (!['queued', 'running'].includes(data.state)) { assert.notEqual(data.state, 'failed'); return data }
    await new Promise(done => setTimeout(done, 30))
  }
  assert.fail('작업이 제한 시간에 완료되지 않았습니다.')
}

test('HTTP·MCP 소량 변환은 결과·오류·버전·필지 미확인이 같다', async () => {
  const c = client(), response = await c.request('/api/link/resolve', input)
  assert.equal(response.status, 200)
  const http = await response.json(), mcp = await c.tool('geo_link_resolve', input)
  assert.equal(mcp.isError, undefined)
  assert.equal(mcp.structuredContent.version, http.version)
  assert.deepEqual(mcp.structuredContent.rows, http.rows)
  assert.deepEqual(mcp.structuredContent.errors, http.errors)
  assert.ok(http.rows.every((r: any) => r.parcel === 'not_checked'))
})

test('쿠키 없는 공식 MCP SDK 클라이언트도 세션 헤더로 작업·출력 권한을 유지', async () => {
  const sdk = new Client({ name: 'geo-link-contract-test', version: '1' })
  const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'))
  await sdk.connect(transport)
  try {
    const sessionId = transport.sessionId
    assert.ok(sessionId)
    const started = await sdk.callTool({ name: 'geo_link_run', arguments: input })
    const id = (started.structuredContent as any).id
    let info: any
    for (let i = 0; i < 100; i++) {
      info = await sdk.callTool({ name: 'geo_link_status', arguments: { job: id } })
      if (['completed','completed_with_issues'].includes(info.structuredContent?.state)) break
      await new Promise(done => setTimeout(done, 30))
    }
    assert.equal(info.isError, undefined)
    assert.equal(info.structuredContent.result.summary.total, 3)
    const file = await sdk.callTool({ name: 'geo_link_export', arguments: { job: id, format: 'csv' } })
    const url = (file.structuredContent as any).url
    assert.ok(url)
    // 모델에 반환된 URL은 권한 없는 임의 브라우저에서는 열리지 않는다.
    assert.equal((await fetch(url)).status, 403)
    const authenticated = await fetch(url, { headers: { 'Mcp-Session-Id': sessionId! } })
    assert.equal(authenticated.status, 200)
    assert.ok((await authenticated.text()).includes('1111010100100010000'))
    await transport.terminateSession()
    const revoked = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Session-Id': sessionId! }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    assert.equal(revoked.status, 404)
  } finally { await sdk.close() }
})

test('기존 도구·앱을 보존하고 신규 도구와 설치 SDK 앱 리소스를 제공', async () => {
  const c = client(), list = await c.rpc('tools/list'), names = list.tools.map((t: any) => t.name)
  for (const name of ['geo_identify','geo_convert','geo_status','geo_engine','geo_formats','geo_stage_chunk','geo_link_capabilities','geo_link_resolve','geo_link_regions','geo_link_run','geo_link_status','geo_link_export']) assert.ok(names.includes(name), name)
  const resourceList = await c.rpc('resources/list')
  for (const uri of ['ui://geo/app.html','ui://geo/link.html']) {
    assert.ok(resourceList.resources.some((r: any) => r.uri === uri))
    const read = await c.rpc('resources/read', { uri }), resource = read.contents[0]
    assert.ok(resource.mimeType.startsWith('text/html'))
    assert.ok(resource.mimeType.includes('mcp-app'))
    assert.ok(!resource.text.includes('__MCP_APPS_SDK__'))
    assert.ok(resource._meta.ui.csp.connectDomains.includes(base))
    if (uri.endsWith('link.html')) { assert.ok(resource.text.includes('getHostCapabilities')); assert.ok(resource.text.includes('geo_link_resolve')); assert.ok(!resource.text.includes('type="file"')); assert.ok(!resource.text.includes('geo_link_upload_chunk')) }
  }
  const fallback = await c.tool('geo_link_resolve')
  assert.equal(fallback.structuredContent.mode, 'input')
  assert.ok(fallback.content[0].text.includes('/link'))
  const old = await c.tool('geo_identify')
  assert.equal(old.structuredContent.mode, 'upload')
  const formats = await c.tool('geo_formats')
  assert.ok(formats.content[0].text.includes('vector-2d/shp'))
})

test('비동기 작업·멱등 실행·소유자 권한·파일 출력 전체 계약', async () => {
  const c = client(), other = client(), key = randomUUID()
  const first = await (await c.request('/api/link/jobs', { ...input, idempotencyKey: key })).json()
  assert.ok(first.id); assert.equal(first.accessToken, undefined)
  const reused = await (await c.request('/api/link/jobs', { ...input, idempotencyKey: key })).json()
  assert.equal(reused.id, first.id)
  assert.equal((await c.request('/api/link/jobs', { text: 'different', idempotencyKey: key })).status, 409)
  const info = await completed(c, first.id)
  assert.equal(info.result.summary.input, 3)
  assert.equal((await other.request(`/api/link/jobs/${first.id}`)).status, 403)
  for (const format of ['csv','xlsx','json']) {
    const response = await c.request(`/api/link/jobs/${first.id}/export`, { format })
    assert.equal(response.status, 200)
    const artifact = await response.json()
    assert.equal((await other.request(artifact.url)).status, 403)
    const download = await c.request(artifact.url)
    assert.equal(download.status, 200)
    assert.ok(download.headers.get('content-disposition')?.includes('attachment'))
    const buffer = Buffer.from(await download.arrayBuffer())
    assert.ok(buffer.length > 0)
    if (format === 'xlsx') {
      const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer as never)
      const sheet = book.worksheets[0]!, header = sheet.getRow(1).values as string[]
      const source = header.findIndex(v => v?.startsWith?.('원본:'))
      assert.equal(typeof sheet.getCell(2, source).value, 'string')
      assert.equal(sheet.getCell(2, source).value, '1111010100100010000')
    }
    if (format === 'json') { const data = JSON.parse(buffer.toString()); assert.equal(data.version, info.result.version); assert.equal(data.rows.length, 3) }
    if (format === 'csv') assert.ok(buffer.toString().includes('1111010100100010000'))
  }
  const mcp = await c.tool('geo_link_status', { job: first.id })
  assert.equal(mcp.isError, undefined); assert.equal(mcp.structuredContent.result.version, info.result.version)
  const denied = await other.tool('geo_link_status', { job: first.id })
  assert.equal(denied.isError, true)
})

test('MCP 작업 토큰은 모델 결과에 없고 앱 다운로드·웹 권한 전달에 사용', async () => {
  const c = client(), other = client(), result = await c.tool('geo_link_run', input)
  const id = result.structuredContent.id, token = result._meta.accessToken
  assert.ok(id); assert.equal(typeof token, 'string')
  assert.ok(!JSON.stringify(result.structuredContent).includes(token))
  assert.ok(!JSON.stringify(result.content).includes(token))
  await completed(c, id)
  const viaToken = await other.tool('geo_link_status', { job: id, accessToken: token })
  assert.equal(viaToken.isError, undefined)
  const file = await other.tool('geo_link_export', { job: id, accessToken: token, format: 'xlsx' })
  assert.ok(file.structuredContent.artifactId)
  const download = await other.tool('geo_link_download', { job: id, artifactId: file.structuredContent.artifactId, accessToken: token })
  assert.ok(download._meta.resource.resource.blob)
  assert.equal(download.structuredContent.blob, undefined)
  const claimed = await other.request(`/api/link/jobs/${id}/claim`, { accessToken: token })
  assert.equal(claimed.status, 200)
  assert.equal((await other.request(`/api/link/jobs/${id}`)).status, 200)
})

test('MCP 미리보기는 10행·전체수 구분, regions 조회와 웹 일치', async () => {
  const c = client(), result = await c.tool('geo_link_resolve', { text: Array(12).fill('1111010100100010000').join('\n') })
  assert.equal(result.structuredContent.rows.length, 10); assert.equal(result.structuredContent.total, 12); assert.equal(result.structuredContent.truncated, true)
  assert.equal(result._meta.linkResult.rows.length, 12)
  const features = await c.tool('geo_link_capabilities')
  assert.deepEqual(features.structuredContent.outputs, ['text', 'legal_boundary_shp'])
  assert.equal(features.structuredContent.fileWorkflow, 'csv_xlsx_deferred')
  const http = await (await c.request('/api/link/regions?query=청운동&limit=20')).json(), mcp = await c.tool('geo_link_regions', { query: '청운동', limit: 20 })
  assert.deepEqual(mcp.structuredContent.rows, http.rows)
  const unsupported = await c.request('/api/link/regions?codeSystem=postal')
  assert.equal(unsupported.status, 400)
})

test('PNU·법정동과 행정동을 구분하며 공식 복수 관계와 웹·MCP 결과가 같다', async () => {
  const c = client()
  const options = { inputType: 'pnu_legal', target: 'administrative_region', output: 'code' }
  const source = { text: '1111010100100010000', options }
  const http = await (await c.request('/api/link/resolve', source)).json(), mcp = await c.tool('geo_link_resolve', source)
  assert.deepEqual(http.rows, mcp.structuredContent.rows)
  assert.equal(http.version, mcp.structuredContent.version)
  assert.equal(http.rows[0].output.code, '1111051500')
  assert.equal(http.rows[0].parcel, 'not_checked')
  const adminInput = { text: '1111051500', options: { inputType: 'administrative', target: 'address', output: 'name' } }
  const admin = await (await c.request('/api/link/resolve', adminInput)).json()
  assert.equal(admin.rows[0].output.name, '서울특별시 종로구 청운효자동')
  assert.equal(admin.rows[0].codeSystem, 'administrative_region')
  const linked = await (await c.request('/api/link/resolve', { text: '1168010100100010000', options })).json()
  assert.equal(linked.rows[0].status, 'needs_selection')
  assert.equal(linked.rows[0].candidates.length, 2)
  const selected = await (await c.request('/api/link/resolve', { text: '1168010100100010000', options: { ...options, selections: { '입력:1': linked.rows[0].candidates[0].id } } })).json()
  assert.equal(selected.rows[0].status, 'ok')
  assert.equal(selected.rows[0].output.code, linked.rows[0].candidates[0].code)
  assert.equal(selected.rows[0].parcel, 'not_checked')
  const regions = await (await c.request('/api/link/regions?codeSystem=administrative_region&query=청운효자동')).json()
  assert.equal(regions.rows[0].code, '1111051500')
  const capabilities = await c.tool('geo_link_capabilities')
  assert.deepEqual(capabilities.structuredContent.inputTypes, ['pnu_legal', 'administrative', 'address', 'location'])
  assert.equal(capabilities.structuredContent.administrative.codeLength, 10)
})

test('순수 위치 변환의 HTTP·MCP 계약과 조회 한도는 외부 원천 없이 일치한다', async () => {
  const c = client(), source = { text: '1000000, 2000000', options: { inputType: 'location', target: 'location', sourceCrs: 'EPSG:5179', outputCrs: 'EPSG:4326' } }
  const response = await c.request('/api/link/resolve', source)
  assert.equal(response.status, 200)
  const http = await response.json(), mcp = await c.tool('geo_link_resolve', source)
  assert.equal(mcp.isError, undefined)
  assert.equal(http.version, 'proj4-2.22.0')
  assert.equal(mcp.structuredContent.version, http.version)
  assert.deepEqual(mcp.structuredContent.rows, http.rows)
  assert.equal(http.rows[0].output.code, '127.50000000, 38.00000000')
  assert.equal(http.rows[0].parcel, 'not_checked')
  const invalid = await (await c.request('/api/link/resolve', { ...source, text: 'NaN, 2000000' })).json()
  assert.equal(invalid.rows[0].status, 'invalid')
  assert.deepEqual(invalid.rows[0].output, {})
  assert.equal((await c.request('/api/link/resolve', { ...source, text: Array(21).fill(source.text).join('\n') })).status, 413)
})

test('전체 결과는 HTTP·MCP에서 같은 항목별 상태를 반환하고 기존 파일 작업과 구분한다', async () => {
  const c = client(), source = { text: 'invalid\n\ninvalid', options: { inputType: 'pnu_legal', target: 'all', conversionSelections: {} } }
  const response = await c.request('/api/link/resolve', source)
  assert.equal(response.status, 200)
  const http = await response.json(), mcp = await c.tool('geo_link_resolve', source)
  assert.equal(mcp.isError, undefined)
  assert.equal(http.options.target, 'all')
  assert.equal(http.version, mcp.structuredContent.version)
  assert.deepEqual(http.rows, mcp.structuredContent.rows)
  assert.equal(http.rows.length, 3)
  for (const row of http.rows) {
    assert.deepEqual(Object.keys(row.conversions), ['address', 'pnu', 'legal_region', 'administrative_region', 'location'])
    assert.equal(row.parcel, 'not_checked')
    assert.ok(Object.values(row.conversions).every((result: any) => result.status !== 'ok' && result.errors.length))
  }
  assert.equal((await c.request('/api/link/resolve', { ...source, text: Array(21).fill('invalid').join('\n') })).status, 413)
  const job = await c.request('/api/link/jobs', source)
  assert.equal(job.status, 400)
  const capabilities = await c.tool('geo_link_capabilities')
  assert.equal(capabilities.structuredContent.allResultsMaxRows, 20)
})

test('기준자료 상태·업데이트와 경계 출력은 요청 경계를 검사한다', async () => {
  const c = client(), response = await c.request('/api/link/references')
  assert.equal(response.status, 200)
  const status = await response.json()
  assert.equal(status.timeZone, 'Asia/Seoul')
  assert.equal(status.sources.length, 2)
  assert.ok(status.sources.every((source: any) => source.version && 'sourceDate' in source && 'checkedAt' in source && 'activatedAt' in source))
  // 공개 요청에서 강제 갱신을 허용하지 않아 당일 적용 제한을 우회할 수 없다.
  assert.equal((await c.request('/api/link/references/update', { force: true })).status, 400)
  assert.equal((await c.request('/api/link/references/update', {}, { Origin: 'https://attacker.invalid' })).status, 403)
  for (const body of [{ codes: ['../secret'] }, { codes: [] }, { codes: ['1111010100'], crs: 'EPSG:5179' }]) assert.equal((await c.request('/api/link/boundary', body)).status, 400)
  assert.equal((await c.request('/api/link/boundary', { codes: ['1111010100'] }, { Origin: 'https://attacker.invalid' })).status, 403)
})

test('HTTP 업로드 실제 파일·매핑·원본 유지와 입력 경계 차단', async () => {
  const c = client(), csv = 'PNU,비고\r\n1111010100100010000,"개행\n그대로"\r\n,빈 값\r\n1111010100100010000,중복\r\n'
  const form = new FormData(); form.append('file', new Blob([csv]), 'source.csv')
  const response = await c.request('/api/link/stage', form), staged = await response.json()
  assert.equal(response.status, 200); assert.equal(staged.totalRows, 3); assert.equal(staged.preview[0][1], '개행\n그대로')
  const job = await (await c.request('/api/link/jobs', { uploadId: staged.uploadId, column: 0 })).json(), result = await completed(c, job.id)
  assert.equal(result.result.rows.length, 3)
  assert.equal(result.result.rows[1].value, '')
  assert.equal(result.result.rows[2].value, result.result.rows[0].value)
  assert.equal((await c.request('/api/link/resolve', { path: 'C:/private.csv' })).status, 400)
  assert.equal((await c.request('/api/link/resolve', { url: 'http://127.0.0.1/' })).status, 400)
  assert.equal((await c.request('/api/link/resolve', { text: 'x' }, { Origin: 'https://attacker.invalid' })).status, 403)
  assert.equal((await c.request('/api/link/resolve', { text: 'x', options: { level: 'invalid' } })).status, 400)
  assert.equal((await c.request('/api/link/resolve', { text: Array(201).fill('x').join('\n') })).status, 413)
  const huge = new FormData(); huge.append('file', new Blob([new Uint8Array(20 * 1024 ** 2 + 1)]), 'large.csv')
  assert.equal((await c.request('/api/link/stage', huge)).status, 413)
})
