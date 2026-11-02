// 받은 저장소를 바로 띄운다: 점검 → .env → 서버 → 데이터 수집·변환 → 검사 → 사이트 실행.
//   npm run setup                    기본 흐름. 다시 돌려도 이미 성공한 수집·변환은 건너뛰어 빠르다
//   npm run setup -- <단계…>         골라서: doctor env services data unreal check serve
//   npm run setup -- data --force    변환을 처음부터 전부 다시
// 엔진 렌더러(unreal)는 언리얼을 레시피마다 띄웠다 닫아 기본 흐름에서 빼고, 단계 이름을 줄 때만 돈다.
// 프로그램 설치(Node·Docker·Visual Studio·Epic)는 scripts/setup.ps1 (Windows)
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadFormats } from './pipeline.ts'
import { UE_ROOT, setup as unrealSetup, unrealState } from './unreal.ts'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const force = args.includes('--force')
const node = (script: string, ...a: string[]) => spawnSync(process.execPath, [join(root, script), ...a], { cwd: root, stdio: 'inherit' }).status === 0
const ok = (cmd: string, a: string[]) => spawnSync(cmd, a, { stdio: 'ignore' }).status === 0
const title = (s: string) => console.log(`\n━━ ${s}`)

const steps: Record<string, () => Promise<boolean> | boolean> = {
  doctor() {
    title('점검')
    // 필수: .ts 스크립트를 node로 바로 실행(타입 제거)하는 22.18+. 권장: Nuxt 4 지원 버전 22.21+ / 24.11+ (package.json engines)
    const [major, minor] = process.versions.node.split('.').map(Number) as [number, number]
    const nodeOk = major > 22 || (major === 22 && minor >= 18)
    const nodeBest = (major === 22 && minor >= 21) || (major === 24 && minor >= 11) || major > 24
    const u = unrealState()
    const rows: [string, boolean, string, boolean?][] = [
      ['Node', nodeOk, `${process.versions.node}${nodeBest ? '' : nodeOk ? ' (동작함, Nuxt 경고 — 22.21+ 또는 24.11+ 권장)' : ' → 22.18 이상 필요'}`],
      ['Docker', ok('docker', ['info']), 'Docker Desktop 실행 중이어야 함'],
      ['Docker Compose', ok('docker', ['compose', 'version']), 'compose v2'],
      ['node_modules', existsSync(join(root, 'node_modules')), 'npm install'],
      ['언리얼', u.engine, u.engine ? `${UE_ROOT}${u.built ? ', 렌더러 빌드됨' : ''}` : '없음 (선택 — 엔진 렌더러만 못 씀)', true],
    ]
    for (const [name, pass, note, optional] of rows) console.log(`  ${pass ? '✓' : optional ? '·' : '✗'} ${name}: ${note}`)
    return rows.every(([, pass, , optional]) => pass || optional)
  },
  env() {
    title('.env')
    const env = join(root, '.env')
    if (!existsSync(env)) {
      copyFileSync(join(root, '.env.example'), env)
      console.log('  · .env.example → .env 복사')
    }
    const empty = readFileSync(env, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=\s*$/.test(l)).map(l => l.split('=')[0])
    if (empty.length) console.log(`  · 비어 있는 값: ${empty.join(', ')} — 모두 선택 (VWorld 키 없으면 배경지도 OSM, 나머지는 .env.example 설명)`)
    return true
  },
  services() {
    title('서버 (PostGIS, GeoServer, martin)')
    return spawnSync('docker', ['compose', 'up', '-d', '--wait'], { cwd: root, stdio: 'inherit' }).status === 0
  },
  async data() {
    // 확장자 하나씩: 하나가 실패해도(원본 사이트 변경 등) 나머지는 계속, 끝에 모아서 보고
    title(`데이터 수집·변환${force ? ' (전부 다시)' : ' (최신 기록 있는 레시피는 건너뜀)'}`)
    const failed: string[] = []
    for (const f of (await loadFormats()).filter(f => !f.closed)) {
      if (!node('scripts/pipeline.ts', `${f.category}/${f.id}`, ...(force ? [] : ['--missing']))) failed.push(`${f.category}/${f.id}`)
    }
    node('scripts/pipeline.ts', '--status')
    if (failed.length) console.log(`  ✗ 실패: ${failed.join(', ')} — npm run pipeline -- <유형>/<확장자> 로 다시`)
    return !failed.length
  },
  unreal() {
    title('엔진 렌더러 (Cesium for Unreal)')
    if (!unrealState().engine) {
      console.log(`  · 언리얼 없음 (${UE_ROOT}) → 건너뜀. 설치: ${process.platform === 'win32' ? 'scripts/setup.ps1 -Unreal' : 'Epic Linux 빌드본(UE 5.8)을 풀고 .env UE_ROOT'}`)
      return true
    }
    if (!unrealState().built) unrealSetup()
    return node('scripts/unreal.ts', 'all', ...(force ? [] : ['--missing']))
  },
  check() {
    title('검사')
    return node('scripts/check.ts')
  },
  serve() {
    // 마지막 단계: 개발 서버를 띄워 둔 채 끝나지 않는다 (Ctrl+C로 종료)
    title('사이트 실행 → http://localhost:3000')
    return node('node_modules/nuxt/bin/nuxt.mjs', 'dev')
  },
}

const DEFAULT = ['doctor', 'env', 'services', 'data', 'check', 'serve']
const picked = args.filter(a => !a.startsWith('--'))
const unknown = picked.filter(s => !(s in steps))
if (unknown.length) {
  console.error(`✗ 없는 단계: ${unknown.join(', ')} (가능: ${Object.keys(steps).join(' ')})`)
  process.exit(1)
}
const plan = picked.length ? picked : DEFAULT
const results: [string, boolean][] = []
for (const name of plan.filter(n => n !== 'serve')) {
  let pass = false
  try { pass = await steps[name]!() } catch (e: any) { console.error(`  ✗ ${e.message}`) }
  results.push([name, pass])
  // 점검·서버가 실패하면 뒤 단계는 의미 없다
  if (!pass && (name === 'doctor' || name === 'services')) break
}
if (results.length) console.log(`\n━━ 결과\n${results.map(([n, p]) => `  ${p ? '✓' : '✗'} ${n}`).join('\n')}`)
// 데이터·검사 실패가 있어도 사이트는 띄운다 (실패한 확장자만 비어 보임). 점검·서버 실패면 띄우지 않는다
const blocked = results.some(([n, p]) => !p && (n === 'doctor' || n === 'services'))
if (plan.includes('serve') && !blocked) steps.serve!()
process.exit(results.every(([, p]) => p) ? 0 : 1)
