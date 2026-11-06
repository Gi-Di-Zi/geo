// 이 PC의 QGIS에 저장소의 플러그인(qgis/)을 연결한다 (개발·시험용). 프로필 plugins 폴더에 바로가기(Windows junction·그 밖 symlink)를 만들어
// 저장소에서 고친 코드가 QGIS를 다시 켜면 바로 반영된다. 두 플러그인을 켜고 서버 칸을 로컬 서버로 맞춘다 (QGIS가 꺼져 있을 때만 설정 파일을 고친다).
// 사용: npm run qgis:dev [-- --server http://localhost:3000]   되돌리기: npm run qgis:dev -- --remove (바로가기만 지움)
import { execSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const remove = args.includes('--remove')
const server = args.includes('--server') ? args[args.indexOf('--server') + 1] ?? '' : 'http://localhost:3000'
const windows = platform() === 'win32'
const base = windows ? join(process.env.APPDATA ?? '', 'QGIS') : platform() === 'darwin' ? join(homedir(), 'Library/Application Support/QGIS') : join(homedir(), '.local/share/QGIS')

// QGIS 3·4 프로필 중 있는 것 모두 (기본 프로필)
const profiles = ['QGIS3', 'QGIS4'].flatMap(version => (existsSync(join(base, version, 'profiles', 'default')) ? [join(base, version, 'profiles', 'default')] : []))
const plugins = readdirSync(join(root, 'qgis')).filter(id => existsSync(join(root, 'qgis', id, 'metadata.txt')))
const isLink = (path: string) => { try { return lstatSync(path).isSymbolicLink() } catch { return false } }

/** QSettings INI 한 값 넣기·바꾸기 (줄바꿈 형식 유지) */
function setIni(text: string, section: string, key: string, value: string) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === `[${section}]`)

  if (start < 0) return [...lines.filter((line, i) => line || i < lines.length - 1), '', `[${section}]`, `${key}=${value}`, ''].join(newline)
  const after = lines.findIndex((line, i) => i > start && /^\[.*\]$/.test(line.trim()))
  const end = after < 0 ? lines.length : after
  const at = lines.findIndex((line, i) => i > start && i < end && line.startsWith(`${key}=`))

  if (at >= 0) lines[at] = `${key}=${value}`
  else lines.splice(lines.slice(0, end).findLastIndex(line => line.trim()) + 1, 0, `${key}=${value}`)

  return lines.join(newline)
}

if (!profiles.length) {
  console.error(`QGIS 프로필이 없습니다 (${base}). QGIS를 한 번 실행한 뒤 다시 하세요.`)
  process.exit(1)
}

for (const profile of profiles) {
  for (const id of plugins) {
    const link = join(profile, 'python', 'plugins', id)

    if (isLink(link)) unlinkSync(link)
    else if (existsSync(link)) {
      console.error(`${link}: 바로가기가 아닌 폴더가 있습니다 (ZIP·저장소로 설치한 플러그인). QGIS 플러그인 관리에서 지운 뒤 다시 하세요.`)
      process.exitCode = 1
      continue
    }

    if (remove) { console.log(`지움: ${link}`); continue }

    symlinkSync(join(root, 'qgis', id), link, windows ? 'junction' : 'dir')
    console.log(`연결: ${link} → qgis/${id}`)
  }

  if (remove) continue
  const running = /qgis/i.test(execSync(windows ? 'tasklist' : 'ps -A', { encoding: 'utf8' }))
  const ini = join(profile, 'QGIS', `${profile.includes('QGIS4') ? 'QGIS4' : 'QGIS3'}.ini`)

  if (running || !existsSync(ini)) {
    console.log(`QGIS가 켜져 있거나 설정 파일이 없어 설정은 고치지 않았습니다 → QGIS 플러그인 관리에서 두 플러그인을 켜고, 서버 칸에 ${server}를 넣으세요.`)
    continue
  }

  let text = readFileSync(ini, 'utf8')

  for (const id of plugins) text = setIni(setIni(text, 'PythonPlugins', id, 'true'), id, 'server', server)
  writeFileSync(ini, text)
  console.log(`설정: 두 플러그인 켬, 서버 ${server} (${ini})`)
}

if (!remove) console.log('QGIS를 켜면 웹 메뉴 → geo-web-bridge에 두 플러그인이 나옵니다. 코드를 고친 뒤에는 QGIS를 다시 켜세요.')
