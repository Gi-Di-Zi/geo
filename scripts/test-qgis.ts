// 이 PC에 설치된 QGIS로 플러그인 시험 두 가지:
//   1) 흐름: QGIS Python(화면 없음)으로 tests/qgis/plugins_test.py — 내보내기 → 실제 서버 변환 → 결과 레이어, 주소·코드 연계, 메뉴·대화상자
//   2) 데스크톱(Windows): 임시 프로필에 플러그인 바로가기를 두고 QGIS 데스크톱을 화면 없이 띄워 tests/qgis/desktop_check.py — 시작·웹 메뉴·오른쪽 패널·닫기
// 서버 = QGIS_TEST_URL (기본 http://localhost:3000, 실제 변환 작업자가 있어야 함). QGIS Python = QGIS_PYTHON 또는 자동으로 찾기. 사용자 프로필은 건드리지 않는다
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const server = process.env.QGIS_TEST_URL || 'http://localhost:3000'
const plugins = ['geo_web_bridge', 'geo_address_link']

/** QGIS Python 실행기: Windows는 Program Files\QGIS*\bin\python-qgis*.bat, macOS는 QGIS.app의 python3, 그 밖은 qgis 모듈이 있는 python3 */
function findPython() {
  if (process.env.QGIS_PYTHON) return process.env.QGIS_PYTHON

  if (process.platform === 'win32') {
    const programs = process.env.ProgramFiles || 'C:\\Program Files'

    for (const dir of readdirSync(programs).filter(name => /^QGIS/i.test(name)).sort().reverse()) {
      const bin = join(programs, dir, 'bin')
      const bat = existsSync(bin) ? readdirSync(bin).find(name => /^python-qgis.*\.bat$/i.test(name)) : undefined

      if (bat) return join(bin, bat)
    }

    return ''
  }

  const mac = existsSync('/Applications') ? readdirSync('/Applications').find(name => /^QGIS.*\.app$/.test(name)) : undefined

  return mac ? `/Applications/${mac}/Contents/MacOS/bin/python3` : 'python3'
}

/** .bat은 셸 없이 실행할 수 없다 → cmd /c에 그대로 넘긴다 */
const run = (command: string, args: string[], env: NodeJS.ProcessEnv = process.env) => (command.toLowerCase().endsWith('.bat')
  ? spawnSync('cmd.exe', ['/d', '/s', '/c', `"${[command, ...args].map(a => `"${a}"`).join(' ')}"`], { stdio: 'inherit', windowsVerbatimArguments: true, env })
  : spawnSync(command, args, { stdio: 'inherit', env }))

const python = findPython()

if (!python) {
  console.error('QGIS Python을 찾지 못했습니다. QGIS를 설치하거나 QGIS_PYTHON에 python-qgis.bat 등 경로를 넣으세요.')
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'geo-qgis-test-'))
const links: string[] = []

console.log(`QGIS Python: ${python}\n서버: ${server}\n\n[1] 흐름 시험`)

const flow = run(python, [join(root, 'tests/qgis/plugins_test.py'), join(root, 'qgis'), server, join(work, 'flow')].map(String), process.env)
let desktopOk = true

// python-qgis-ltr.bat → qgis-ltr.bat (같은 bin 폴더의 데스크톱 실행기)
const desktop = python.replace(/python-(qgis[^\\/]*\.bat)$/i, '$1')

if (process.platform === 'win32' && desktop !== python && existsSync(desktop)) {
  console.log('\n[2] QGIS 데스크톱 (임시 프로필)')
  const pluginDir = join(work, 'profiles', 'default', 'python', 'plugins')
  const out = join(work, 'desktop.txt')

  mkdirSync(pluginDir, { recursive: true })

  for (const id of plugins) {
    links.push(join(pluginDir, id))
    symlinkSync(join(root, 'qgis', id), join(pluginDir, id), 'junction')
  }

  // 실행기는 start /B로 띄우고 바로 끝난다 → 결과 파일을 기다린다 (최대 3분, 확인 스크립트가 쓰고 스스로 끝낸다)
  run(desktop, ['--profiles-path', work, '--nologo', '--noversioncheck', '--code', join(root, 'tests/qgis/desktop_check.py')], { ...process.env, GEO_CHECK_OUT: out, QT_QPA_PLATFORM: 'offscreen' })
  const until = Date.now() + 180_000

  while (!existsSync(out) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
  const text = existsSync(out) ? readFileSync(out, 'utf8') : '결과 없음 (3분 안에 QGIS가 확인 스크립트를 끝내지 못함)'

  console.log(text)
  desktopOk = text.includes('패널 탭: 1') && plugins.every(id => text.includes(`${id}: load=True start=True`) && new RegExp(`${id} 패널: .* right=True visible=True action=True`).test(text) && text.includes(`${id} 닫기: closed=True action=False errors=0`))
}

// 바로가기를 먼저 끊고 지운다 (저장소의 플러그인 원본은 그대로)
for (const link of links) unlinkSync(link)

rmSync(work, { recursive: true, force: true })

console.log(`\n흐름 ${flow.status === 0 ? '통과' : '실패'} · 데스크톱 ${desktopOk ? '통과' : '실패'}`)

process.exitCode = flow.status === 0 && desktopOk ? 0 : 1
