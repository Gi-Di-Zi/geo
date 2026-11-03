// 적용 코드(shared/snippets.ts)를 그대로 실행해 결과가 실제로 그려지는지 확인한다. 사이트 뷰어가 아니라 사용자가 붙여 넣을 코드를 검사한다.
// 예시 결과(/data/…, /svc/…)가 있는 사이트(VIZ_TEST_URL)와 같은 출처에서 실행하고, 배경지도 자리(basemap·baseStyle·basemapTileUrl)는 흰 배경으로 채운다.
// 지도 영역에 흰색이 아닌 픽셀이 있으면 그려진 것으로 본다. Cesium 지형은 색이 없으므로 .terrain 타일 응답으로 본다
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium, type Browser } from '@playwright/test'
import { usage } from '../../shared/snippets.ts'
import { viewers } from '../../shared/viewers.ts'
import type { FormatSpec, Output, ViewerId } from '../../shared/types.ts'

const base = (process.env.VIZ_TEST_URL || 'http://localhost:3000').replace(/\/$/, '')
const root = fileURLToPath(new URL('../../', import.meta.url))
const dir = join(root, 'shared/catalog')
const specs: FormatSpec[] = []

for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' }).map(f => f.replaceAll('\\', '/')).sort()) {
  if (!/^[^/]+\/[^_/][^/]*\.ts$/.test(file)) continue
  const mod: { default: FormatSpec } = await import(pathToFileURL(join(dir, file)).href)

  specs.push(mod.default)
}

interface Case { name: string; viewer: ViewerId; o: Output; url: string; center: [number, number]; code: string }

/** 예시 레시피의 뷰어별 결과마다 사이트 코드 서랍과 같은 주소·시점으로 만든 적용 코드 */
const cases: Case[] = specs.filter(s => !s.closed).flatMap(s => s.recipes.flatMap(r => viewers.flatMap(({ id: viewer }) => {
  const m = r.viewers[viewer]
  const o = m && 'output' in m ? r.outputs.find(x => x.id === m.output) : undefined

  if (!o) return []
  const url = o.path.startsWith('/') ? base + o.path : `${base}/data/${s.category}/${s.id}/${r.id}/${o.path}`

  const view = r.view ?? s.view

  return [{ name: `${viewer} ${o.kind} ${s.category}/${s.id}/${r.id}`, viewer, o, url, center: view.center, code: usage(viewer, o, url, view).code }]
})))

test('적용 코드에 빈 값(undefined·NaN·빈 좌표)이 끼지 않는다', () => {
  // data: undefined는 deck.gl TileLayer 공식 예제의 의도된 값
  const bad = cases.flatMap(c => (/undefined|NaN|fromDegrees\(\)|position: null/.test(c.code.replaceAll('data: undefined', '')) ? [c.name] : []))

  assert.deepEqual(bad, [])
})

const prelude: Record<ViewerId, string> = {
  ol: "import VectorLayer_ from 'ol/layer/Vector'\nimport VectorSource_ from 'ol/source/Vector'\nconst basemap = new VectorLayer_({ source: new VectorSource_() })\n",
  maplibre: "const baseStyle = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ffffff' } }] }\n",
  deck: "const baseStyle = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ffffff' } }] }\nconst basemapTileUrl = null\n",
  cesium: '',
}

// 코드가 끝난 뒤: MapLibre는 렌더링이 멈출 때까지, Cesium은 구·하늘을 흰색으로 바꿔 데이터만 색이 남게
const postlude: Record<ViewerId, string> = {
  ol: '',
  maplibre: "\nawait new Promise(r => map.once('idle', r))\n",
  deck: "\nawait new Promise(r => map.once('idle', r))\n",
  cesium: '\nconst s = viewer.scene\ns.globe.baseColor = Cesium.Color.WHITE; s.backgroundColor = Cesium.Color.WHITE; s.skyBox.show = false; s.skyAtmosphere.show = false\ns.sun.show = false; s.moon.show = false; s.globe.showGroundAtmosphere = false; s.fog.enabled = false\n',
}

const page = (bundle: string) => `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#fff}#map{width:800px;height:600px}
.maplibregl-ctrl,.ol-control,.ol-attribution,.cesium-viewer-bottom,.cesium-viewer-toolbar,.cesium-viewer-animationContainer,.cesium-viewer-timelineContainer,.cesium-viewer-fullscreenContainer{display:none!important}</style>
<link rel="stylesheet" href="/cesium/Widgets/widgets.css"><script>window.CESIUM_BASE_URL = '/cesium/'</script>
</head><body><div id="map"></div><script type="module">${bundle.replaceAll('</script', '<\\/script')}</script></body></html>`

async function render(browser: Browser, c: Case) {
  const out = await build({
    stdin: { contents: `${prelude[c.viewer]}${c.code}${postlude[c.viewer]}\nwindow.__done = true`, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', write: false, platform: 'browser', target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).catch((e: Error) => e)

  if (out instanceof Error) return { faults: [`빌드 실패: ${out.message.split('\n')[1] ?? out.message}`], inked: 0, terrain: 0, missing: [] }
  const tab = await browser.newPage({ viewport: { width: 800, height: 600 } })
  const faults: string[] = []
  const missing: string[] = []
  let terrain = 0
  let inflight = 0

  tab.on('pageerror', e => faults.push(e.message))
  tab.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) faults.push(m.text()) })
  tab.on('request', () => inflight++)
  tab.on('requestfinished', () => inflight--)
  tab.on('requestfailed', r => { inflight--; faults.push(`요청 실패 ${r.url()}`) })
  // 404는 빈 타일일 수 있어 실패로 세지 않고 진단에만 남긴다
  tab.on('response', r => {
    if (new URL(r.url()).pathname.endsWith('.terrain') && r.ok()) terrain++

    if (r.status() >= 400) missing.push(`${r.status()} ${r.url().replace(base, '')}`)
  })
  await tab.route(`${base}/__snippet`, r => r.fulfill({ contentType: 'text/html', body: page(out.outputFiles[0].text) }))
  // MapLibre 6 워커: 번들러가 결과 옆에 내보내는 파일 (esbuild 한 덩어리 번들에는 없음)
  await tab.route(`${base}/maplibre-gl-worker.mjs*`, r => r.fulfill({ contentType: 'text/javascript', path: join(root, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs') }))

  try {
    // load는 코드의 최상위 await(타일셋·지형 읽기)까지 기다린다 → 응답 시작만 보고 끝남은 __done으로 확인
    await tab.goto(`${base}/__snippet`, { waitUntil: 'commit' }).catch((e: Error) => faults.push(`페이지 열기 실패: ${e.message.split('\n')[0]}`))
    await tab.waitForFunction(() => '__done' in window, null, { timeout: 30_000 }).catch(() => faults.push('코드가 30초 안에 끝나지 않음'))

    for (let quiet = 0, t = 0; quiet < 3 && t < 40; t++) { await tab.waitForTimeout(500); quiet = inflight > 0 ? 0 : quiet + 1 }

    await tab.waitForTimeout(1000)
    const png = await tab.locator('#map').screenshot()

    // 픽셀 비율은 거친 판정 (점이 1px로 찍혀도 통과) → SNIPPET_SHOTS 폴더에 화면을 남겨 눈으로 확인
    if (process.env.SNIPPET_SHOTS) writeFileSync(join(process.env.SNIPPET_SHOTS, `${c.name.replace(/[^\w-]+/g, '_')}.png`), png)
    const shot = png.toString('base64')

    const inked = await tab.evaluate(async b64 => {
      const img = new Image()

      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')

      if (!ctx) return 0
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, img.width, img.height).data
      let n = 0

      for (let i = 0; i < d.length; i += 4) if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) n++

      return n / (img.width * img.height)
    }, shot)

    return { faults, inked, terrain, missing }
  } finally { await tab.close() }
}

test('적용 코드를 그대로 실행하면 결과가 그려진다 (뷰어×결과 종류마다 한 예시)', { timeout: 600_000 }, async t => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...(process.env.VIZ_BROWSER_PATH ? { executablePath: process.env.VIZ_BROWSER_PATH } : { channel: 'chrome' }) })
  const seen = new Set<string>()
  const failed: string[] = []

  t.after(() => browser.close())
  const once = (list: Case[], key: (c: Case) => string) => list.filter(c => !seen.has(key(c)) && !!seen.add(key(c)))

  // 타일 파일은 최대 줌보다 2단계 더 확대해도 비지 않아야 한다 (없는 타일을 요청하지 않고 최대 줌 타일을 확대). 위치 = 예시 시점 가운데.
  // 최대 줌이 높은(19) 서버 타일은 그 위로 확대할 일이 드물고, 화면이 수십 m라 점 데이터는 원래 비어 보일 수 있어 제외
  const zoomed = once(cases.filter(c => ['mvt', 'xyz-raster', 'terrain-rgb'].includes(c.o.kind) && c.o.maxzoom !== undefined && c.o.maxzoom <= 16 && !c.o.path.startsWith('/')), c => `확대 ${c.viewer}:${c.o.kind}`)
    .map(c => ({ ...c, name: `${c.name} (최대 줌+2 확대)`, code: usage(c.viewer, c.o, c.url, { center: c.center, zoom: (c.o.maxzoom ?? 0) + 2 }).code }))

  const runs = [...once(cases, c => `${c.viewer}:${c.o.kind}`), ...zoomed]

  for (const c of runs) {
    const r = await render(browser, c)
    // 배경이 흰색 → 데이터가 아니면 칠해질 것이 없다. 약 100px(0.02%)이면 그려진 것
    const drawn = c.o.kind === 'quantized-mesh' ? r.terrain > 0 : r.inked > 0.0002

    t.diagnostic(`${c.name}: ${c.o.kind === 'quantized-mesh' ? `.terrain ${r.terrain}개` : `색 ${(r.inked * 100).toFixed(2)}%`}${r.faults.length ? ` · ${r.faults.slice(0, 3).join(' | ').slice(0, 300)}` : ''}${r.missing.length ? ` · 응답 오류 ${r.missing.length}건 (예: ${r.missing[0]})` : ''}`)

    if (!drawn || r.faults.length) failed.push(`${c.name}${drawn ? '' : ' — 그려지지 않음'}${r.faults.length ? ` — ${r.faults[0].slice(0, 160)}` : ''}`)
  }

  assert.deepEqual(failed, [])
})
