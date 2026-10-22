// catalog 일관성 + 수집·변환 기록 검사. 문제가 있으면 exit 1
// 열린 확장자: 재배포 가능 원본, 수집 기록 = 원본 폴더, 원본 다운로드 가능, 레시피 기록이 지금 명령과 같고 성공·출력 있음
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { categories } from '../shared/catalog/categories.ts'
import { origins } from '../shared/catalog/origins.ts'
import { sources } from '../shared/catalog/sources.ts'
import { tools } from '../shared/catalog/tools.ts'
import { engineOutput, viewerKinds } from '../shared/viewers.ts'
import type { CollectReport, EngineReport, Recipe, Report, Step, ViewerId } from '../shared/types.ts'
import { loadFormats, sameCommands } from './pipeline.ts'

const root = resolve(import.meta.dirname, '..')
const problems: string[] = []
const bad = (msg: string) => problems.push(msg)

const checkSteps = (at: string, steps: Step[]) => {
  for (const s of steps) {
    const t = tools.find(t => t.id === s.tool)
    if (!t) bad(`${at}: 없는 도구 '${s.tool}'`)
    else if (!t.image) bad(`${at}: '${t.id}' 실행 이미지 없음 — 단계에 쓸 수 없음`)
  }
}

const checkViewers = (at: string, r: Recipe) => {
  for (const [v, use] of Object.entries(r.viewers) as [ViewerId, (typeof r.viewers)[ViewerId]][]) {
    if (!('output' in use)) continue
    const o = r.outputs.find(o => o.id === use.output)
    if (!o) bad(`${at}: ${v} 뷰어 → 없는 출력 '${use.output}'`)
    else if (!viewerKinds[v].includes(o.kind)) bad(`${at}: ${v} 뷰어는 '${o.kind}' 미지원`)
  }
}

// 서버 도구의 이미지는 compose.yaml이 실제로 띄우는 것과 같아야 한다 (도구 화면에 실행 이미지로 나온다)
const composeFile = readFileSync(join(root, 'compose.yaml'), 'utf8')
for (const t of tools) if (t.endpoint && !composeFile.includes(`image: ${t.image}`)) bad(`tools.ts ${t.id}: 이미지 ${t.image}가 compose.yaml과 다름`)

// 서버 레이어(DB 표·GeoServer 레이어·martin 소스)는 서버 하나에 모이므로 확장자끼리 이름이 겹치면 서로 덮어쓴다
const serverLayers = new Map<string, string>()

for (const f of await loadFormats()) {
  const at = `${f.category}/${f.id}`
  for (const r of f.closed ? [] : f.recipes) {
    for (const o of r.outputs) {
      if (!o.path.startsWith('/svc/') || !o.layer) continue
      const key = `${o.path.split('/')[2]}:${o.layer}`
      const other = serverLayers.get(key)
      if (other && other !== at) bad(`${at}/${r.id}: 서버 레이어 이름 '${o.layer}'이 ${other}와 겹침`)
      serverLayers.set(key, at)
    }
  }
  if (!categories.some(c => c.id === f.category)) bad(`${at}: 없는 유형 '${f.category}'`)
  if (!origins[f.id]) bad(`${at}: origins.ts에 출신(표준/회사) 없음`)
  const src = sources.find(s => s.id === f.collect.source)
  if (!src) bad(`${at}: 없는 수급처 '${f.collect.source}'`)
  else if (src.redistribute === 'no') bad(`${at}: 재배포 불가 출처(${src.name})를 샘플로 사용`)
  for (const o of f.otherSources) if (!sources.some(s => s.id === o.source)) bad(`${at}: 없는 수급처 '${o.source}'`)
  for (const a of f.alternatives) if (!tools.some(t => t.id === a.tool)) bad(`${at}: 없는 대안 도구 '${a.tool}'`)
  checkSteps(`${at} 수집`, f.collect.steps)

  // 닫아 둔 확장자(샘플 없음)는 수집·변환 결과를 따지지 않는다
  const pub = join(root, 'public/data', f.category, f.id)
  if (!f.closed) {
    // 국내 공공 → 해외 → 기타 순. 국내에서 로그인 없이 받는 같은 형식이 있는데 해외·기타 샘플이면 이유(noDomestic)를 남긴다
    if (src && src.scope !== 'domestic' && !f.noDomestic && f.otherSources.some(o => sources.find(s => s.id === o.source)?.scope === 'domestic')) bad(`${at}: 국내 수급처가 있는데 해외·기타 샘플 — noDomestic에 이유`)
    // 수집 기록 = 원본 폴더, 사이트에서 받을 수 있는지
    const cj = join(pub, 'collect.json')
    if (!existsSync(cj)) bad(`${at}: 수집 기록 없음 (npm run pipeline -- ${at} --recollect)`)
    else {
      const collect = JSON.parse(readFileSync(cj, 'utf8')) as CollectReport
      const rawDir = join(root, 'pipeline/raw', f.category, f.id)
      const raw = existsSync(rawDir) ? readdirSync(rawDir, { recursive: true, encoding: 'utf8' }).filter(n => statSync(join(rawDir, n)).isFile()).map(n => n.replaceAll('\\', '/')).sort() : []
      const listed = collect.files.map(x => x.name).sort()
      if (JSON.stringify(raw) !== JSON.stringify(listed)) bad(`${at}: 수집 기록(${listed.length}개)과 원본 폴더(${raw.length}개)가 다름 — 단계가 원본 폴더에 파일을 남겼는지 확인`)
      if (collect.published && (listed.length > 6 ? !existsSync(join(pub, 'raw.zip')) : listed.some(n => !existsSync(join(pub, 'raw', n))))) bad(`${at}: 내려받을 원본이 public에 없음`)
    }
  }
  for (const r of f.closed ? [] : f.recipes) {
    const rat = `${at}/${r.id}`
    checkSteps(rat, [...r.preprocess, ...r.convert])
    checkViewers(rat, r)
    const file = join(pub, r.id, 'report.json')
    if (!existsSync(file)) { bad(`${rat}: 아직 변환하지 않음 (npm run pipeline -- ${rat})`); continue }
    const report = JSON.parse(readFileSync(file, 'utf8')) as Report
    if (report.outputs.length !== r.outputs.length) bad(`${rat}: 마지막 변환 실패 (report.json 확인)`)
    if (!sameCommands(r, report)) bad(`${rat}: 명령이 마지막 실행과 다름 (npm run pipeline -- ${rat})`)
    for (const s of report.steps) if (s.code !== 0) bad(`${rat}: "${s.title}" 종료 코드 ${s.code}`)
    // 엔진 렌더러 기록 (scripts/unreal.ts). 언리얼이 없는 PC에서는 없어도 된다
    const engineFile = join(pub, r.id, 'unreal.json')
    if (existsSync(engineFile)) {
      const e = JSON.parse(readFileSync(engineFile, 'utf8')) as EngineReport
      if (!engineOutput(r)) bad(`${rat}: 엔진 대상 아닌 레시피에 unreal.json`)
      else if (!e.ok) bad(`${rat}: 엔진 렌더링 실패 — ${e.error} (npm run unreal -- ${rat})`)
      else if (!existsSync(join(pub, r.id, 'unreal.png'))) bad(`${rat}: 엔진 스크린샷 없음`)
    }
    for (const o of r.outputs) {
      // 서버 출력은 pipeline이 확인 요청으로 검사했다 (report.outputs). 여기서는 그 서버가 주소를 갖는지만
      if (o.path.startsWith('/svc/')) { if (!tools.find(t => t.id === o.path.split('/')[2])?.endpoint) bad(`${rat}: 주소(endpoint) 없는 서버 ${o.path}`) }
      else if (!existsSync(join(pub, r.id, o.path.split('{')[0]!))) bad(`${rat}: 출력 없음 ${o.path}`)
    }
  }

  // 업로드 레시피: 올린 파일($INPUT)만 읽고, 네트워크 없이 돈다
  if (!f.upload) { bad(`${at}: upload 없음 (안 받으면 unsupported에 이유)`); continue }
  if (!('recipe' in f.upload)) continue
  const u = f.upload.recipe
  const uat = `${at} 업로드`
  for (const e of f.upload.accept) if (e !== '.zip' && !f.extensions.includes(e)) bad(`${uat}: 확장자 목록에 없는 '${e}' 허용`)
  checkSteps(uat, [...u.preprocess, ...u.convert])
  checkViewers(uat, u)
  if (![...u.preprocess, ...u.convert].some(s => s.run.includes('$INPUT'))) bad(`${uat}: 올린 파일($INPUT) 읽는 단계 없음`)
  for (const s of [...u.preprocess, ...u.convert]) {
    if (/\/raw\/(?!input)/.test(s.run)) bad(`${uat}: 샘플 원본 경로 읽음 (${s.title})`)
    const type = tools.find(t => t.id === s.tool)?.type
    if (type === 'db' || type === 'server') bad(`${uat}: 업로드에 DB·서버 도구 사용 불가 (${s.title})`)
  }
}

// 문자열 안의 \( \[ 는 JS가 백슬래시를 지워 ( [ 가 된다. 정규식·셸에 넘기려면 \\( 로 써야 한다 (grep 오류는 파이프 뒤에 숨는다)
const catalogDir = join(root, 'shared/catalog')
for (const f of readdirSync(catalogDir, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.ts'))) {
  readFileSync(join(catalogDir, f), 'utf8').split('\n').forEach((line, i) => {
    const at = `shared/catalog/${f.replaceAll('\\', '/')}:${i + 1}`
    if (/(^|[^\\])\\[([.]/.test(line)) bad(`${at}: 문자열 안의 백슬래시 하나(\\( \\[ \\.)는 사라짐. 두 개로`)
    // 설명 문구는 단어로 끝낸다 (~요·~니다 금지). 명령(run)·주석은 보지 않는다
    if (!/^\s*(\/\/|\*|run:)/.test(line) && /(?<![필중소수개])요[.'"`]|니다[.'"`]/.test(line)) bad(`${at}: 설명 문구 말투(~요·~니다) → 단어로 끝내기`)
  })
}

console.log(problems.length ? problems.map(p => `✗ ${p}`).join('\n') : '✓ 문제 없음')
process.exit(problems.length ? 1 : 0)
