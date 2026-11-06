import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

// 실행 중인 dev/preview 서버의 탐색·표시 검사. 실제 변환 산출물 검사를 대신하지 않는다.
const base = process.env.VIZ_TEST_URL || 'http://localhost:3000'
const examples = [
  { name: 'CityGML → 3D Tiles', path: '/viz/model-3d/citygml' },
  { name: 'LAS 점군 → 웹 시각화', path: '/viz/pointcloud/las' },
  { name: '같은 CSV, 파일과 서버로', path: '/viz/attribute/csv' },
]
const launch = () => chromium.launch({ headless: true, ...(process.env.VIZ_BROWSER_PATH ? { executablePath: process.env.VIZ_BROWSER_PATH } : { channel: 'chrome' }) })

test('홈·시각화 탐색은 데스크톱과 모바일에서 대표 예시와 함께 쓰는 도구를 보여 준다', { timeout: 60_000 }, async t => {
  const browser = await launch(); t.after(() => browser.close())
  const page = await browser.newPage()
  const faults: string[] = []
  page.on('pageerror', error => faults.push(error.message))
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/', '/viz']) {
      assert.equal((await page.goto(base + path))?.status(), 200)
      await expect(page.locator('h1')).toContainText(path === '/' ? '공간 데이터를 웹 지도와 3D로' : '공간 데이터 시각화 도구')
      const section = page.getByRole('region', { name: path === '/' ? '대표 예시' : '대표 예시로 시작하기', exact: true })
      for (const example of examples) {
        const link = section.getByRole('link', { name: new RegExp(example.name) })
        await expect(link).toHaveAttribute('href', example.path + '/view')
        await expect(link.locator('img')).toBeVisible()
        await expect.poll(() => link.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      }
      // 주소·코드 연계는 정식 기능 (개발 중 표시 없음)
      await expect(page.locator('.flow-bar').getByRole('link', { name: /국내 주소·코드 연계 도구/ })).not.toContainText('개발 중')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${path}: ${width}px 가로 넘침`)
    }
  }
  await page.goto(base)
  await expect(page.getByRole('region', { name: '함께 쓰는 도구' })).toContainText('국내 주소·코드 연계 도구')
  await page.getByRole('navigation', { name: '시작', exact: true }).getByRole('link', { name: '대표 예시 3개' }).click()
  await expect(page).toHaveURL(base + '/viz#examples')
  await expect(page.getByRole('heading', { name: '대표 예시로 시작하기' })).toBeInViewport()
  assert.deepEqual(faults, [])
})

test('기존 유형 선택과 대표 예시의 수집·전처리·변환·결과 경로가 유지된다', { timeout: 60_000 }, async t => {
  const browser = await launch(); t.after(() => browser.close())
  const page = await browser.newPage()
  await page.goto(base + '/viz')
  await page.getByRole('button', { name: /속성 데이터/ }).click()
  const picker = page.getByRole('dialog', { name: '속성 데이터', exact: true })
  await expect(picker).toBeVisible()
  await picker.getByRole('link', { name: /CSV/ }).click()
  await expect(page).toHaveURL(base + '/viz/attribute/csv')
  for (const example of examples) {
    for (const [suffix, heading] of [['', '수집'], ['/preprocess', '전처리'], ['/convert', '웹 형태 변환']]) {
      assert.equal((await page.goto(base + example.path + suffix))?.status(), 200)
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await expect(page.getByRole('navigation', { name: '변환 단계' }).getByRole('link', { name: /시각화·렌더링/ })).toHaveAttribute('href', example.path + '/view')
    }
    // 데이터가 없는 환경에서도 경로·메뉴만 검사한다. 지도 로드 성공으로 보고하지 않는다.
    assert.equal((await page.goto(base + example.path + '/view'))?.status(), 200)
    await expect(page.getByRole('region', { name: '렌더러별 결과 (웹 뷰어 4종 + 엔진)', exact: true })).toBeVisible()
  }
  assert.equal((await page.goto(base + '/link'))?.status(), 200)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page).not.toHaveTitle(/개발 중/)
  assert.equal((await page.goto(base + '/link/reference'))?.status(), 200)
  await expect(page.locator('header .eyebrow')).not.toContainText('개발 중')
  await expect(page).not.toHaveTitle(/개발 중/)
})

test('프로덕션 MCP 리소스에 설치 SDK가 포함된다 (외부 자산 경로 회귀)', async () => {
  const response = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://geo/app.html' } }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.error, undefined)
  const html = body.result?.contents?.[0]?.text
  assert.equal(typeof html, 'string')
  assert.match(html, /globalThis\.McpApps/)
  assert.ok(!html.includes('__MCP_APPS_SDK__'), 'SDK 치환 자리 표시자가 남으면 안 됨')
})
