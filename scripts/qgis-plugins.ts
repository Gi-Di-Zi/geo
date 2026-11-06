// QGIS 사용자 지정 플러그인 저장소: qgis/<플러그인>/를 zip으로 묶고 plugins.xml 하나로 목록 → server/assets/qgis/ (server/routes/qgis/[file].get.ts가 /qgis/plugins.xml로 제공.
// 정적 폴더 public/qgis로 두면 안내 화면 /qgis와 경로가 겹친다)
// QGIS: 플러그인 → 플러그인 관리 및 설치 → 설정 → 저장소 추가 → https://geospatial.kro.kr/qgis/plugins.xml
// 설치(postinstall)·빌드(prebuild) 때 실행. 결과는 Git에 넣지 않는다. 내려받기 주소의 서버 자리(__GEO_ORIGIN__)는 응답할 때 그 서버 주소로 채운다
import { copyFileSync, createWriteStream, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import archiver from 'archiver'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(root, 'qgis')
const out = join(root, 'server/assets/qgis')
const today = new Date().toISOString().slice(0, 10)
const cdata = (text: string) => `<![CDATA[${text.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/** metadata.txt [general]의 key=value */
function metadata(dir: string) {
  return Object.fromEntries(readFileSync(join(dir, 'metadata.txt'), 'utf8').split(/\r?\n/).flatMap(line => {
    const at = line.indexOf('=')

    return at > 0 && !line.startsWith('[') ? [[line.slice(0, at).trim(), line.slice(at + 1).trim()]] : []
  }))
}

/** QGIS 버전 3.28 → 3.28.0 (plugins.xml은 세 자리) */
const full = (version: string) => [...version.split('.'), '0', '0'].slice(0, 3).join('.')

rmSync(out, { recursive: true, force: true })

mkdirSync(out, { recursive: true })

const entries: string[] = []

for (const id of readdirSync(source).filter(name => !name.startsWith('.') && !name.startsWith('_')).sort()) {
  const m = metadata(join(source, id))
  const file = `${id}.${m.version}.zip`
  const zip = archiver('zip', { zlib: { level: 9 } })
  const stream = createWriteStream(join(out, file))
  // 파일이 다 쓰여 닫힐 때까지 (archiver의 end는 압축 출력 끝일 뿐)
  const done = new Promise<void>((resolve, reject) => { zip.on('error', reject); stream.on('error', reject); stream.on('close', resolve) })

  zip.pipe(stream)
  // zip 안 맨 위 폴더 = 플러그인 id (QGIS가 그 이름으로 설치)
  zip.glob('**/*', { cwd: join(source, id), ignore: ['**/__pycache__/**', '**/*.pyc'] }, { prefix: id })
  void zip.finalize()
  await done
  // 버전 없는 최신본: 사이트의 ZIP 설치 안내가 가리킨다
  copyFileSync(join(out, file), join(out, `${id}.zip`))

  entries.push(`  <pyqgis_plugin name="${esc(m.name)}" version="${esc(m.version)}">
    <description>${cdata(m.description)}</description>
    <about>${cdata(m.about)}</about>
    <version>${esc(m.version)}</version>
    <trusted>False</trusted>
    <qgis_minimum_version>${full(m.qgisMinimumVersion)}</qgis_minimum_version>
    <qgis_maximum_version>${full(m.qgisMaximumVersion)}</qgis_maximum_version>
    <homepage>${esc(m.homepage)}</homepage>
    <file_name>${file}</file_name>
    <icon></icon>
    <author_name>${esc(m.author)}</author_name>
    <download_url>__GEO_ORIGIN__/qgis/${file}</download_url>
    <uploaded_by>${esc(m.author)}</uploaded_by>
    <create_date>${today}</create_date>
    <update_date>${today}</update_date>
    <experimental>${m.experimental}</experimental>
    <deprecated>${m.deprecated}</deprecated>
    <tracker>${esc(m.tracker)}</tracker>
    <repository>${esc(m.repository)}</repository>
    <tags>${esc(m.tags)}</tags>
    <downloads>0</downloads>
    <average_vote>0</average_vote>
    <rating_votes>0</rating_votes>
    <external_dependencies></external_dependencies>
    <server>False</server>
  </pyqgis_plugin>`)
  console.log(`${id} ${m.version} → /qgis/${file}`)
}

writeFileSync(join(out, 'plugins.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<plugins>\n${entries.join('\n')}\n</plugins>\n`)
