// 엔진 렌더러: 파이프라인 결과(3D Tiles·quantized-mesh 지형)를 Cesium for Unreal로 그려 스크린샷과 기록을 남긴다.
//   node scripts/unreal.ts setup                         플러그인 받기(GitHub 릴리스) + 에디터 타깃 빌드
//   node scripts/unreal.ts <유형>/<확장자>[/<레시피>] | <유형> | all [--missing]   렌더링 → public/data/<유형>/<확장자>/<레시피>/unreal.png, unreal.json
//     --missing: 성공 기록이 있는 레시피는 건너뜀
// 언리얼 위치: .env UE_ROOT (기본 C:/Program Files/Epic Games/UE_5.8). 패키징 없이 에디터 실행 파일의 -game 모드로 돈다
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { engineOutput, engineTarget } from '../shared/viewers.ts'
import type { EngineReport, FormatSpec, Recipe, Report } from '../shared/types.ts'
import { loadFormats, writeStatus } from './pipeline.ts'

const root = resolve(import.meta.dirname, '..')
const project = join(root, 'pipeline/unreal/GeoRender')
const uproject = join(project, 'GeoRender.uproject')
const CESIUM = 'v2.30.0' // 언리얼 5.6~5.8용 빌드본이 있는 릴리스
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

function run(cmd: string, args: string[], bat = false) {
  // .bat은 셸로만 실행된다 (Node 보안 정책). 공백 있는 경로는 따옴표로
  const r = bat
    ? spawnSync([cmd, ...args].map(a => `"${a}"`).join(' '), { shell: true, stdio: 'inherit' })
    : spawnSync(cmd, args, { stdio: 'inherit' })
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

function render(spec: FormatSpec, recipe: Recipe) {
  const dir = join(root, 'public/data', spec.category, spec.id, recipe.id)
  const out = engineOutput(recipe)!
  const target = join(dir, engineTarget(out))
  const shot = join(dir, 'unreal.png')
  const report = join(dir, 'unreal.json')
  rmSync(shot, { force: true })
  rmSync(report, { force: true })
  const cam = cameraOf(recipe.view ?? spec.view)
  const url = pathToFileURL(target).href
  const t0 = Date.now()
  const r = spawnSync(editor, [
    uproject, '-game', '-RenderOffscreen', `-ResX=${RES[0]}`, `-ResY=${RES[1]}`, '-windowed', '-unattended', '-nosound', '-NoSplash', '-NoLoadingScreen', '-log',
    `-Tileset=${url}`, `-Lon=${cam.lon}`, `-Lat=${cam.lat}`, `-Height=${cam.height}`, `-Dist=${cam.dist.toFixed(1)}`, `-Pitch=${cam.pitch}`, `-Bearing=${cam.bearing}`,
    `-Shot=${shot}`, `-Report=${report}`, `-Timeout=${TIMEOUT_S}`,
    `-Basemap=${BASEMAP}`, ...(out.kind === 'quantized-mesh' ? ['-Drape'] : []),
  ], { stdio: 'ignore', timeout: (TIMEOUT_S + 120) * 1000 })
  // 게임 모드가 기록을 못 남기고 죽으면(빌드 불일치·충돌) 여기서 실패 기록
  const rep: Omit<EngineReport, 'ranAt'> = existsSync(report)
    ? JSON.parse(readFileSync(report, 'utf8'))
    : { ok: false, url, loadMs: Date.now() - t0, gpu: '', engine: '', error: `실행 실패 (종료 코드 ${r.status ?? r.signal}). 로그: pipeline/unreal/GeoRender/Saved/Logs/GeoRender.log` }
  if (rep.ok && !existsSync(shot)) Object.assign(rep, { ok: false, error: '스크린샷 파일 없음' })
  const full: EngineReport = { ranAt: new Date().toISOString(), ...rep }
  writeFileSync(report, JSON.stringify(full, null, 2))
  return full
}

async function main() {
  const [target = '', ...flags] = process.argv.slice(2)
  if (target === 'setup') return setup()
  if (!target) throw new Error('사용법: node scripts/unreal.ts setup | <유형>/<확장자>[/<레시피>] | <유형> | all')
  const s = unrealState()
  if (!s.engine || !s.plugin || !s.built) throw new Error('언리얼 준비 안 됨 → node scripts/unreal.ts setup')
  const [cat, fmt, recipeId] = target.split('/')
  const specs = (await loadFormats()).filter(f => !f.closed && (cat === 'all' || (f.category === cat && (!fmt || f.id === fmt))))
  for (const spec of specs) {
    for (const recipe of spec.recipes.filter(r => (!recipeId || r.id === recipeId) && engineOutput(r))) {
      // 변환이 성공한 결과만 그린다 (없으면 엔진도 읽을 게 없다)
      const rep = join(root, 'public/data', spec.category, spec.id, recipe.id, 'report.json')
      const ok = existsSync(rep) && (JSON.parse(readFileSync(rep, 'utf8')) as Report).steps.every(st => st.code === 0)
      if (!ok) { console.log(`  · ${spec.category}/${spec.id}/${recipe.id}: 변환 기록 없음, 건너뜀`); continue }
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
