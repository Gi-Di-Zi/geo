import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js'
import { EXTENSION_ID } from '@modelcontextprotocol/ext-apps/server'
import { build } from 'esbuild'
import { z } from 'zod'
import type { HostObservation } from './mcp-app-host.ts'

// 실제 변환 worker가 있는 실행 서버를 대상으로 한다. SDK·도구·변환 결과를 mock하지 않는다.
const base = process.env.MCP_TEST_URL || process.env.VIZ_TEST_URL || 'http://localhost:3000'

const job = z.object({
  job: z.uuid(),
  state: z.enum(['running', 'done', 'failed']),
  error: z.string().optional(),
  format: z.string(),
  view: z.url(),
  method: z.object({ id: z.string(), way: z.enum(['file', 'server']) }),
  outputs: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    url: z.url(),
    download: z.url().optional(),
  })),
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

function isTcpAddress(address: ReturnType<ReturnType<typeof createServer>['address']>): address is AddressInfo {
  return address !== null && typeof address !== 'string'
}

test('공식 MCP Apps bridge로 실제 파일 판별·변환·지도·내려받기가 연결된다', { timeout: 180_000 }, async t => {
  const client = new Client({ name: 'geo-mcp-app-test', version: '1.0.0' }, {
    capabilities: { extensions: { [EXTENSION_ID]: {} } },
  })

  t.after(() => client.close())
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')))
  assert.equal(client.getServerVersion()?.name, 'geo-web')

  const tools = await client.listTools()
  const names = tools.tools.map(tool => tool.name)

  for (const name of ['geo_identify', 'geo_convert', 'geo_status', 'geo_formats']) assert.ok(names.includes(name), name)

  const resource = await client.readResource({ uri: 'ui://geo/app.html' })
  const htmlResource = resource.contents.find(content => content.uri === 'ui://geo/app.html')
  assert.ok(htmlResource && 'text' in htmlResource)
  assert.match(htmlResource.text, /globalThis\.McpApps/)
  assert.ok(!htmlResource.text.includes('__MCP_APPS_SDK__'))

  const initial = CallToolResultSchema.parse(await client.callTool({ name: 'geo_identify', arguments: {} }))
  assert.notEqual(initial.isError, true)
  const toolCalls: string[] = []
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
    toolCalls.push(params.name)
    const result = CallToolResultSchema.parse(await client.callTool(params))

    if (params.name === 'geo_convert' || params.name === 'geo_status') progress.push(job.parse(result.structuredContent))

    return result
  })

  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.waitForFunction(() => Boolean(window.geoMcpHost))
  await page.evaluate(({ html, result }) => window.geoMcpHost.mount(html, result), { html: htmlResource.text, result: initial })
  const app = page.frameLocator('#geo-mcp-app')
  await expect(app.getByRole('heading', { name: '공간 데이터 올리기' })).toBeVisible()
  await app.locator('input[type=file]').setInputFiles({ name: 'mcp-bridge.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(input)) })
  await expect(app.getByRole('radiogroup', { name: '형식', exact: true })).toBeVisible({ timeout: 30_000 })
  await app.getByRole('radio', { name: /2D 벡터.*GeoJSON/ }).click()
  await app.getByRole('button', { name: /^GDAL/ }).click()
  await app.getByRole('button', { name: '변환 시작', exact: true }).click()
  await expect.poll(() => progress.at(-1)?.state ?? 'waiting', { timeout: 120_000 }).toMatch(/^(done|failed)$/)

  const done = progress.at(-1)
  assert.ok(done)
  assert.equal(done.state, 'done', done.error)
  await expect(app.getByRole('heading', { name: 'mcp-bridge.geojson — 완료', exact: true })).toBeVisible()
  await expect(app.locator('main')).not.toContainText(/24시간|이후 지워짐/)
  assert.equal(done.format, 'vector-2d/geojson')
  assert.equal(done.method.id, 'gdal')
  assert.equal(done.method.way, 'file')
  assert.ok(toolCalls.includes('geo_convert'))
  assert.ok(toolCalls.includes('geo_status'))
  assert.ok(progress.some(sample => sample.state === 'running'))

  const output = done.outputs.find(candidate => candidate.kind === 'geojson')
  assert.ok(output && output.download)
  const backendResponse = await fetch(output.url)
  assert.equal(backendResponse.status, 200)
  const converted = featureCollection.parse(await backendResponse.json())
  assert.deepEqual(converted.features, input.features)

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
    actualJob: done,
    progressStates: progress.map(sample => sample.state),
    toolCalls,
    observation,
    downloadedBytes: downloadedBytes.length,
    realMapDataResponses: dataResponses,
    actualDataAndDownloadMatched: true,
    originalsAndResultsPreserved: true,
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
