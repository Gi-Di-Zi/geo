import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { chromium, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js'
import { EXTENSION_ID } from '@modelcontextprotocol/ext-apps/server'
import { build } from 'esbuild'
import { z } from 'zod'
import { tools } from '../../shared/catalog/tools.ts'
import geojsonSpec from '../../shared/catalog/vector-2d/geojson.ts'
import { zipList } from '../../shared/sniff.ts'
import type { HostObservation } from './mcp-app-host.ts'

// 실제 변환 worker가 있는 실행 서버를 대상으로 한다. SDK·도구·변환 결과를 mock하지 않는다.
const base = process.env.MCP_TEST_URL || process.env.VIZ_TEST_URL || 'http://localhost:3000'

const product = z.object({ id: z.string(), kind: z.string(), label: z.string() })

const candidate = z.object({
  method: z.string(),
  way: z.enum(['file', 'service']),
  fit: z.enum(['recommended', 'alternative', 'limited', 'unsupported']),
  primary: product.nullable(),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
})

const recommendation = z.object({
  format: z.string(),
  intent: z.object({ viewer: z.string().nullable(), priority: z.string(), output: z.string().nullable(), delivery: z.enum(['file', 'service']) }),
  service: z.object({ enabled: z.boolean(), hours: z.number() }),
  recommended: candidate.nullable(),
  candidates: z.array(candidate),
  conflict: z.string().nullable(),
  needs: z.array(z.string()),
})

const check = z.object({ ok: z.boolean(), checked: z.array(z.string()), problems: z.array(z.string()), files: z.number(), bytes: z.number() })

const output = z.object({
  id: z.string(),
  kind: z.string(),
  url: z.url(),
  primary: z.boolean(),
  service: z.boolean(),
  available: z.boolean(),
  download: z.url().optional(),
  zip: z.boolean().optional(),
  check: check.optional(),
})

const job = z.object({
  job: z.uuid(),
  state: z.enum(['running', 'done', 'failed']),
  error: z.string().optional(),
  format: z.string(),
  view: z.url(),
  method: z.object({ id: z.string(), way: z.enum(['file', 'server']) }),
  delivery: z.enum(['file', 'service']),
  intent: z.object({ viewer: z.string().optional(), priority: z.string(), recommended: z.string().optional(), primary: z.string().optional() }).nullable(),
  service: z.object({ layer: z.string(), status: z.string(), publishedAt: z.string().nullable(), expiresAt: z.string().nullable(), remainingSec: z.number() }).nullable(),
  primary: output.nullable(),
  outputs: z.array(output),
  usages: z.array(z.object({ viewer: z.string(), api: z.string(), code: z.string(), hosting: z.string() })),
  problems: z.array(z.string()),
})

const featureCollection = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({
    type: z.literal('Feature'),
    properties: z.object({ name: z.string() }),
    geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }),
  })),
})

const input = featureCollection.parse({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'MCP bridge point A' }, geometry: { type: 'Point', coordinates: [126.9784, 37.5666] } },
    { type: 'Feature', properties: { name: 'MCP bridge point B' }, geometry: { type: 'Point', coordinates: [126.982, 37.568] } },
  ],
})

/** 서비스 발행이 허용된 서버인지 (공개 배포는 이 경로가 막혀 있음 → 미허용) */
const capabilities = z.object({ service: z.boolean() })
const serviceAllowed = await fetch(base + '/api/jobs/capabilities').then(async r => (r.ok ? capabilities.parse(await r.json()).service : false), () => false)

/** 앞 시험의 파일 결과: 서비스 만료·정리 뒤에도 그대로인지 본다 */
let fileJob: z.infer<typeof job> | undefined

function isTcpAddress(address: ReturnType<ReturnType<typeof createServer>['address']>): address is AddressInfo {
  return address !== null && typeof address !== 'string'
}

async function connect() {
  const client = new Client({ name: 'geo-mcp-app-test', version: '1.0.0' }, { capabilities: { extensions: { [EXTENSION_ID]: {} } } })

  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')))

  return client
}

async function call(client: Client, name: string, args: Record<string, string>) {
  return CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
}

const textOf = (r: z.infer<typeof CallToolResultSchema>) => r.content.map(c => (c.type === 'text' ? c.text : '')).join('\n')

/** 화면 없이 파일 맡기기 (MCP Apps가 없는 클라이언트가 웹·다른 경로로 맡긴 것과 같은 /api/stage) */
async function stage(name: string, body: string) {
  const form = new FormData()

  form.append('file', new Blob([body], { type: 'application/geo+json' }), name)
  const r = await fetch(base + '/api/stage', { method: 'POST', body: form })

  assert.equal(r.status, 200)

  return z.object({ stage: z.uuid() }).parse(await r.json()).stage
}

async function finish(client: Client, id: string, timeout = 240_000) {
  const until = Date.now() + timeout

  for (;;) {
    const info = job.parse((await call(client, 'geo_status', { job: id })).structuredContent)

    if (info.state !== 'running') return info

    if (Date.now() > until) throw new Error(`작업 ${id} 시간 초과`)
    await new Promise(r => setTimeout(r, 1000))
  }
}

/** zip 항목 하나 풀기 (저장·deflate만, 시험 결과 확인용) */
async function zipEntry(bytes: Buffer, at: number, size: number, method: number) {
  const data = bytes.subarray(at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28))

  return method === 8 ? inflateRawSync(data.subarray(0, size)) : data.subarray(0, size)
}

test('공식 MCP Apps bridge: AI가 고른 뷰어로 열리고, 사용자가 바꾼 뷰어가 추천·변환 인자·결과에 반영된다', { timeout: 240_000 }, async t => {
  const client = await connect()

  t.after(() => client.close())
  assert.equal(client.getServerVersion()?.name, 'geo-web-bridge')
  const names = (await client.listTools()).tools.map(tool => tool.name)

  for (const name of ['geo_identify', 'geo_recommend', 'geo_convert', 'geo_status', 'geo_formats']) assert.ok(names.includes(name), name)
  const resource = await client.readResource({ uri: 'ui://geo/app.html' })
  const htmlResource = resource.contents.find(content => content.uri === 'ui://geo/app.html')

  assert.ok(htmlResource && 'text' in htmlResource)
  assert.match(htmlResource.text, /globalThis\.McpApps/)
  assert.ok(!htmlResource.text.includes('__MCP_APPS_SDK__'))
  // 모델이 "CesiumJS에서 쓸 수 있게"를 읽어 viewer=cesium으로 화면을 연다
  const opened = { viewer: 'cesium' }
  const initial = await call(client, 'geo_identify', opened)

  assert.notEqual(initial.isError, true)
  assert.equal(z.object({ intent: z.object({ viewer: z.string() }) }).parse(initial.structuredContent).intent.viewer, 'cesium')
  const calls: CallToolRequest['params'][] = []
  const progress: z.infer<typeof job>[] = []

  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./mcp-app-host.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
  })

  const hostScript = bundle.outputFiles[0]

  assert.ok(hostScript)

  const server = createServer((request, response) => {
    if (request.url === '/host.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' })
      response.end(hostScript.text)

      return
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html><head><title>Official MCP Apps bridge compatibility test</title></head><body><script type="module" src="/host.js"></script></body></html>')
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const address = server.address()

  assert.ok(isTcpAddress(address))

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.VIZ_BROWSER_PATH || '/opt/google/chrome/chrome',
  })

  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errors: string[] = []
  const dataResponses: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  page.on('response', response => {
    if (response.ok() && response.url().includes('/api/jobs/') && response.url().includes('/files/')) {
      dataResponses.push(response.url())
    }
  })

  await page.exposeFunction('geoMcpCallTool', async (params: CallToolRequest['params']) => {
    calls.push(params)
    const result = CallToolResultSchema.parse(await client.callTool(params))

    if (params.name === 'geo_convert' || params.name === 'geo_status') progress.push(job.parse(result.structuredContent))

    return result
  })

  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.waitForFunction(() => Boolean(window.geoMcpHost))
  await page.evaluate(({ html, result, args }) => window.geoMcpHost.mount(html, result, args), { html: htmlResource.text, result: initial, args: opened })
  const app = page.frameLocator('#geo-mcp-app')
  await expect(app.getByRole('heading', { name: '공간 데이터 올리기' })).toBeVisible()
  // AI가 전달한 대상 라이브러리가 화면에 미리 선택돼 있다
  await expect(app.getByRole('radio', { name: /^CesiumJS/ })).toHaveAttribute('aria-checked', 'true')
  await app.locator('input[type=file]').setInputFiles({ name: 'mcp-bridge.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(input)) })
  const card = app.getByRole('region', { name: '추천' })
  await expect(card).toContainText('CesiumJS에서 쓸 주력 결과물', { timeout: 30_000 })
  await expect(card).toContainText('GeoJSON')
  // 사용자가 화면에서 MapLibre로 바꾼다 → 서버 추천 다시
  await app.getByRole('radio', { name: /^MapLibre GL JS/ }).click()
  await expect(card).toContainText('MapLibre GL JS에서 쓸 주력 결과물', { timeout: 30_000 })
  const asked = calls.filter(c => c.name === 'geo_recommend').at(-1)

  assert.equal(asked?.arguments?.viewer, 'maplibre')
  await app.getByRole('button', { name: '변환 시작', exact: true }).click()
  await expect.poll(() => progress.at(-1)?.state ?? 'waiting', { timeout: 120_000 }).toMatch(/^(done|failed)$/)
  const convertArgs = calls.find(c => c.name === 'geo_convert')?.arguments

  assert.equal(convertArgs?.viewer, 'maplibre')
  assert.equal(convertArgs?.priority, 'balanced')
  const done = progress.at(-1)

  assert.ok(done)
  assert.equal(done.state, 'done', done.error)
  assert.equal(done.intent?.viewer, 'maplibre')
  assert.equal(done.intent?.recommended, convertArgs?.method)
  assert.deepEqual(done.problems, [])
  assert.equal(done.primary?.kind, 'geojson')
  assert.equal(done.primary?.check?.ok, true)
  assert.equal(done.usages[0]?.viewer, 'maplibre')
  assert.match(done.usages[0]?.code ?? '', /maplibregl/)
  assert.match(done.view, /viewer=maplibre/)
  await expect(app.getByRole('heading', { name: 'mcp-bridge.geojson — 완료', exact: true })).toBeVisible()
  await expect(app.getByRole('heading', { name: 'MapLibre GL JS에서 쓸 주력 결과물' })).toBeVisible()
  await expect(app.locator('main')).not.toContainText(/24시간|이후 지워짐/)
  assert.equal(done.format, 'vector-2d/geojson')
  assert.equal(done.method.way, 'file')
  assert.ok(progress.some(sample => sample.state === 'running'))
  const backendResponse = await fetch(done.primary?.url ?? '')

  assert.equal(backendResponse.status, 200)
  assert.deepEqual(featureCollection.parse(await backendResponse.json()).features, input.features)
  const map = app.frameLocator('iframe[title="결과 지도"]')
  await expect(map.locator('.stage')).toBeVisible()
  await expect(map.locator('.tile:visible canvas').first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => dataResponses.some(url => url.includes(done.job)), { timeout: 30_000 }).toBe(true)
  await expect(map.locator('.tile .error:visible')).toHaveCount(0)
  const downloaded = page.waitForEvent('download')
  await app.getByRole('button', { name: '내려받기', exact: true }).click()
  const download = await downloaded

  assert.equal(await download.failure(), null)
  const downloadedPath = await download.path()

  assert.ok(downloadedPath)
  const downloadedBytes = await readFile(downloadedPath)
  const exported = featureCollection.parse(JSON.parse(downloadedBytes.toString('utf8')))

  assert.deepEqual(exported.features, input.features)
  assert.match(download.suggestedFilename(), /\.geojson$/)
  const observation: HostObservation = await page.evaluate(() => window.geoMcpHost.observation)

  assert.ok(observation.initialized)
  assert.ok(observation.contextUpdates > 0)
  assert.equal(observation.downloads.length, 1)
  assert.equal(observation.downloads[0]?.bytes, downloadedBytes.length)
  assert.deepEqual(errors, [])

  const proof = {
    base,
    host: 'installed official AppBridge + PostMessageTransport',
    realVendorAccountConnection: false,
    initializedServer: client.getServerVersion(),
    tools: names,
    resource: htmlResource.uri,
    openedWith: opened,
    convertArgs,
    actualJob: done,
    progressStates: progress.map(sample => sample.state),
    toolCalls: calls.map(c => c.name),
    observation,
    downloadedBytes: downloadedBytes.length,
    realMapDataResponses: dataResponses,
  }

  const evidenceDir = process.env.MCP_TEST_EVIDENCE_DIR

  if (evidenceDir) {
    const proofDir = join(evidenceDir, done.job)

    await mkdir(proofDir, { recursive: true })
    await writeFile(join(proofDir, 'mcp-app-proof.json'), JSON.stringify(proof, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    await writeFile(join(proofDir, 'mcp-app-result.geojson'), downloadedBytes, { mode: 0o600, flag: 'wx' })
    await page.screenshot({ path: join(proofDir, 'mcp-app-completed.png'), fullPage: true })
  }

  t.diagnostic(JSON.stringify({ actualJob: done.job, view: done.view, officialBridgePassed: true }))
})

test('MCP Apps 없는 클라이언트: geo_identify → geo_recommend → geo_convert → geo_status만으로 추천·검증·결과', { timeout: 240_000 }, async t => {
  const client = await connect()

  t.after(() => client.close())
  const id = await stage('plain-client.geojson', JSON.stringify(input))
  // 결과 형식만 말한 경우: 뷰어를 묻지 않고 PMTiles 방식
  const pm = await call(client, 'geo_identify', { stage: id, outputKind: 'pmtiles' })
  const pmRec = recommendation.parse(z.object({ recommendation: z.unknown() }).parse(pm.structuredContent).recommendation)

  assert.equal(pmRec.recommended?.method, 'tippecanoe')
  assert.ok(!pmRec.needs.some(n => n.includes('대상 라이브러리')))
  assert.match(textOf(pm), /추천: tippecanoe/)
  const cesium = recommendation.parse((await call(client, 'geo_recommend', { stage: id, viewer: 'cesium' })).structuredContent)

  assert.equal(cesium.recommended?.primary?.kind, 'geojson')
  const conflict = recommendation.parse((await call(client, 'geo_recommend', { stage: id, viewer: 'cesium', outputKind: 'pmtiles' })).structuredContent)

  assert.equal(conflict.recommended, null)
  assert.match(conflict.conflict ?? '', /PMTiles 미지원/)
  const svc = recommendation.parse((await call(client, 'geo_recommend', { stage: id, delivery: 'service' })).structuredContent)

  if (serviceAllowed) assert.equal(svc.recommended?.way, 'service')
  else {
    assert.equal(svc.recommended, null)
    assert.match(svc.conflict ?? '', /서비스 발행을 제공하지 않음/)
  }

  // 서버 재검증: 클라이언트가 보낸 method라도 뷰어·형식 조건에 맞지 않으면 시작하지 않는다
  const rejected = await call(client, 'geo_convert', { stage: id, format: 'vector-2d/geojson', method: 'tippecanoe', viewer: 'cesium', outputKind: 'pmtiles' })

  assert.equal(rejected.isError, true)
  // 예전 호출 방식 그대로(method 직접 지정) + 대상 뷰어
  const started = await call(client, 'geo_convert', { stage: id, format: 'vector-2d/geojson', method: 'gdal', viewer: 'ol' })

  assert.notEqual(started.isError, true, textOf(started))
  const done = await finish(client, job.parse(started.structuredContent).job)

  assert.equal(done.state, 'done', done.error)
  assert.equal(done.method.id, 'gdal')
  assert.equal(done.usages[0]?.viewer, 'ol')
  assert.ok(done.primary)
  const text = textOf(await call(client, 'geo_status', { job: done.job }))

  assert.match(text, /주력 결과물/)
  assert.match(text, /OpenLayers 적용/)
  assert.match(text, /내려받기/)
  assert.match(text, /결과 파일 검사: 통과/)
  // 여러 파일 결과(MVT 타일 폴더) zip: 서버 검사의 파일 수 그대로, 안의 JSON에 geo 서버 주소 없음
  const mvt = done.outputs.find(o => o.kind === 'mvt')

  assert.ok(mvt?.download && mvt.zip && mvt.check?.ok, JSON.stringify(mvt?.check))
  const zipBytes = Buffer.from(await (await fetch(mvt.download)).arrayBuffer())
  const entries = (await zipList(new Blob([zipBytes]))) ?? []
  const files = entries.filter(e => !e.name.endsWith('/'))

  assert.equal(files.length, mvt.check.files)
  assert.ok(files.some(e => /\/\d+\/\d+\/\d+\.pbf$/.test(e.name)))

  for (const e of files.filter(f => f.name.endsWith('.json'))) {
    const body = (await zipEntry(zipBytes, e.at, e.size, e.method)).toString('utf8')

    assert.ok(!body.includes(base) && !body.includes('/api/jobs/'), `${e.name}에 geo 서버 주소`)
  }

  fileJob = done
})

test('서비스 방식: 발행 시각·만료 시각 기록, 만료 전 접근, 만료 뒤 410, 리소스 정리, 다른 결과 보존', { timeout: 600_000, skip: !serviceAllowed && '이 서버는 서비스 발행 미허용 (공개 배포) — 미지원 안내는 앞 시험에서 확인' }, async t => {
  const client = await connect()

  t.after(() => client.close())
  const ttl = Number(process.env.MCP_TEST_SERVICE_TTL_SEC || 172_800)
  const id = await stage('service-test.geojson', JSON.stringify(input))
  const started = await call(client, 'geo_convert', { stage: id, format: 'vector-2d/geojson', delivery: 'service', viewer: 'cesium' })

  assert.notEqual(started.isError, true, textOf(started))
  const done = await finish(client, job.parse(started.structuredContent).job)

  assert.equal(done.state, 'done', done.error)
  assert.equal(done.delivery, 'service')
  const s = done.service

  assert.ok(s?.publishedAt && s.expiresAt)
  assert.equal(s.status, 'active')
  assert.equal(Date.parse(s.expiresAt) - Date.parse(s.publishedAt), ttl * 1000)
  const ogc = done.outputs.find(o => o.service && o.kind === 'geojson')

  assert.ok(ogc?.available)
  const before = await fetch(ogc.url)

  assert.equal(before.status, 200)
  assert.equal(featureCollection.parse(await before.json()).features.length, input.features.length)
  assert.match(textOf(await call(client, 'geo_status', { job: done.job })), /만료/)

  if (ttl > 180) return t.diagnostic(`TTL ${ttl}초 — 만료 뒤 확인은 MCP_TEST_SERVICE_TTL_SEC로 줄인 시험 서버에서`)
  await new Promise(r => setTimeout(r, Date.parse(s.expiresAt ?? '') - Date.now() + 1500))
  const after = await fetch(ogc.url)

  assert.equal(after.status, 410)
  const expired = await finish(client, done.job)

  assert.notEqual(expired.service?.status, 'active')
  assert.ok(expired.outputs.filter(o => o.service).every(o => !o.available))
  assert.match(textOf(await call(client, 'geo_status', { job: done.job })), /이용 불가/)
  // 정리 작업(GEO_SERVICE_SWEEP_SEC 간격)이 이 작업의 레이어만 지운다
  await expect.poll(async () => (await finish(client, done.job)).service?.status, { timeout: 180_000, intervals: [2000] }).toBe('deleted')
  const layer = s.layer
  const geoserver = tools.find(x => x.id === 'geoserver')?.endpoint
  const direct = await fetch(`${geoserver}/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=${layer}&outputFormat=application/json&count=1`)

  assert.ok(!direct.ok || !(await direct.text()).includes('FeatureCollection'), 'GeoServer 레이어가 남음')
  const table = spawnSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'gis', '-tAc', `select to_regclass('public.${layer}')`], { encoding: 'utf8' })

  assert.equal(table.status, 0, table.stderr)
  assert.equal(table.stdout.trim(), '', 'PostGIS 표가 남음')
  // 샘플 서비스는 그대로
  const sample = geojsonSpec.recipes.find(r => r.id === 'geoserver')?.outputs.find(o => o.id === 'wfs')

  assert.ok(sample)
  assert.equal((await fetch(base + sample.path)).status, 200)

  // 파일 결과(앞 시험)는 서비스 만료·정리와 무관하게 그대로 내려받힌다
  if (fileJob?.primary?.download) assert.equal((await fetch(fileJob.primary.download)).status, 200)
})
