// 엔진 렌더러: 파이프라인 결과(3D Tiles·quantized-mesh 지형)를 Cesium for Unreal로 그려 스크린샷과 기록을 남긴다.
//   node scripts/unreal.ts setup                         플러그인 받기(GitHub 릴리스) + 에디터 타깃 빌드 + 실시간 보기용 시그널링 서버 받기·빌드
//   node scripts/unreal.ts <유형>/<확장자>[/<레시피>] | <유형> | all [--missing]   렌더링 → public/data/<유형>/<확장자>/<레시피>/unreal.png, unreal.json
//     --missing: 성공 기록이 있는 레시피는 건너뜀
//   node scripts/unreal.ts stream <유형>/<확장자>[/<레시피>]  실시간 보기: 시그널링 서버 + 언리얼(창 없음, 조작 가능)을 띄워 브라우저로 보냄 (Pixel Streaming 2). Ctrl+C로 종료
//   node scripts/unreal.ts stream --job <작업 폴더>          업로드 작업 결과 실시간 보기 (MCP geo_engine). 보는 사람이 ENGINE_IDLE_MIN(10)분 없으면 종료
// 언리얼 위치: .env UE_ROOT (기본 C:/Program Files/Epic Games/UE_5.8). 패키징 없이 에디터 실행 파일의 -game 모드로 돈다
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { engine, engineOutput, engineTarget, streamId } from '../shared/viewers.ts'
import type { EngineReport, FormatSpec, Job, Recipe, Report } from '../shared/types.ts'
import { loadFormats, writeStatus } from './pipeline.ts'

const root = resolve(import.meta.dirname, '..')
const project = join(root, 'pipeline/unreal/GeoRender')
const uproject = join(project, 'GeoRender.uproject')
const CESIUM = 'v2.30.0' // 언리얼 5.6~5.8용 빌드본이 있는 릴리스
// 실시간 보기: Epic 시그널링 서버·웹 플레이어 (PixelStreamingInfrastructure). 엔진 버전별 릴리스 — 언리얼을 바꾸면 같이 바꾼다
const PS = 'UE5.8-0.1.0'
const psDir = join(project, '../PixelStreaming')
const psServer = join(psDir, 'SignallingWebServer')
const STREAMER_PORT = 8888 // 언리얼 → 시그널링 서버 (127.0.0.1만)
const streamReady = () => existsSync(join(psServer, 'dist/index.js')) && existsSync(join(psServer, 'www/player.html'))
try { process.loadEnvFile(join(root, '.env')) } catch {}
export const UE_ROOT = process.env.UE_ROOT || 'C:/Program Files/Epic Games/UE_5.8'
const editor = join(UE_ROOT, 'Engine/Binaries/Win64/UnrealEditor.exe')
// 화면 크기. 웹 뷰어 시점(줌)을 같은 범위가 보이는 카메라 거리로 바꿀 때도 쓴다
const RES = [1280, 720] as const
const TIMEOUT_S = 900 // 첫 실행은 Cesium 재질 셰이더 컴파일 포함 (이후 캐시)
// 바닥 배경지도: OSM (VWorld 키는 등록 도메인 브라우저 요청만 받아 엔진에서는 못 씀). {reverseY}: 북쪽 0 (XYZ)
const BASEMAP = 'https://tile.openstreetmap.org/{z}/{x}/{reverseY}.png'

/** 언리얼·플러그인·빌드 상태. setup.ts가 단계를 건너뛸지 판단할 때도 쓴다 */
export function unrealState() {
  return {
    engine: existsSync(editor),
    plugin: existsSync(join(project, 'Plugins/CesiumForUnreal/CesiumForUnreal.uplugin')),
    built: existsSync(join(project, 'Binaries/Win64/UnrealEditor-GeoRender.dll')),
  }
}

function run(cmd: string, args: string[], bat = false, cwd?: string) {
  // .bat·.cmd(npm)는 셸로만 실행된다 (Node 보안 정책). 공백 있는 것만 따옴표로: 경로 없이 따옴표 친 "npm"은 cmd가 %~dp0을 현재 폴더로 잡아 깨진다
  const r = bat
    ? spawnSync([cmd, ...args].map(a => (a.includes(' ') ? `"${a}"` : a)).join(' '), { shell: true, stdio: 'inherit', cwd })
    : spawnSync(cmd, args, { stdio: 'inherit', cwd })
  if (r.status !== 0) throw new Error(`실패 (${r.status}): ${basename(cmd)} ${args.join(' ')}`)
}

export function setup() {
  if (process.platform !== 'win32') throw new Error('언리얼 렌더러는 Windows 전용 (UnrealEditor.exe)')
  if (!existsSync(editor)) throw new Error(`언리얼 없음: ${editor}\n  Epic Games Launcher → 언리얼 엔진 5.8 설치 (또는 .env UE_ROOT 지정)`)
  const { MajorVersion, MinorVersion } = JSON.parse(readFileSync(join(UE_ROOT, 'Engine/Build/Build.version'), 'utf8'))
  // 1) 플러그인: 엔진 버전별 빌드본 zip(최상위 CesiumForUnreal/)을 프로젝트 Plugins/에 푼다. Fab 로그인 불필요
  if (!unrealState().plugin) {
    const name = `CesiumForUnreal-${MajorVersion}${MinorVersion}-${CESIUM}.zip`
    const zip = join(project, '../_download', name)
    if (!existsSync(zip)) {
      console.log(`  · 플러그인 받기: ${name} (약 1.3GB)`)
      run('curl', ['-fSL', '--create-dirs', '-o', zip, `https://github.com/CesiumGS/cesium-unreal/releases/download/${CESIUM}/${name}`])
    }
    mkdirSync(join(project, 'Plugins'), { recursive: true })
    // Windows 기본 tar(bsdtar)만 zip을 푼다. Git Bash의 GNU tar는 못 푼다
    run('C:/Windows/System32/tar.exe', ['-xf', zip, '-C', join(project, 'Plugins')])
  }
  // 2) 에디터 타깃 빌드: -game을 에디터 실행 파일로 돌리므로 이 모듈 DLL만 있으면 된다
  console.log(`  · GeoRender 빌드 (언리얼 ${MajorVersion}.${MinorVersion})`)
  run(join(UE_ROOT, 'Engine/Build/BatchFiles/Build.bat'), ['GeoRenderEditor', 'Win64', 'Development', `-Project=${uproject}`, '-WaitMutex', '-NoHotReloadFromIDE'], true)
  // 3) 실시간 보기 서버 (Node만 필요)
  if (!streamReady()) buildStreamServer()
}

/**
 * 웹 지도 시점 → 카메라. MapLibre 줌 z에서 1px = 78271.5·cos(위도)/2^z m (512px 타일).
 * 화면 세로가 시야각 60°에 꼭 들어가는 거리 = (세로 m / 2) / tan(30°)
 */
function cameraOf(view: FormatSpec['view']) {
  const [lon, lat] = view.center
  const mpp = 78271.517 * Math.cos((lat * Math.PI) / 180) / 2 ** view.zoom
  return { lon, lat, height: view.height ?? 0, dist: (mpp * RES[1]) / 2 / Math.tan(Math.PI / 6), pitch: view.pitch ?? 0, bearing: view.bearing ?? 0 }
}

const recipeDir = (spec: FormatSpec, recipe: Recipe) => join(root, 'public/data', spec.category, spec.id, recipe.id)

/** 변환이 성공한 결과만 그린다 (없으면 엔진도 읽을 게 없다) */
function converted(spec: FormatSpec, recipe: Recipe) {
  const rep = join(recipeDir(spec, recipe), 'report.json')
  return existsSync(rep) && (JSON.parse(readFileSync(rep, 'utf8')) as Report).steps.every(st => st.code === 0)
}

/** 창 없는 -game 실행 + 장면(결과물 주소·카메라·배경지도). 스크린샷과 실시간 보기가 같이 쓴다. dir = 레시피 출력 폴더 (샘플 또는 업로드 작업) */
function sceneArgs(dir: string, recipe: Recipe, view: FormatSpec['view']) {
  const out = engineOutput(recipe)!
  const cam = cameraOf(view)
  const url = pathToFileURL(join(dir, engineTarget(out))).href
  return { url, args: [
    uproject, '-game', '-RenderOffscreen', `-ResX=${RES[0]}`, `-ResY=${RES[1]}`, '-windowed', '-unattended', '-nosound', '-NoSplash', '-NoLoadingScreen', '-log',
    `-Tileset=${url}`, `-Lon=${cam.lon}`, `-Lat=${cam.lat}`, `-Height=${cam.height}`, `-Dist=${cam.dist.toFixed(1)}`, `-Pitch=${cam.pitch}`, `-Bearing=${cam.bearing}`,
    `-Basemap=${BASEMAP}`, ...(out.kind === 'quantized-mesh' ? ['-Drape'] : []),
  ] }
}

function render(spec: FormatSpec, recipe: Recipe) {
  const dir = recipeDir(spec, recipe)
  const shot = join(dir, 'unreal.png')
  const report = join(dir, 'unreal.json')
  rmSync(shot, { force: true })
  rmSync(report, { force: true })
  const { url, args } = sceneArgs(dir, recipe, recipe.view ?? spec.view)
  const t0 = Date.now()
  const r = spawnSync(editor, [...args, `-Shot=${shot}`, `-Report=${report}`, `-Timeout=${TIMEOUT_S}`], { stdio: 'ignore', timeout: (TIMEOUT_S + 120) * 1000 })
  // 게임 모드가 기록을 못 남기고 죽으면(빌드 불일치·충돌) 여기서 실패 기록
  const rep: Omit<EngineReport, 'ranAt'> = existsSync(report)
    ? JSON.parse(readFileSync(report, 'utf8'))
    : { ok: false, url, loadMs: Date.now() - t0, gpu: '', engine: '', error: `실행 실패 (종료 코드 ${r.status ?? r.signal}). 로그: pipeline/unreal/GeoRender/Saved/Logs/GeoRender.log` }
  if (rep.ok && !existsSync(shot)) Object.assign(rep, { ok: false, error: '스크린샷 파일 없음' })
  const full: EngineReport = { ranAt: new Date().toISOString(), ...rep }
  writeFileSync(report, JSON.stringify(full, null, 2))
  return full
}

/** 시그널링 서버·웹 플레이어 받기 + 빌드 (처음 stream 때 한 번). 저장소 작업 공간 중 서버·플레이어에 쓰는 것만 (SFU의 mediasoup은 C++ 빌드 도구가 필요해 뺌) */
function buildStreamServer() {
  const zip = join(project, '../_download', `ps-${PS}.zip`)
  if (!existsSync(zip)) {
    console.log(`  · 시그널링 서버 받기: PixelStreamingInfrastructure ${PS}`)
    run('curl', ['-fSL', '--create-dirs', '-o', zip, `https://github.com/EpicGamesExt/PixelStreamingInfrastructure/releases/download/${PS}/${PS}.zip`])
  }
  rmSync(psDir, { recursive: true, force: true })
  mkdirSync(psDir, { recursive: true })
  run('C:/Windows/System32/tar.exe', ['-xf', zip, '-C', psDir, '--strip-components=1'])
  const ws = ['Common', 'Signalling', 'SignallingWebServer', 'Frontend/library', 'Frontend/ui-library', 'Frontend/implementations/typescript']
  run('npm', ['install', '--no-audit', '--no-fund', ...ws.flatMap(w => ['-w', w])], true, psDir)
  // 의존 순서대로. 웹 플레이어는 SignallingWebServer/www로 나온다
  for (const [w, script] of [['Common', 'build:cjs'], ['Common', 'build:esm'], ['Signalling', 'build:cjs'], ['SignallingWebServer', 'build'], ['Frontend/library', 'build:esm'], ['Frontend/ui-library', 'build:esm'], ['Frontend/implementations/typescript', 'build']]) {
    run('npm', ['run', script!, '-w', w!], true, psDir)
  }
}

/**
 * 실시간 보기: 시그널링 서버(웹 플레이어 포함) + 언리얼 대화형 모드. 언리얼 화면을 영상(WebRTC)으로 브라우저에 보내고 입력을 돌려받는다.
 * 플러그인은 이때만 명령줄로 켠다 → 스크린샷 렌더링은 그대로. 둘 중 하나가 끝나면 다른 하나도 끝낸다
 * ponytail: 같은 PC·내부망용 (STUN/TURN 없음). 밖에서 보려면 시그널링 서버 --peer_options에 TURN, 사이트가 HTTPS면 플레이어도 HTTPS
 */
async function stream(target: string) {
  const [cat, fmt, recipeId] = target.split('/')
  const spec = (await loadFormats()).find(f => !f.closed && f.category === cat && f.id === fmt)
  const recipe = spec?.recipes.find(r => (!recipeId || r.id === recipeId) && engineOutput(r))
  if (!spec || !recipe) throw new Error(`엔진으로 볼 레시피(3D Tiles·지형 결과) 없음: ${target}`)
  if (!converted(spec, recipe)) throw new Error(`변환 기록 없음 → npm run pipeline -- ${streamId(spec, recipe)}`)
  const id = streamId(spec, recipe)
  startStream(id, sceneArgs(recipeDir(spec, recipe), recipe, recipe.view ?? spec.view).args)
  console.log(`■ 실시간 보기 ${id}\n  · 사이트: 시각화·렌더링 → Cesium for Unreal → 실시간 보기\n  · 바로: http://localhost:${engine.streamPort}/?StreamerId=${encodeURIComponent(id)}\n  · 첫 실행은 셰이더 컴파일로 수 분. Ctrl+C로 종료`)
}

/** 보는 사람이 없으면 끄는 시간(분). 업로드 작업 실시간 보기만 (서버가 띄우고 잊어도 GPU를 계속 잡지 않게) */
const IDLE_MIN = Number(process.env.ENGINE_IDLE_MIN || 10)

/** 업로드 작업 결과 실시간 보기 (MCP geo_engine이 띄움, server/utils/engine.ts). 스트리머 ID = job-<작업 id 앞 8자> */
async function streamJob(dir: string) {
  const job: Job = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8'))
  const spec = (await loadFormats()).find(f => `${f.category}/${f.id}` === job.format)
  if (job.state !== 'done' || !job.recipe || !engineOutput(job.recipe) || !spec) throw new Error('엔진으로 볼 결과(3D Tiles·지형) 없음')
  startStream(`job-${job.id.slice(0, 8)}`, sceneArgs(join(dir, 'upload'), job.recipe, job.recipe.view ?? spec.view).args, IDLE_MIN)
  console.log(`■ 실시간 보기 job-${job.id.slice(0, 8)} (${job.name}). ${IDLE_MIN}분 동안 보는 사람이 없으면 종료`)
}

/** 시그널링 서버(웹 플레이어·상태 API /api) + 언리얼 대화형 모드. 둘 중 하나가 끝나면 다른 하나도 끝낸다. idle = 보는 사람이 없으면 끄는 시간(분) */
function startStream(id: string, args: string[], idle?: number) {
  if (!streamReady()) buildStreamServer()
  const server = spawn(process.execPath, ['dist/index.js', '--no_config', '--serve', '--rest_api', `--player_port=${engine.streamPort}`, `--streamer_port=${STREAMER_PORT}`, '--console_messages=basic'], { cwd: psServer, stdio: 'inherit' })
  const ue = spawn(editor, [...args, '-EnablePlugins=PixelStreaming2', `-PixelStreamingConnectionURL=ws://127.0.0.1:${STREAMER_PORT}`, `-PixelStreamingID=${id}`], { stdio: 'ignore' })
  let timer: NodeJS.Timeout | undefined
  const stop = () => { clearInterval(timer); server.kill(); ue.kill() }
  server.on('exit', stop)
  ue.on('exit', code => { console.log(`  · 언리얼 종료 (${code ?? '중지'}). 로그: pipeline/unreal/GeoRender/Saved/Logs/GeoRender.log`); stop() })
  process.on('SIGINT', stop)
  if (!idle) return
  // 플레이어(웹 페이지)가 하나도 안 붙은 채 idle분이 지나면 끈다. 언리얼이 준비되기 전(셰이더 컴파일)에도 페이지만 열려 있으면 기다린다
  let seen = Date.now()
  timer = setInterval(async () => {
    const players = await fetch(`http://127.0.0.1:${engine.streamPort}/api/players`).then(r => r.json() as Promise<unknown[]>, () => [])
    if (players.length) seen = Date.now()
    else if (Date.now() - seen > idle * 60_000) { console.log(`  · ${idle}분 동안 보는 사람 없음 → 종료`); stop() }
  }, 30_000)
}

async function main() {
  const [target = '', ...flags] = process.argv.slice(2)
  if (target === 'setup') return setup()
  if (!target) throw new Error('사용법: node scripts/unreal.ts setup | <유형>/<확장자>[/<레시피>] | <유형> | all | stream <유형>/<확장자>[/<레시피>]')
  const s = unrealState()
  if (!s.engine || !s.plugin || !s.built) throw new Error('언리얼 준비 안 됨 → node scripts/unreal.ts setup')
  if (target === 'stream') return flags[0] === '--job' ? streamJob(resolve(flags[1] ?? '')) : stream(flags[0] ?? '')
  const [cat, fmt, recipeId] = target.split('/')
  const specs = (await loadFormats()).filter(f => !f.closed && (cat === 'all' || (f.category === cat && (!fmt || f.id === fmt))))
  for (const spec of specs) {
    for (const recipe of spec.recipes.filter(r => (!recipeId || r.id === recipeId) && engineOutput(r))) {
      if (!converted(spec, recipe)) { console.log(`  · ${spec.category}/${spec.id}/${recipe.id}: 변환 기록 없음, 건너뜀`); continue }
      const prev = join(root, 'public/data', spec.category, spec.id, recipe.id, 'unreal.json')
      if (flags.includes('--missing') && existsSync(prev) && (JSON.parse(readFileSync(prev, 'utf8')) as EngineReport).ok) continue
      process.stdout.write(`■ ${spec.category}/${spec.id}/${recipe.id} … `)
      const r = render(spec, recipe)
      console.log(r.ok ? `✓ ${(r.loadMs / 1000).toFixed(1)}초 (${r.gpu})` : `✗ ${r.error}`)
    }
  }
  await writeStatus()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`✗ ${e.message}`); process.exit(1) })
}
