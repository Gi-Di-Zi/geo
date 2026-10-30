import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { resolveAllRows } from '../../server/services/link/all.ts'
import { getReference } from '../../server/services/link/reference.ts'
import { getAdministrativeReference } from '../../server/services/link/administrative-reference.ts'

// 실제 AI 호스트가 아닌, 설치 SDK·리소스를 사용하는 모의 호스트다.
test('MCP 앱은 모든 결과를 함께 보이고 결과 좌표계·SHP를 나중에 선택한다', { timeout: 60000 }, async t => {
  const base = process.env.LINK_TEST_URL || 'http://localhost:3017'
  let cookie = '', id = 0, rejectLink = false, optionalCapabilities = true, boundaryFails = true, rejectDownload = false, downloads = 0, projectionFails = false
  const calls: string[] = [], opened: string[] = []
  const allRequests: any[] = [], projectionRequests: any[] = []
  let projectionPause: Promise<void> | undefined, releaseProjection: (() => void) | undefined, completedProjections = 0
  const legal = await getReference(), administrative = await getAdministrativeReference()
  const point = { x: 127.5, y: 38, lon: 127.5, lat: 38, crs: 'EPSG:4326' as const, source: 'MCP Apps 위치 테스트 fixture', sourceUrl: '', sourceDate: null, checkedAt: '2026-10-30T00:00:00Z', method: 'address_point' as const, warning: '테스트 원천 대표점' }
  const provider = { forwardLocation: async (_address: string, kind?: string) => ({ ...point, method: kind === 'region' ? 'region_representative' as const : 'address_point' as const }), reverseLocation: async () => ({ ...point, method: 'reverse_geocoded' as const, address: '서울특별시 종로구 청운동 1', parcelAddress: '서울특별시 종로구 청운동 1', roadAddress: '', addressType: 'parcel' as const, legalCode: '1111010100', administrativeCode: '1111051500' }) }
  const rpc = async (method: string, params: unknown) => {
    const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(cookie && { cookie }) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
    const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]!
    const body = await response.json(); if (body.error) throw new Error(body.error.message)
    return body.result
  }
  const resource = await rpc('resources/read', { uri: 'ui://geo/link.html' })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.exposeFunction('hostRequest', async (request: any) => {
    if (request.method === 'ui/initialize') return { protocolVersion: request.params.protocolVersion, hostInfo: { name: 'geo-link-test-host', version: '1' }, hostCapabilities: { serverTools: {}, ...(optionalCapabilities && { openLinks: {}, downloadFile: {} }) }, hostContext: { theme: 'light', displayMode: 'inline', locale: 'ko-KR' } }
    if (request.method === 'tools/call') {
      calls.push(request.params.name)
      if (request.params.name === 'geo_link_resolve') {
        const args = request.params.arguments
        if (args.options.target === 'location') {
          projectionRequests.push(args)
          assert.equal(args.options.inputType, 'location')
          if (projectionFails) return { isError: true, structuredContent: { error: { message: '좌표 변환 테스트 실패' } }, content: [] }
          if (projectionPause) await projectionPause
          const result = await rpc('tools/call', request.params)
          completedProjections++
          return result
        }
        assert.equal(args.options.target, 'all')
        assert.equal(args.options.outputCrs, 'EPSG:4326')
        allRequests.push(args)
        const batch = await resolveAllRows(args.text.split('\n').map((value: string, index: number) => ({ id: `입력:${index + 1}`, value, original: { 원문: value } })), args.options, legal, administrative, provider)
        return { content: [], structuredContent: { ...batch, rows: batch.rows.slice(0, 10) }, _meta: { linkResult: batch } }
      }
      if (request.params.name === 'geo_link_boundary') {
        if (boundaryFails) return { isError: true, structuredContent: { error: { message: '경계 원천 권한을 확인하세요.' } }, content: [] }
        return { content: [], structuredContent: { filename: 'fixture.zip' }, _meta: { resource: { type: 'resource', resource: { uri: 'geo-link://boundary/fixture.zip', mimeType: 'application/zip', blob: Buffer.from('504b0506000000000000000000000000000000000000', 'hex').toString('base64') } } } }
      }
      return rpc('tools/call', request.params)
    }
    if (request.method === 'ui/open-link') { opened.push(request.params.url); return { isError: rejectLink } }
    if (request.method === 'ui/download-file') { downloads++; return { isError: rejectDownload } }
    return {}
  })
  await page.setContent('<!doctype html><html><body><iframe id="app" style="width:100%;height:1400px"></iframe></body></html>')
  await page.evaluate(() => {
    window.addEventListener('message', async event => {
      if (event.source !== (document.getElementById('app') as HTMLIFrameElement).contentWindow || event.data?.id === undefined) return
      const request = event.data
      try { const result = await (window as any).hostRequest(request); (event.source as Window).postMessage({ jsonrpc: '2.0', id: request.id, result }, '*') }
      catch { (event.source as Window).postMessage({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: '테스트 호스트 도구 실패' } }, '*') }
    })
  })
  await page.locator('#app').evaluate((element, html) => { (element as HTMLIFrameElement).srcdoc = html }, resource.contents[0].text)
  const frame = page.frameLocator('#app')
  const first = frame.locator('.result').first()
  await expect(frame.locator('#reference')).toContainText('code-go-kr-')
  await expect(frame.locator('[name="type"]:checked')).toHaveCount(0)
  await expect(frame.locator('[name="type"]')).toHaveCount(4)
  await expect(frame.getByRole('button', { name: '변환', exact: true })).toBeDisabled()
  await expect(frame.locator('input[type="file"],#output,#unit,#output-crs')).toHaveCount(0)
  await expect(frame.getByLabel(/위치 결과 좌표계/)).toHaveCount(0)
  await frame.getByRole('button', { name: '기준 자료', exact: true }).click()
  await expect.poll(() => opened.at(-1)).toBe(`${base}/link/reference`)

  await frame.getByRole('radio', { name: 'PNU·법정동코드', exact: true }).check()
  await frame.getByLabel('PNU·법정동코드 입력', { exact: true }).fill('1111010100100010000\n1111010100100010000\ninvalid')
  await expect(frame.getByLabel(/위치 결과 좌표계/)).toHaveCount(0)
  await frame.getByRole('button', { name: '변환', exact: true }).click()
  await expect(frame.locator('#state')).toHaveText('3개 변환 결과')
  await expect(first.locator('dt')).toHaveText(['주소','PNU','법정동코드','행정동코드','위치'])
  await expect(first.locator('[data-result="address"]')).toContainText('서울특별시 종로구 청운동 1')
  await expect(first.locator('[data-result="pnu"]')).toContainText('1111010100100010000')
  await expect(first.locator('[data-result="legal_region"]')).toContainText('1111010100')
  await expect(first.locator('[data-result="legal_region"]')).toContainText('시군구 11110')
  await expect(first.locator('[data-result="administrative_region"]')).toContainText('1111051500')
  const location = first.locator('[data-result="location"]'), resultCrs = location.getByLabel(/위치 결과 좌표계/)
  await expect(location.locator('.location-value')).toHaveText('127.50000000, 38.00000000')
  await expect(resultCrs).toHaveValue('EPSG:4326')
  await resultCrs.selectOption('EPSG:5179')
  await expect(location.locator('.location-value')).toHaveText('1000000.000, 2000000.000')
  await expect(frame.locator('.result').nth(1).locator('[data-result="location"] .location-value')).toHaveText('127.50000000, 38.00000000')
  await expect(first.locator('[data-result="pnu"]')).toContainText('1111010100100010000')
  assert.equal(allRequests.length, 1)
  assert.equal(projectionRequests.length, 1)
  assert.equal(projectionRequests[0].text, '127.5, 38')
  assert.equal(projectionRequests[0].options.sourceCrs, 'EPSG:4326')
  await frame.locator('body').evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as any).__copied = value } } }) })
  await frame.getByRole('button', { name: '결과 복사', exact: true }).click()
  const copied = await frame.locator('body').evaluate(() => (window as any).__copied)
  assert.ok(copied.includes('1000000.000, 2000000.000\tEPSG:5179'))
  await resultCrs.selectOption('EPSG:4326')
  await expect(location.locator('.location-value')).toHaveText('127.50000000, 38.00000000')
  assert.equal(projectionRequests.length, 1)
  projectionFails = true
  await resultCrs.selectOption('EPSG:3857')
  await expect(location.getByRole('alert')).toHaveText('좌표 변환 테스트 실패')
  await expect(first.locator('[data-result="pnu"]')).toContainText('1111010100100010000')
  await resultCrs.selectOption('EPSG:4326')
  await expect(location.getByRole('alert')).toBeEmpty()
  await expect(location.locator('.location-value')).toHaveText('127.50000000, 38.00000000')
  projectionFails = false
  assert.equal(allRequests.length, 1)
  const completedBefore = completedProjections
  projectionPause = new Promise(resolve => { releaseProjection = resolve })
  await resultCrs.selectOption('EPSG:3857')
  await expect(resultCrs).toBeDisabled()
  await frame.getByLabel('PNU·법정동코드 입력', { exact: true }).fill('1111010100100010000')
  await expect(frame.locator('.result')).toHaveCount(0)
  releaseProjection!(); projectionPause = undefined
  await expect.poll(() => completedProjections).toBe(completedBefore + 1)
  await expect(frame.locator('.result')).toHaveCount(0)
  await frame.getByRole('button', { name: '변환', exact: true }).click()
  await expect(first.locator('[data-result="location"] .location-value')).toHaveText('127.50000000, 38.00000000')
  await expect(first.getByLabel(/위치 결과 좌표계/)).toHaveValue('EPSG:4326')
  assert.equal(calls.filter(name => name === 'geo_link_boundary').length, 0)
  const shp = first.getByRole('button', { name: /SHP 다운로드/ })
  await shp.click()
  await expect(frame.locator('#error')).toHaveText('경계 원천 권한을 확인하세요.')
  assert.equal(calls.filter(name => name === 'geo_link_boundary').length, 1)
  assert.equal(downloads, 0)
  await expect(first.locator('[data-result="pnu"]')).toContainText('1111010100100010000')
  boundaryFails = false; rejectDownload = true
  await shp.click()
  await expect(frame.locator('#error')).toHaveText('호스트가 파일 다운로드를 거절했습니다.')
  rejectDownload = false
  await shp.click()
  await expect(frame.locator('#state')).toHaveText('법정동 경계 SHP 다운로드를 요청했습니다.')
  assert.equal(downloads, 2)

  await frame.getByLabel('PNU·법정동코드 입력', { exact: true }).fill('11110')
  await frame.getByRole('button', { name: '변환', exact: true }).click()
  await expect(first.locator('[data-result="address"]')).toContainText('서울특별시 종로구')
  await expect(first.locator('[data-result="pnu"]')).toContainText('전체 PNU를 만들 수 없습니다')
  await frame.getByRole('radio', { name: '행정동코드', exact: true }).check()
  await frame.getByLabel('행정동코드 입력', { exact: true }).fill('1111051500')
  await frame.getByRole('button', { name: '변환', exact: true }).click()
  await expect(first.locator('[data-result="address"]')).toContainText('청운효자동')
  await expect(first.locator('[data-result="legal_region"] select')).toBeVisible()
  await first.locator('[data-result="legal_region"] select').selectOption('1111010100')
  await expect(first.locator('[data-result="legal_region"] select')).toHaveCount(0)
  await expect(first.locator('[data-result="legal_region"]')).toContainText('1111010100')

  await frame.getByRole('radio', { name: '주소', exact: true }).check()
  await frame.getByRole('button', { name: '주소 검색', exact: true }).click()
  await expect.poll(() => opened.at(-1)).toBe(`${base}/link?input=address&search=1`)
  await frame.getByLabel('주소 입력', { exact: true }).fill('중앙동 1')
  await frame.getByRole('button', { name: '변환', exact: true }).click()
  const candidates = first.locator('[data-result="legal_region"] select')
  await expect(candidates).toBeVisible()
  await candidates.selectOption({ index: 1 })
  await expect(candidates).toHaveCount(0)
  await expect(first.locator('[data-result="pnu"] dd')).toHaveText(/^\d{19}$/)

  await frame.getByRole('radio', { name: '위치 (EPSG + X·Y)', exact: true }).check()
  await frame.getByLabel('입력 좌표계', { exact: true }).selectOption('EPSG:5179')
  await frame.getByLabel('X (경도·동쪽값)', { exact: true }).fill('1000000')
  await expect(frame.getByRole('button', { name: '변환', exact: true })).toBeDisabled()
  await frame.getByLabel('Y (위도·북쪽값)', { exact: true }).fill('2000000')
  await expect(frame.getByLabel(/위치 결과 좌표계/)).toHaveCount(0)
  await frame.getByRole('button', { name: '변환', exact: true }).click()
  await expect(first.locator('[data-result="location"]')).toContainText('127.50000000, 38.00000000')
  await expect(first.locator('[data-result="administrative_region"]')).toContainText('1111051500')
  assert.equal(allRequests.at(-1).options.sourceCrs, 'EPSG:5179')
  await first.locator('[data-result="location"]').getByLabel(/위치 결과 좌표계/).selectOption('EPSG:5179')
  await expect(first.locator('[data-result="location"] .location-value')).toHaveText('1000000.000, 2000000.000')
  await expect(frame.getByLabel('입력 좌표계', { exact: true })).toHaveValue('EPSG:5179')

  await frame.getByRole('radio', { name: 'PNU·법정동코드', exact: true }).check()
  await frame.getByLabel('PNU·법정동코드 입력', { exact: true }).fill(Array(11).fill('1111010100100010000').join('\n'))
  await frame.getByRole('button', { name: '변환', exact: true }).click()
  await expect(frame.locator('.result')).toHaveCount(11)
  await frame.getByLabel('PNU·법정동코드 입력', { exact: true }).fill(Array(21).fill('1111010100100010000').join('\n'))
  await frame.getByRole('button', { name: '변환', exact: true }).click()
  await expect(frame.locator('#error')).toHaveText('한 번에 20개까지 입력하세요.')
  const beforeInvalid = calls.length
  await frame.getByLabel('PNU·법정동코드 입력', { exact: true }).fill('1111010100100010000\t메모')
  await frame.getByRole('button', { name: '변환', exact: true }).click()
  await expect(frame.locator('#error')).toContainText('한 줄에 값 하나씩')
  assert.equal(calls.length, beforeInvalid)
  rejectLink = true
  await frame.getByRole('button', { name: '웹에서 열기' }).click()
  await expect(frame.locator('#error')).toHaveText('호스트가 웹 열기를 거절했습니다.')

  optionalCapabilities = false
  await page.locator('#app').evaluate((element, html) => { (element as HTMLIFrameElement).srcdoc = html }, resource.contents[0].text)
  await expect(frame.locator('#reference')).toContainText('code-go-kr-')
  await frame.getByRole('button', { name: '웹에서 열기' }).click()
  await expect(frame.locator('#state')).toContainText('웹 열기가 미지원')
  await frame.getByRole('button', { name: '기준 자료', exact: true }).click()
  await expect(frame.locator('#state')).toContainText(`${base}/link/reference`)
  await frame.getByRole('radio', { name: 'PNU·법정동코드', exact: true }).check()
  await frame.getByLabel('PNU·법정동코드 입력', { exact: true }).fill('1111010100100010000')
  await frame.getByRole('button', { name: '변환', exact: true }).click()
  await expect(first.locator('[data-result="pnu"]')).toContainText('1111010100100010000')
  const beforeUnsupported = calls.filter(name => name === 'geo_link_boundary').length
  await first.getByRole('button', { name: /SHP 다운로드/ }).click()
  await expect(frame.locator('#state')).toContainText('파일 다운로드가 미지원')
  assert.equal(calls.filter(name => name === 'geo_link_boundary').length, beforeUnsupported)
  assert.ok(calls.every(name => ['geo_link_capabilities','geo_link_resolve','geo_link_boundary'].includes(name)))
})
