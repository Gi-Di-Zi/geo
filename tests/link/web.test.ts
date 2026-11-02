import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const baseURL = process.env.LINK_TEST_URL || 'http://localhost:3017'
const evidence = resolve('.data/link/test-evidence')
const postcodeScript = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
async function openTool(page: Page) {
  const response = await page.goto(`${baseURL}/link`)
  assert.equal(response?.status(), 200)
  await page.waitForFunction(() => (document.getElementById('__nuxt') as any)?.__vue_app__?.$nuxt?.isHydrating === false)
  await expect(page.getByRole('textbox', { name: '주소·코드 입력', exact: true })).toBeEnabled()
}
const conversion = (value: string, more: object = {}) => ({ status: 'ok', value, errors: [], warnings: [], candidates: [], evidence: ['웹 흐름 테스트 fixture'], ...more })
function fixtureResult(body: any) {
  const inputs = body.rows || body.text.split(/\r?\n/).map((value: string, index: number) => ({ id: '입력:' + (index + 1), value, original: { 원문: value } }))
  const rows = inputs.map((input: any) => {
    const type = body.options.inputType !== 'auto' ? body.options.inputType : /^\d{19}$/.test(input.value) ? 'pnu' : input.value === '1111051500' ? 'administrative' : /^\d{5}$/.test(input.value) && input.value !== '11110' ? 'postcode' : /^\d+$/.test(input.value) ? 'code' : 'address'
    const noParcel = type === 'code' || type === 'administrative'
    const known = /^\d{10,19}$/.test(input.value) || /청운동|사직로|중앙동/.test(input.value) || type === 'location'
    const selected = body.options.selections?.[input.id], ambiguous = input.value === '중앙동 1' && !selected
    const mountain = input.value.includes('산') || input.value.startsWith('11110101002')
    const address = type === 'administrative' ? '서울특별시 종로구 청운효자동' : '서울특별시 종로구 청운동 ' + (mountain ? '산 1-1' : '1')
    const pnu = mountain ? '1111010100200010001' : '1111010100100010000'
    const adminSelection = body.options.conversionSelections?.administrative_region?.[input.id]
    const adminCandidates = input.value.startsWith('116801') && !adminSelection
    const legalCandidates = [{ id: '1111010100', code: '1111010100', name: '서울특별시 종로구 청운동', status: 'active', level: 'eupmyeondong' }]
    const values: any = {
      address: conversion(address), pnu: conversion(noParcel ? '' : pnu, noParcel ? { status: 'unavailable', errors: [{ code: 'PARCEL_REQUIRED', message: '지번이 없어 전체 PNU를 만들 수 없습니다.' }] } : {}),
      legal_region: conversion('1111010100', { code: '1111010100', name: '서울특별시 종로구 청운동' }),
      administrative_region: conversion(adminSelection ? '1168064000' : '1111051500', { code: adminSelection ? '1168064000' : '1111051500', name: adminSelection ? '서울특별시 강남구 역삼1동' : '서울특별시 종로구 청운효자동' }),
      postcode: conversion('03046'),
      location: conversion(type === 'location' ? '127.50000000, 38.00000000' : '126.97000000, 37.58000000', { warnings: ['원천의 대표 위치이며 필지 중심점은 아닙니다.'] }),
    }
    if (!known) for (const key of Object.keys(values)) values[key] = conversion('', { status: 'invalid', errors: [{ code: input.value ? 'INVALID_INPUT' : 'EMPTY_INPUT', message: input.value ? '입력 형식을 확인하세요.' : '빈 입력입니다.' }] })
    if (ambiguous) for (const key of Object.keys(values)) values[key] = conversion('', { status: 'needs_selection', candidates: legalCandidates, errors: [{ code: 'AMBIGUOUS_REGION', message: '지역 후보를 선택하세요.' }] })
    if (adminCandidates) values.administrative_region = conversion('', { status: 'needs_selection', candidates: [{ id: '1168010100|1168064000', code: '1168064000', name: '서울특별시 강남구 역삼1동', status: 'active', level: 'eupmyeondong' }, { id: '1168010100|1168065000', code: '1168065000', name: '서울특별시 강남구 역삼2동', status: 'active', level: 'eupmyeondong' }], errors: [{ code: 'AMBIGUOUS_ADMINISTRATIVE_REGION', message: '행정동 관할 후보를 선택하세요.' }] })
    return { id: input.id, inputId: input.id, value: input.value, original: input.original, inputType: type, codeSystem: 'pnu', status: known ? ambiguous || adminCandidates ? 'needs_selection' : 'ok' : 'invalid', format: known ? 'valid' : 'invalid', code: known ? 'active' : 'not_checked', parcel: 'not_checked', errors: [], warnings: [], candidates: [], unparsed: '', pnu: known && !noParcel ? pnu : '', regionCode: known && !ambiguous ? '1111010100' : '', address: known && !ambiguous ? address : '', evidence: [], conversions: values,
      output: known && !ambiguous ? { address, pnu: noParcel ? '' : pnu, legal_code: '1111010100', legal_name: '서울특별시 종로구 청운동', administrative_code: '1111051500', administrative_name: '서울특별시 종로구 청운효자동', sido_code: '11', sido_name: '서울특별시', sigungu_code: '11110', sigungu_name: '종로구', eupmyeondong_code: '1111010100', eupmyeondong_name: '청운동', ri_code: '', ri_name: '', location: values.location.value, x: type === 'location' ? '127.5' : '126.97', y: type === 'location' ? '38' : '37.58', crs: body.options.outputCrs || 'EPSG:4326', location_method: 'address_point' } : {} }
  })
  return { schemaVersion: '1', ruleVersion: 'geo-link-v1', version: 'web-all-fixture', reference: { version: 'web-all-fixture', available: true, source: '웹 흐름 fixture', sourceUrl: '', sourceDate: null, checkedAt: null, activatedAt: null, coverage: 'fixture', count: 1 }, options: body.options, rows, errors: {}, summary: { total: rows.length, input: rows.length, omittedDuplicates: 0, ok: rows.filter((row: any) => row.status === 'ok').length, needs_selection: 0, invalid: 0, not_found: 0, unavailable: 0 } }
}
async function mockResolve(page: Page) {
  const requests: any[] = []
  await page.route('**/api/link/resolve', async route => { const body = route.request().postDataJSON(); requests.push(body); await route.fulfill({ json: fixtureResult(body) }) })
  return requests
}
async function mockAddressSearch(page: Page, selected: Record<string, string>) {
  await page.route(postcodeScript, route => route.fulfill({ contentType: 'application/javascript', body: `window.kakao={Postcode:class{constructor(options){this.options=options;window.__linkAutoMapping=options.autoMapping}embed(element,options){window.__linkQuery=options?.q;const button=document.createElement('button');button.type='button';button.textContent='검색 결과 선택';button.onclick=()=>this.options.oncomplete(${JSON.stringify(selected)});element.append(button)}}};` }))
}
const resultTable = (page: Page) => page.getByRole('table', { name: '검색 결과', exact: true })
const searchBox = (page: Page) => page.getByLabel('주소·코드 입력', { exact: true })

test('입력 유형 선택 없이 한 번에 모든 결과·단계코드를 표시하고 원본·실패·중복을 유지한다', { timeout: 60_000 }, async t => {
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); t.after(() => browser.close())
  const context = await browser.newContext(); await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  const page = await context.newPage(), faults: string[] = []; page.on('pageerror', error => faults.push(error.message))
  const requests = await mockResolve(page)
  await openTool(page)
  const convert = page.getByRole('button', { name: '검색', exact: true })
  await expect(convert).toBeDisabled()
  await expect(page.getByRole('radio')).toHaveCount(0)
  for (const name of ['출력 유형', '출력 단위', '출력 형태', '주소 표시', '결과 필터']) await expect(page.getByLabel(name, { exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /위치 결과 좌표계/ })).toHaveCount(0)
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await searchBox(page).fill('1111010100100010000\n1111010100200010001\n=2+3\n\n1111010100100010000')
  await searchBox(page).press('Enter')
  const result = resultTable(page), first = result.locator('tbody tr').first()
  await expect(result.locator('tbody tr')).toHaveCount(5)
  assert.equal(requests.length, 1); assert.equal(requests[0].options.target, 'all'); assert.equal(requests[0].options.inputType, 'auto')
  await expect(first.locator('.detected')).toHaveText('PNU로 인식')
  await expect(first.locator('dt')).toHaveText(['주소', '우편번호', 'PNU', '법정동코드', '행정동코드', '위치'])
  for (const [kind, value] of [['address', '서울특별시 종로구 청운동 1'], ['pnu', '1111010100100010000'], ['legal_region', '1111010100'], ['administrative_region', '1111051500'], ['location', '126.97000000, 37.58000000']]) await expect(first.locator(`[data-conversion=${kind}] .value`)).toHaveText(value)
  await expect(first.locator('.region-levels code')).toHaveText(['11', '11110', '1111010100'])
  await expect(first.locator('.region-levels')).not.toContainText('리 ')
  await expect(result.locator('tbody tr').nth(1)).toContainText('산 1-1')
  await expect(result.locator('tbody tr').nth(2)).toContainText('입력 형식')
  await expect(result.locator('tbody tr').nth(3)).toContainText('빈 입력')
  await page.getByRole('button', { name: '결과 복사', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('복사')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(copied.includes('행정동코드')); assert.ok(copied.includes('1111010100')); assert.ok(copied.includes("'=2+3"))
  await page.screenshot({ path: resolve(evidence, 'web-link-all-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: resolve(evidence, 'web-link-all-mobile.png'), fullPage: true })
  await searchBox(page).fill('1111010100'); await expect(result).toHaveCount(0)
  await searchBox(page).press('Shift+Enter'); await expect(searchBox(page)).toHaveValue('1111010100\n'); assert.equal(requests.length, 1)
  for (const path of ['/viz', '/viz/upload', '/ai']) { assert.equal((await page.goto(baseURL + path))?.status(), 200); await expect(page.locator('h1')).toBeVisible() }
  assert.deepEqual(faults, [])
})

test('후보 선택은 행정동만 또는 공통 법정동으로 전달하고 다른 확인 결과를 유지한다', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); t.after(() => browser.close())
  const page = await browser.newPage(), requests = await mockResolve(page); await page.route(postcodeScript, route => route.abort('failed'))
  await openTool(page)
  await searchBox(page).fill('1168010100100010000'); await page.getByRole('button', { name: '검색', exact: true }).click()
  await page.getByRole('button', { name: '행정동코드: 서울특별시 강남구 역삼1동 선택', exact: true }).click()
  await expect(resultTable(page).locator('[data-conversion=administrative_region] .value')).toHaveText('1168064000')
  assert.equal(requests.at(-1).options.conversionSelections.administrative_region['입력:1'], '1168010100|1168064000')
  await expect(resultTable(page).locator('[data-conversion=legal_region] .value')).toHaveText('1111010100')
  await searchBox(page).fill('중앙동 1'); await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(resultTable(page).locator('.detected')).toHaveText('주소로 인식'); await expect(page.getByRole('status')).toContainText('주소 검색에 연결하지 못해')
  await page.getByRole('button', { name: '법정동코드: 서울특별시 종로구 청운동 선택', exact: true }).click()
  await expect(resultTable(page).locator('[data-conversion=pnu] .value')).toHaveText('1111010100100010000')
  assert.equal(requests.at(-1).options.selections['입력:1'], '1111010100')
  await expect(page.getByRole('button', { name: / 선택$/ })).toHaveCount(0)
})

test('주소 한 줄은 그 검색어로 주소 검색을 열고 선택 즉시 확정된 지번만 쓰며 추정 지번이 없어도 다른 결과는 표시한다', { timeout: 45_000 }, async t => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); t.after(() => browser.close())
  const page = await browser.newPage(), requests = await mockResolve(page)
  const normal = { userSelectedType: 'J', addressType: 'J', address: '서울특별시 종로구 청운동 1', jibunAddress: '서울특별시 종로구 청운동 1', roadAddress: '서울특별시 종로구 사직로 9', bcode: '1111010100', zonecode: '03000' }
  for (const selected of [normal, { ...normal, userSelectedType: 'R', address: normal.roadAddress }, { ...normal, userSelectedType: 'R', address: normal.roadAddress, jibunAddress: '', autoJibunAddress: normal.jibunAddress }]) {
    await page.unroute(postcodeScript); await mockAddressSearch(page, selected); const before = requests.length
    await openTool(page); await searchBox(page).fill('청운동 1'); await searchBox(page).press('Enter')
    await expect.poll(() => page.evaluate(() => (window as any).__linkQuery)).toBe('청운동 1'); assert.equal(requests.length, before)
    await page.getByRole('button', { name: '검색 결과 선택', exact: true }).click(); await expect(page.getByRole('dialog', { name: '주소 검색', exact: true })).not.toBeVisible()
    assert.equal(await page.evaluate(() => (window as any).__linkAutoMapping), false)
    if (selected.jibunAddress) { await expect(resultTable(page).locator('[data-conversion=pnu] .value')).toHaveText('1111010100100010000'); assert.equal(requests.at(-1).rows[0].value, normal.jibunAddress); assert.equal(requests.at(-1).options.inputType, 'address') }
    else { await expect(resultTable(page).locator('[data-conversion=pnu]')).toContainText('지번이 없어'); await expect(resultTable(page).locator('[data-conversion=legal_region] .value')).toHaveText('1111010100'); assert.equal(requests.at(-1).rows[0].value, normal.bcode); assert.equal(requests.at(-1).options.inputType, 'code') }
    assert.equal(requests.length, before + 1); await expect(resultTable(page).locator('.detected')).toHaveCount(0)
  }
  await page.goto(`${baseURL}/link?search=1&q=${encodeURIComponent('사직로 9')}`)
  await expect.poll(() => page.evaluate(() => (window as any).__linkQuery)).toBe('사직로 9'); await expect(searchBox(page)).toHaveValue('사직로 9')
})

test('시군구가 아닌 5자리는 우편번호로 보고 그 번호로 주소 검색을 연다', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); t.after(() => browser.close())
  const page = await browser.newPage(), requests = await mockResolve(page)
  await mockAddressSearch(page, { userSelectedType: 'J', address: '서울특별시 종로구 청운동 1', jibunAddress: '서울특별시 종로구 청운동 1', roadAddress: '', bcode: '1111010100', zonecode: '03046' })
  await openTool(page); await searchBox(page).fill('03046'); await searchBox(page).press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).__linkQuery)).toBe('03046'); assert.equal(requests.at(-1).options.inputType, 'auto')
  await page.getByRole('button', { name: '검색 결과 선택', exact: true }).click()
  await expect(resultTable(page).locator('[data-conversion=postcode] .value')).toHaveText('03046'); assert.equal(requests.at(-1).rows[0].value, '서울특별시 종로구 청운동 1')
  const before = requests.length
  await searchBox(page).fill('11110'); await searchBox(page).press('Enter')
  await expect.poll(() => requests.length).toBe(before + 1); await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('주소 검색에 연결하지 못하면 입력한 그대로 전체 결과를 얻는다', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); t.after(() => browser.close())
  const page = await browser.newPage(); await mockResolve(page); await page.route(postcodeScript, route => route.abort('failed'))
  await openTool(page); await searchBox(page).fill('서울특별시 종로구 청운동 1'); await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(resultTable(page).locator('[data-conversion=pnu] .value')).toHaveText('1111010100100010000')
  await expect(page.getByRole('status')).toHaveText('주소 검색에 연결하지 못해 입력한 그대로 찾았습니다.'); await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('위치 입력도 전체 변환을 요청하며 좌표계와 X·Y 순서를 유지한다', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); t.after(() => browser.close())
  const page = await browser.newPage(), requests = await mockResolve(page)
  await openTool(page); await page.getByRole('button', { name: '좌표로 찾기', exact: true }).click(); await expect(searchBox(page)).toHaveCount(0); await page.getByLabel('입력 좌표계', { exact: true }).selectOption('EPSG:5179'); await page.getByLabel('X', { exact: true }).fill('1000000')
  await expect(page.getByRole('combobox', { name: /위치 결과 좌표계/ })).toHaveCount(0)
  const convert = page.getByRole('button', { name: '검색', exact: true }); await expect(convert).toBeDisabled(); await page.getByLabel('Y', { exact: true }).fill('2000000'); await convert.click()
  await expect(resultTable(page).locator('[data-conversion=location] .value')).toHaveText('127.50000000, 38.00000000')
  assert.equal(requests[0].text, '1000000, 2000000'); assert.equal(requests[0].options.inputType, 'location'); assert.equal(requests[0].options.target, 'all'); assert.equal(requests[0].options.sourceCrs, 'EPSG:5179'); assert.equal(requests[0].options.outputCrs, 'EPSG:4326')
  await expect(resultTable(page).locator('[data-conversion=address] .value')).toBeVisible()
  await page.getByRole('combobox', { name: '입력:1 위치 결과 좌표계', exact: true }).selectOption('EPSG:5179')
  await expect(resultTable(page).locator('[data-conversion=location] .value')).toHaveText('1000000.000, 2000000.000')
  await page.getByRole('combobox', { name: '입력:1 위치 결과 좌표계', exact: true }).selectOption('EPSG:4326')
  await expect(resultTable(page).locator('[data-conversion=location] .value')).toHaveText('127.50000000, 38.00000000')
  assert.equal(requests.length, 1)
  await page.getByLabel('X', { exact: true }).fill('1000001'); await expect(resultTable(page)).toHaveCount(0)
  await page.getByRole('button', { name: '주소·코드로 찾기', exact: true }).click(); await expect(searchBox(page)).toBeVisible(); await expect(page.getByLabel('X', { exact: true })).toHaveCount(0)
})

test('결과 좌표계는 행별로 즉시 바꾸며 원본 좌표·다른 결과·복사 값을 유지한다', { timeout: 30_000 }, async t => {
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); t.after(() => browser.close())
  const context = await browser.newContext(); await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  const page = await context.newPage(), requests = await mockResolve(page), boundaryCalls: string[] = []
  await page.route('**/api/link/boundary', route => { boundaryCalls.push(route.request().url()); return route.fulfill({ status: 503 }) })
  await openTool(page)
  await expect(page.locator('form').getByRole('combobox')).toHaveCount(0)
  await searchBox(page).fill('1111010100100010000\n1111010100100020000')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  const rows = resultTable(page).locator('tbody tr'), first = rows.nth(0), second = rows.nth(1)
  const coordinate = first.locator('[data-conversion=location] .value'), selector = first.getByRole('combobox', { name: '입력:1 위치 결과 좌표계', exact: true })
  await expect(selector).toHaveValue('EPSG:4326')
  await selector.selectOption('EPSG:5179')
  await expect(coordinate).toHaveText('953203.113, 1953533.796')
  await expect(second.locator('[data-conversion=location] .value')).toHaveText('126.97000000, 37.58000000')
  await expect(second.getByRole('combobox', { name: '입력:2 위치 결과 좌표계', exact: true })).toHaveValue('EPSG:4326')
  await expect(first.locator('[data-conversion=pnu] .value')).toHaveText('1111010100100010000')
  await expect(first.locator('[data-conversion=address] .value')).toHaveText('서울특별시 종로구 청운동 1')
  await expect(first.getByRole('button', { name: '법정동 경계 SHP 다운로드', exact: true })).toBeEnabled()
  assert.equal(requests.length, 1); assert.equal(boundaryCalls.length, 0)
  await page.getByRole('button', { name: '결과 복사', exact: true }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(copied.includes('953203.113, 1953533.796')); assert.ok(copied.includes('EPSG:5179')); assert.ok(copied.includes('EPSG:4326'))
  await selector.selectOption('EPSG:4326')
  await expect(coordinate).toHaveText('126.97000000, 37.58000000')
  await page.screenshot({ path: resolve(evidence, 'web-link-result-crs.png'), fullPage: true })
  assert.equal(requests.length, 1)

  await page.unroute('**/api/link/resolve')
  await page.route('**/api/link/resolve', route => {
    requests.push(route.request().postDataJSON())
    const result = fixtureResult(requests.at(-1)), row = result.rows[0]
    row.output.x = '0'; row.output.y = '0'; row.conversions.location.value = '0.00000000, 0.00000000'
    return route.fulfill({ json: result })
  })
  await searchBox(page).fill('1111010100100030000')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(selector).toHaveValue('EPSG:4326')
  await selector.selectOption('EPSG:5179')
  await expect(first.locator('[data-conversion=location] [role=alert]')).toContainText('입력 범위')
  await expect(coordinate).toHaveCount(0)
  await expect(first.locator('[data-conversion=pnu] .value')).toBeVisible()
  await selector.selectOption('EPSG:4326')
  await expect(coordinate).toHaveText('0.00000000, 0.00000000')
  await expect(first.locator('[data-conversion=location] [role=alert]')).toHaveCount(0)
  assert.equal(requests.length, 2); assert.equal(boundaryCalls.length, 0)
})

test('기준자료는 별도 페이지에 있으며 오늘 확인한 자료는 재적용할 수 없다', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('**/api/link/references', route => route.fulfill({ json: { day: '2026-10-30', state: 'done', canUpdate: false, message: '오늘 공식 기준자료 확인을 마쳤습니다.', sources: [{ id: 'legal', label: '법정동코드', available: true, source: '브라우저 테스트 공식 자료 fixture', sourceUrl: 'https://example.invalid/legal', version: 'web-reference-fixture', count: 3, sourceDate: null, checkedAt: '2026-10-30T00:00:00.000Z', activatedAt: '2026-10-29T00:00:00.000Z', state: 'unchanged' }] } }))
  await openTool(page); await page.getByRole('link', { name: '기준 자료·업데이트 →', exact: true }).click(); await expect(page).toHaveURL(`${baseURL}/link/reference`)
  await expect(page.getByRole('heading', { name: '기준자료', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '오늘 확인 완료', exact: true })).toBeDisabled(); await expect(page.getByText('원천에서 제공하지 않음', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '← 주소·코드 변환', exact: true }).click(); await expect(page).toHaveURL(`${baseURL}/link`)
})

test('SHP는 별도 버튼을 눌러야 요청되며 실패해도 모든 변환 결과를 보존한다', { timeout: 30_000 }, async t => {
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); t.after(() => browser.close())
  const page = await browser.newPage(); await mockResolve(page)
  const calls: any[] = [], downloads: string[] = []; let fail = true
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await page.route('**/api/link/boundary', async route => { calls.push(route.request().postDataJSON()); await route.fulfill(fail ? { status: 503, json: { data: { code: 'BOUNDARY_SOURCE_AUTH', message: '경계 원천 권한을 확인하세요.' } } } : { contentType: 'application/zip', body: Buffer.from('504b0506000000000000000000000000000000000000', 'hex') }) })
  await openTool(page); await searchBox(page).fill('1111010100100010000'); await page.getByRole('button', { name: '검색', exact: true }).click()
  const button = page.getByRole('button', { name: '법정동 경계 SHP 다운로드', exact: true }); await expect(button).toBeEnabled(); assert.equal(calls.length, 0); assert.deepEqual(downloads, [])
  await button.click(); await expect(page.getByRole('alert')).toHaveText('경계 원천 권한을 확인하세요.')
  assert.deepEqual(calls, [{ codes: ['1111010100'], crs: 'EPSG:4326' }]); assert.deepEqual(downloads, [])
  await expect(resultTable(page).locator('[data-conversion=pnu] .value')).toHaveText('1111010100100010000'); await expect(resultTable(page).locator('[data-conversion=administrative_region] .value')).toHaveText('1111051500'); await expect(button).toBeEnabled()
  await page.screenshot({ path: resolve(evidence, 'web-link-all-boundary-error.png'), fullPage: true })
  fail = false
  const download = page.waitForEvent('download'); await button.click(); const artifact = await download; await artifact.saveAs(resolve(evidence, 'web-boundary-download-fixture.zip'))
  await expect(page.getByRole('status')).toContainText('경계 SHP 묶음을 내려받았습니다')
  assert.equal(calls.length, 2); assert.equal(downloads.length, 1)
})
