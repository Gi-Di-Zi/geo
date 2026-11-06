// 적용 코드(shared/snippets.ts)를 그대로 실행해 결과가 실제로 그려지는지 확인한다. 사이트 뷰어가 아니라 사용자가 붙여 넣을 코드를 검사한다.
// 예시 결과(/data/…, /svc/…)가 있는 사이트(VIZ_TEST_URL)와 같은 출처에서 실행하고, 배경지도 자리(basemap·baseStyle·basemapTileUrl)는 흰 배경으로 채운다.
// 지도 영역에 흰색이 아닌 픽셀이 있으면 그려진 것으로 본다. Cesium 지형은 색이 없으므로 .terrain 타일 응답으로 본다.
// 독립 HTML 지도(shared/standalone.ts)도 결과 zip과 같은 배치로 열어 같은 기준으로 본다 (라이브러리 묶음: scripts/standalone-lib.ts)
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from '@playwright/test'
import { usage } from '../../shared/snippets.ts'
import { standalonePage } from '../../shared/standalone.ts'
import type { StandaloneLib } from '../../shared/standalone.ts'
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

/** data = 결과 폴더 주소 (서버 결과면 빈 값) */
interface Case { name: string; viewer: ViewerId; o: Output; url: string; data: string; center: [number, number]; zoom: number; code: string }

/** 예시 레시피의 뷰어별 결과마다 사이트 코드 서랍과 같은 주소·시점으로 만든 적용 코드 */
const cases: Case[] = specs.filter(s => !s.closed).flatMap(s => s.recipes.flatMap(r => viewers.flatMap(({ id: viewer }) => {
  const m = r.viewers[viewer]
  const o = m && 'output' in m ? r.outputs.find(x => x.id === m.output) : undefined

  if (!o) return []
  const data = o.path.startsWith('/') ? '' : `${base}/data/${s.category}/${s.id}/${r.id}/`
  const url = data ? data + o.path : base + o.path

  const view = r.view ?? s.view

  return [{ name: `${viewer} ${o.kind} ${s.category}/${s.id}/${r.id}`, viewer, o, url, data, center: view.center, zoom: view.zoom, code: usage(viewer, o, url, view).code }]
})))

test('적용 코드에 빈 값(undefined·NaN·빈 좌표)이 끼지 않는다', () => {
  // data: undefined는 deck.gl TileLayer 공식 예제의 의도된 값
  const bad = cases.flatMap(c => (/undefined|NaN|fromDegrees\(\)|position: null/.test(c.code.replaceAll('data: undefined', '')) ? [c.name] : []))

  assert.deepEqual(bad, [])
})

test('독립 HTML 지도: 모든 파일 결과의 데이터 주소가 페이지 기준(DATA)으로 바뀌고 자리 표시가 남지 않는다', () => {
  const lib: StandaloneLib = { imports: {}, files: {}, versions: { cesium: '1.0.0' } }

  const bad = cases.filter(c => c.data).flatMap(c => {
    const html = standalonePage(c.viewer, c.o, { center: c.center, zoom: c.zoom }, lib, c.name)

    return html.includes('__GEO_DATA__') || !html.includes('DATA + "') ? [c.name] : []
  })

  assert.deepEqual(bad, [])
})

test('GeoServer WMTS 결과의 bounds가 GeoWebCache 타일 범위를 넘지 않는다 (넘으면 MapLibre가 격자 밖 타일을 요청해 400)', async () => {
  const caps = await (await fetch(`${base}/svc/geoserver/gwc/service/wmts?REQUEST=GetCapabilities`)).text()
  const mercY = (lat: number) => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
  const bad: string[] = []

  for (const o of specs.filter(s => !s.closed).flatMap(s => s.recipes.flatMap(r => r.outputs))) {
    const layer = /gwc\/service\/wmts.*LAYER=([^&]+)/.exec(o.path)?.[1]
    // 행·열 범위 = WMTS TileMatrixLimits (행은 위부터 = XYZ y)
    const set = caps.split('<Layer>').find(l => l.includes(`<ows:Identifier>${layer}<`))?.split('<TileMatrixSetLink>').find(l => l.includes('<TileMatrixSet>EPSG:900913<'))

    if (!layer || !o.bounds) continue

    if (!set) { bad.push(`${layer}: GeoWebCache 레이어 없음`); continue }

    const [w, s, e, n] = o.bounds

    for (const [, z, ...lim] of set.matchAll(/EPSG:900913:(\d+)<\/TileMatrix>\s*<MinTileRow>(\d+)<\/MinTileRow>\s*<MaxTileRow>(\d+)<\/MaxTileRow>\s*<MinTileCol>(\d+)<\/MinTileCol>\s*<MaxTileCol>(\d+)/g)) {
      const k = 2 ** Number(z)
      const [r0, r1, c0, c1] = lim.map(Number)

      // 최대 줌 위로는 요청하지 않고 확대만
      if (Number(z) < (o.minzoom ?? 0) || Number(z) > (o.maxzoom ?? 22)) continue
      // MapLibre TileBounds.contains와 같은 계산: floor(최소) ~ ceil(최대) 미만
      const asked = [Math.floor(((180 + w) / 360) * k), Math.ceil(((180 + e) / 360) * k) - 1, Math.floor(mercY(n) * k), Math.ceil(mercY(s) * k) - 1]

      if (asked[0] < c0 || asked[1] > c1 || asked[2] < r0 || asked[3] > r1) { bad.push(`${layer} z${z}: 요청 x${asked[0]}-${asked[1]} y${asked[2]}-${asked[3]}, 격자 x${c0}-${c1} y${r0}-${r1}`); break }
    }
  }

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

/** 열 페이지 준비: 경로를 가로채고 열 주소를 준다 (실패면 이유) */
type Stage = (tab: Page) => Promise<string | Error>

/** 적용 코드: 배경지도 자리를 흰 배경으로 채워 esbuild로 한 덩어리 */
const snippetStage = (c: Case): Stage => async tab => {
  const out = await build({
    stdin: { contents: `${prelude[c.viewer]}${c.code}${postlude[c.viewer]}\nwindow.__done = true`, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', write: false, platform: 'browser', target: 'es2022', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).catch((e: Error) => e)

  if (out instanceof Error) return new Error(`빌드 실패: ${out.message.split('\n')[1] ?? out.message}`)
  await tab.route(`${base}/__snippet`, r => r.fulfill({ contentType: 'text/html', body: page(out.outputFiles[0].text) }))
  // MapLibre 6 워커: 번들러가 결과 옆에 내보내는 파일 (esbuild 한 덩어리 번들에는 없음)
  await tab.route(`${base}/maplibre-gl-worker.mjs*`, r => r.fulfill({ contentType: 'text/javascript', path: join(root, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs') }))

  return `${base}/__snippet`
}

const WHITE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC', 'base64')
const HIDE = '<style>html,body{background:#fff}.maplibregl-ctrl,.ol-control,.ol-attribution,.cesium-viewer-bottom,.cesium-viewer-toolbar,.cesium-viewer-animationContainer,.cesium-viewer-timelineContainer,.cesium-viewer-fullscreenContainer{display:none!important}</style>'

/** 독립 HTML 지도: 결과 zip과 같은 배치(index.html · lib/ · data/)를 사이트 예시 결과로. 배경지도(OSM)는 흰 타일로 바꿔 데이터만 색이 남게 */
const siteStage = (c: Case, lib: StandaloneLib): Stage => async tab => {
  const at = `${base}/__site/`

  const html = standalonePage(c.viewer, c.o, { center: c.center, zoom: c.zoom }, lib, c.name)
    .replace('</head>', `${HIDE}</head>`).replace(/\n<\/script>\n<\/body>/, `${postlude[c.viewer]}\nwindow.__done = true\n</script>\n</body>`)

  await tab.route('https://tile.openstreetmap.org/**', r => r.fulfill({ contentType: 'image/png', body: WHITE_PNG }))
  await tab.route(`${at}index.html`, r => r.fulfill({ contentType: 'text/html', body: html }))
  await tab.route(`${at}lib/**`, r => {
    const file = join(root, 'server/assets/standalone', c.viewer, new URL(r.request().url()).pathname.split('/lib/')[1] ?? '')

    return existsSync(file) ? r.fulfill({ path: file }) : r.fulfill({ status: 404 })
  })
  await tab.route(`${at}data/**`, async r => r.fulfill({ response: await r.fetch({ url: c.data + r.request().url().slice(`${at}data/`.length) }) }))

  return `${at}index.html`
}

async function render(browser: Browser, stage: Stage) {
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
  const open = await stage(tab)

  if (open instanceof Error) { await tab.close();

 return { faults: [open.message], inked: 0, terrain: 0, missing: [] } }

  try {
    // load는 코드의 최상위 await(타일셋·지형 읽기)까지 기다린다 → 응답 시작만 보고 끝남은 __done으로 확인
    await tab.goto(open, { waitUntil: 'commit' }).catch((e: Error) => faults.push(`페이지 열기 실패: ${e.message.split('\n')[0]}`))
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

const launch = () => chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], ...(process.env.VIZ_BROWSER_PATH ? { executablePath: process.env.VIZ_BROWSER_PATH } : { channel: 'chrome' }) })

/** 사례마다 열어 그려졌는지·오류를 보고 실패 목록 */
async function check(t: test.TestContext, runs: Case[], stageOf: (c: Case) => Stage) {
  const browser = await launch()
  const failed: string[] = []

  t.after(() => browser.close())

  for (const c of runs) {
    const r = await render(browser, stageOf(c))
    // 배경이 흰색 → 데이터가 아니면 칠해질 것이 없다. 약 100px(0.02%)이면 그려진 것
    const drawn = c.o.kind === 'quantized-mesh' ? r.terrain > 0 : r.inked > 0.0002

    t.diagnostic(`${c.name}: ${c.o.kind === 'quantized-mesh' ? `.terrain ${r.terrain}개` : `색 ${(r.inked * 100).toFixed(2)}%`}${r.faults.length ? ` · ${r.faults.slice(0, 3).join(' | ').slice(0, 300)}` : ''}${r.missing.length ? ` · 응답 오류 ${r.missing.length}건 (예: ${r.missing[0]})` : ''}`)

    if (!drawn || r.faults.length) failed.push(`${c.name}${drawn ? '' : ' — 그려지지 않음'}${r.faults.length ? ` — ${r.faults[0].slice(0, 160)}` : ''}`)
  }

  return failed
}

/** 같은 열쇠(뷰어:결과 종류)는 한 번만 */
const once = (list: Case[], key: (c: Case) => string, seen = new Set<string>()) => list.filter(c => !seen.has(key(c)) && !!seen.add(key(c)))

test('적용 코드를 그대로 실행하면 결과가 그려진다 (뷰어×결과 종류마다 한 예시)', { timeout: 600_000 }, async t => {
  // 타일 파일은 최대 줌보다 2단계 더 확대해도 비지 않아야 한다 (없는 타일을 요청하지 않고 최대 줌 타일을 확대). 위치 = 예시 시점 가운데.
  // 최대 줌이 높은(19) 서버 타일은 그 위로 확대할 일이 드물고, 화면이 수십 m라 점 데이터는 원래 비어 보일 수 있어 제외
  const zoomed = once(cases.filter(c => ['mvt', 'xyz-raster', 'terrain-rgb'].includes(c.o.kind) && c.o.maxzoom !== undefined && c.o.maxzoom <= 16 && c.data), c => `${c.viewer}:${c.o.kind}`)
    .map(c => ({ ...c, name: `${c.name} (최대 줌+2 확대)`, code: usage(c.viewer, c.o, c.url, { center: c.center, zoom: (c.o.maxzoom ?? 0) + 2 }).code }))

  assert.deepEqual(await check(t, [...once(cases, c => `${c.viewer}:${c.o.kind}`), ...zoomed], snippetStage), [])
})

test('독립 HTML 지도(index.html·lib·data)를 열면 결과가 그려진다 (뷰어×파일 결과 종류마다 한 예시)', { timeout: 600_000 }, async t => {
  const lib: StandaloneLib = JSON.parse(readFileSync(join(root, 'server/assets/standalone/manifest.json'), 'utf8'))

  assert.deepEqual(await check(t, once(cases.filter(c => c.data), c => `${c.viewer}:${c.o.kind}`), c => siteStage(c, lib)), [])
})
