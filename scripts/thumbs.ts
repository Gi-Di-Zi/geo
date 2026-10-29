// 홈 유형 카드 그림: 확장자마다 시각화·렌더링 화면(?embed=1)을 화면 없는 Chrome으로 찍어 public/thumbs/<유형>-<확장자>.webp
// 사용: 개발 서버를 띄운 채 npm run thumbs [-- <유형>/<확장자> …]. 바꾸기: SITE(기본 http://localhost:3000), CHROME(크롬 실행 파일)
// 배경지도는 OSM으로 바꿔 찍는다 (VWorld 지도 그림은 복제·배포 불가). 지도 위 버튼·출처 표기는 숨김 → 출처는 홈 카드 아래 문구
// 패키지 없이 Chrome DevTools 프로토콜(Node 내장 WebSocket)만 쓴다
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadFormats } from './pipeline.ts'

const root = resolve(import.meta.dirname, '..')
const site = process.env.SITE ?? 'http://localhost:3000'
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = 9333
const [W, H] = [1280, 800] // 큰 화면으로 그려 절반(640×400)으로 저장 → 시점이 사이트 화면과 같다
const out = join(root, 'public/thumbs')
// 사이트 시점에서는 데이터가 작게 잡히는 것: 확대 버튼을 이만큼 더 누르고 찍는다 (사이트 시점은 엔진 카메라와 묶여 그대로 둔다)
const zoomIn: Record<string, number> = { 'indoor-bim/ifc': 2, 'pointcloud/las': 1 }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const want = process.argv.slice(2)
const specs = (await loadFormats()).filter(s => !s.closed && (!want.length || want.includes(`${s.category}/${s.id}`)))
if (!(await fetch(site).then(r => r.ok, () => false))) throw new Error(`${site} 응답 없음 → 개발 서버(npm run dev)를 먼저 띄운다`)
mkdirSync(out, { recursive: true })

const profile = mkdtempSync(join(tmpdir(), 'geo-thumbs-'))
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
let page: { webSocketDebuggerUrl: string } | undefined
for (let i = 0; i < 50 && !page; i++) {
  await sleep(200)
  page = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).then((l: any[]) => l.find(t => t.type === 'page'), () => undefined)
}
if (!page) throw new Error(`크롬 디버깅 포트 응답 없음: ${chrome}`)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map<number, (m: any) => void>()
// 진행 중인 요청 (같은 id로 리다이렉트가 와도 하나로 센다) → 다 끝나고 잠잠하면 다 그린 것으로 본다
// 워커 스크립트(maplibre-gl-worker, 로더의 blob: 워커)는 워커가 받아 끝 알림이 페이지에 오지 않음 → http(s) 요청만, 워커 파일 빼고
const inflight = new Map<string, string>()
let lastNet = Date.now()
const counted = (url: string) => /^https?:/.test(url) && !/worker/i.test(url)
ws.addEventListener('message', e => {
  const m = JSON.parse(String(e.data))
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); return }
  if (m.method === 'Network.requestWillBeSent') { if (counted(m.params.request.url)) inflight.set(m.params.requestId, m.params.request.url) }
  else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inflight.delete(m.params.requestId)
  else return
  lastNet = Date.now()
})
// 페이지가 멈추면(WebGL 등) 답이 안 온다 → 30초 뒤 실패로
const send = (method: string, params = {}) => new Promise<any>((ok, fail) => {
  const id = ++seq
  const timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method}: 30초 응답 없음`)) }, 30000)
  pending.set(id, m => { clearTimeout(timer); m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result) })
  ws.send(JSON.stringify({ id, method, params }))
})
async function idle(quietMs = 2500, maxMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < maxMs && (inflight.size || Date.now() - lastNet < quietMs)) await sleep(250)
  if (inflight.size) console.log(`  기다림 초과, 남은 요청 ${inflight.size}개: ${[...inflight.values()].slice(0, 3).join(' ')}`)
}

// OSM 버튼 누르기 + 지도 위 도구·출처 표기 숨기기
const prepare = `
  [...document.querySelectorAll('[aria-label="배경지도"] button')].find(b => b.textContent.trim() === 'OSM')?.click()
  const s = document.createElement('style')
  s.textContent = '.float, .maplibregl-control-container, .ol-control, .ol-attribution, .cesium-viewer-bottom, .cesium-widget-credits { display: none !important }'
  document.head.append(s)`

await send('Page.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
try {
  for (const s of specs) {
    const name = `${s.category}-${s.id}`
    inflight.clear() // 앞 화면에서 끝나지 않은 요청은 버린다
    await send('Page.navigate', { url: `${site}/${s.category}/${s.id}/view?embed=1` })
    await sleep(3000) // 하이드레이션 전 클릭은 무시된다
    await idle()
    await send('Runtime.evaluate', { expression: prepare })
    for (let i = 0; i < (zoomIn[`${s.category}/${s.id}`] ?? 0); i++) {
      await send('Runtime.evaluate', { expression: `document.querySelector('[aria-label="확대"]').click()` })
      await sleep(1000)
    }
    await idle()
    await sleep(2000) // 마지막 타일을 그릴 시간
    const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 80, clip: { x: 0, y: 0, width: W, height: H, scale: 0.5 } })
    writeFileSync(join(out, `${name}.webp`), Buffer.from(data, 'base64'))
    console.log(`✓ ${name}`)
  }
} finally {
  ws.close()
  proc.kill()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
}
