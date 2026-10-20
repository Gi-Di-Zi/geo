// 수집 → 전처리 → 웹 변환 실행기. catalog의 Step.run 문자열을 그대로 Docker 안에서 실행하고 실측 기록(report.json)을 남긴다.
// 사용: node scripts/pipeline.ts <category/format[/recipe]> | <category> | all [--recollect]
//       node scripts/pipeline.ts --status                  (현황 status.json만 다시 쓰기)
//       node scripts/pipeline.ts --job <.data/jobs/<id>>   (업로드 작업. 서버가 띄운다)
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sources } from '../shared/catalog/sources.ts'
import { tools } from '../shared/catalog/tools.ts'
import type { CollectReport, FormatSpec, Job, Output, Recipe, Report, StatusEntry, Step } from '../shared/types.ts'

const root = resolve(import.meta.dirname, '..')
// 원본을 사이트에서 바로 받게 하는 크기 상한 (넘으면 출처에서 받게 안내)
const PUBLISH_LIMIT = 50 * 1024 * 1024
const localImages: Record<string, { tag: string; context: string }> = {
  'local:tools': { tag: 'geo-web/tools', context: join(root, 'pipeline') },
  'local:tippecanoe': { tag: 'geo-web/tippecanoe', context: 'https://github.com/felt/tippecanoe.git#2.79.0' },
}

// DB 단계용 PostGIS. 레시피가 DB 도구를 쓰면 잠깐 띄우고 단계 컨테이너를 같은 네트워크에 붙인다
const DB = { name: 'geo-postgis', net: 'geo-net', image: 'postgis/postgis:18-3.6' }
const DB_ENV = { PGHOST: DB.name, PGUSER: 'postgres', PGPASSWORD: 'geo', PGDATABASE: 'gis' }
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const usesDb = (steps: Step[]) => steps.some(s => tools.find(t => t.id === s.tool)?.type === 'db' || s.tool === 'psycopg')
const usesServer = (steps: Step[]) => steps.some(s => tools.find(t => t.id === s.tool)?.type === 'server')

// 서비스 레시피: compose.yaml의 상시 서버(PostGIS·GeoServer·martin)에 적재·발행한다. 단계 컨테이너는 그 네트워크에 붙는다
type Net = { name: string; env: Record<string, string> }
const SVC: Net = { name: 'geo-svc', env: { PGHOST: 'db', PGUSER: 'postgres', PGPASSWORD: 'geo', PGDATABASE: 'gis' } }
const compose = (...args: string[]) => {
  const r = spawnSync('docker', ['compose', '-f', join(root, 'compose.yaml'), ...args], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`docker compose ${args.join(' ')} 실패`)
}

function startDb(db: Recipe['db']) {
  stopDb()
  spawnSync('docker', ['network', 'create', DB.net])
  const env = Object.entries(db?.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const r = spawnSync('docker', ['run', '-d', '--name', DB.name, '--network', DB.net, '-e', `POSTGRES_PASSWORD=${DB_ENV.PGPASSWORD}`, '-e', `POSTGRES_DB=${DB_ENV.PGDATABASE}`, ...env, db?.image ?? DB.image], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`PostGIS를 띄우지 못했어요: ${r.stderr}`)
  // 초기화 중인 임시 서버는 TCP를 열지 않으므로, TCP로 응답할 때까지 기다린다
  for (let i = 0; i < 90; i++) {
    if (spawnSync('docker', ['exec', DB.name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) break
    sleep(1000)
  }
  spawnSync('docker', ['exec', DB.name, 'psql', '-U', 'postgres', '-d', DB_ENV.PGDATABASE, '-c', 'CREATE EXTENSION IF NOT EXISTS postgis_sfcgal'])
  console.log(`  · PostGIS 준비 (${DB.name})`)
}

function stopDb() {
  // -v: postgres 이미지가 만드는 익명 볼륨까지 지운다 (안 지우면 실행마다 수백 MB씩 남는다)
  spawnSync('docker', ['rm', '-f', '-v', DB.name])
}

export async function loadFormats(): Promise<FormatSpec[]> {
  const dir = join(root, 'shared/catalog')
  // <category>/<format>.ts만 spec이다. _로 시작하는 파일은 spec을 만드는 도우미
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(f => /[\\/][^_\\/][^\\/]*\.ts$/.test(f))
  return Promise.all(files.map(async f => (await import(pathToFileURL(join(dir, f)).href)).default as FormatSpec))
}

function imageOf(image: string) {
  const local = localImages[image]
  if (!local) return image
  if (spawnSync('docker', ['image', 'inspect', local.tag]).status !== 0) {
    console.log(`  · 로컬 이미지 빌드: ${local.tag}`)
    const r = spawnSync('docker', ['build', '-t', local.tag, local.context], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error(`${local.tag} 빌드 실패`)
  }
  return local.tag
}

/** 업로드 작업: 올린 파일 경로($INPUT)와 컨테이너 이름. 네트워크를 끊고 자원·시간을 제한해 돌린다 */
interface JobRun { input: string; name: string }
const JOB_STEP_TIMEOUT = 20 * 60_000

function runStep(step: Step, mounts: Record<string, string>, net?: Net, job?: JobRun) {
  const tool = tools.find(t => t.id === step.tool)
  if (!tool?.image) throw new Error(`실행 이미지가 없는 도구예요: ${step.tool}`)
  // 서버 도구 단계는 떠 있는 서버에 HTTP로 요청한다 (서버 이미지가 아니라 curl 이미지에서)
  const server = tool.type === 'server'
  if (server && tool.restart) { compose('restart', tool.id); compose('up', '-d', '--wait', tool.id) }
  const args = ['run', '--rm', '--entrypoint', 'sh', '-w', '/work']
  // 업로드 작업은 원본·스크립트를 읽기 전용으로 붙인다
  for (const [to, from] of Object.entries(mounts)) args.push('-v', `${from}:${to}${job && (to === '/raw' || to === '/scripts') ? ':ro' : ''}`)
  // Java 도구(mago)는 기본으로 메모리 한도의 1/4만 힙으로 써서, 한도 안에서 75%까지 쓰게 한다
  if (job) args.push('--name', job.name, '--hostname', 'localhost', '--network', 'none', '--memory', '4g', '--cpus', '2', '--pids-limit', '1024', '-e', 'JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=75', '-e', `INPUT=${job.input}`)
  else for (const k of ['VWORLD_KEY', 'DATA_GO_KR_KEY']) if (process.env[k]) args.push('-e', k)
  if (net) { args.push('--network', net.name); for (const [k, v] of Object.entries(net.env)) args.push('-e', `${k}=${v}`) }
  if (server) args.push('-e', `GEOSERVER_ADMIN_PASSWORD=${process.env.GEOSERVER_ADMIN_PASSWORD || 'geoserver'}`)
  args.push(imageOf(server ? tools.find(t => t.id === 'curl')!.image! : tool.image), '-c', (tool.prelude ?? '') + step.run)
  console.log(`  ▸ ${step.title}`)
  const t0 = Date.now()
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1 << 30, timeout: job && JOB_STEP_TIMEOUT })
  if (job && r.error) spawnSync('docker', ['rm', '-f', job.name])
  const late = job && r.error ? `\n시간 제한(${JOB_STEP_TIMEOUT / 60_000}분) 초과로 중단.` : ''
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}${late}`.trimEnd().split('\n').slice(-40).join('\n')
  const result = { ms: Date.now() - t0, code: r.status ?? -1, log }
  if (result.code !== 0) console.error(log)
  return result
}

/** 파일이면 그 크기, 폴더면 ext로 끝나는 파일(타일)만 센다 */
function sizeOf(path: string, ext = ''): { bytes: number; files: number } {
  if (!existsSync(path)) return { bytes: 0, files: 0 }
  const st = statSync(path)
  if (!st.isDirectory()) return path.endsWith(ext) ? { bytes: st.size, files: 1 } : { bytes: 0, files: 0 }
  return readdirSync(path).reduce((acc, f) => {
    const s = sizeOf(join(path, f), ext)
    return { bytes: acc.bytes + s.bytes, files: acc.files + s.files }
  }, { bytes: 0, files: 0 })
}

function bboxOf(fc: any): number[] {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = (c: any): void => {
    if (typeof c[0] === 'number') {
      b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1])
    } else c.forEach(walk)
  }
  for (const f of fc.features) if (f.geometry?.coordinates) walk(f.geometry.coordinates)
  return b
}

export function collect(spec: FormatSpec, rawDir: string, pubDir: string, force = false) {
  const has = existsSync(rawDir) && readdirSync(rawDir).length > 0
  if (!has || force) {
    if (!spec.collect.steps.length) {
      throw new Error(`수동 수집 필요: ${spec.collect.dataset}\n  ${spec.collect.url}\n  ${spec.collect.how}\n  받은 파일 → ${rawDir} 에 넣고 다시 실행.`)
    }
    rmSync(rawDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    mkdirSync(rawDir, { recursive: true })
    const work = join(root, 'pipeline/work', spec.category, spec.id, '_collect')
    mkdirSync(work, { recursive: true })
    const t0 = Date.now()
    const logs: string[] = []
    for (const step of spec.collect.steps) {
      const r = runStep(step, { '/raw': rawDir, '/work': work, '/scripts': join(root, 'pipeline/scripts') })
      logs.push(r.log)
      if (r.code !== 0) throw new Error(`수집 실패: ${step.title}`)
    }
    const files = readdirSync(rawDir, { recursive: true, encoding: 'utf8' })
      .filter(f => statSync(join(rawDir, f)).isFile())
      .map(f => ({ name: f.replaceAll('\\', '/'), bytes: statSync(join(rawDir, f)).size }))
    const source = sources.find(s => s.id === spec.collect.source)
    const published = source?.redistribute !== 'no' && files.reduce((a, f) => a + f.bytes, 0) < PUBLISH_LIMIT
    rmSync(join(pubDir, 'raw'), { recursive: true, force: true })
    rmSync(join(pubDir, 'raw.zip'), { force: true })
    if (published) cpSync(rawDir, join(pubDir, 'raw'), { recursive: true })
    // 파일이 많은 원본(타일 묶음)은 화면에서 zip 하나로 받게 한다 (화면은 6개 넘으면 raw.zip을 가리킨다)
    if (published && files.length > 6) {
      mkdirSync(pubDir, { recursive: true })
      spawnSync('docker', ['run', '--rm', '-v', `${rawDir}:/raw:ro`, '-v', `${pubDir}:/out`, '-w', '/raw', '--entrypoint', 'sh', imageOf('local:tools'), '-c', 'python3 -m zipfile -c /out/raw.zip *'], { stdio: 'inherit' })
    }
    // 수집 중간 파일(국가 단위 원본 등)은 원본만 남기고 지운다
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    const report: CollectReport = { ranAt: new Date().toISOString(), ms: Date.now() - t0, log: logs.join('\n').slice(-4000), files, published }
    mkdirSync(pubDir, { recursive: true })
    writeFileSync(join(pubDir, 'collect.json'), JSON.stringify(report, null, 2))
  }
}

/** 측정 환경: 걸린 시간을 읽을 때 같이 봐야 하는 조건. 단계는 Docker 안에서 돌므로 코어·메모리는 Docker 기준 */
let env: Report['env']
function envOf(): NonNullable<Report['env']> {
  if (env) return env
  const [docker = '?', cores = '0', mem = '0', os = '?'] = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}|{{.NCPU}}|{{.MemTotal}}|{{.OperatingSystem}}'], { encoding: 'utf8' }).stdout.trim().split('|')
  return env = { cpu: cpus()[0]?.model.trim() ?? '?', cores: Number(cores), memGB: Math.round(Number(mem) / 2 ** 30), os: `${process.platform} ${release()}, ${os}`, docker }
}

/** 서버 출력 확인: 시점 가운데 타일 하나(WMS는 범위 그림 하나, WFS는 전체)를 받아 크기·시간을 잰다. 같은 요청을 한 번 더 보내 캐시 적중 시간도 잰다 */
async function probe(o: Output, spec: FormatSpec): Promise<Report['outputs'][number]> {
  const id = o.path.split('/')[2]!
  const base = tools.find(t => t.id === id)?.endpoint
  if (!base) throw new Error(`주소(endpoint)가 없는 서버예요: ${id}`)
  let url = base + o.path.slice(`/svc/${id}`.length)
  if (url.includes('{z}')) {
    const [lon, lat] = o.bounds ? [(o.bounds[0] + o.bounds[2]) / 2, (o.bounds[1] + o.bounds[3]) / 2] : spec.view.center
    const z = Math.min(o.maxzoom ?? 14, Math.max(o.minzoom ?? 0, Math.round(spec.view.zoom)))
    const n = 2 ** z, r = lat * Math.PI / 180
    const x = Math.floor((lon + 180) / 360 * n), y = Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n)
    url = url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  }
  if (o.kind === 'wms') url += `?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${o.layer}&STYLES=&SRS=EPSG:4326&BBOX=${o.bounds!.join(',')}&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true`
  const t0 = performance.now()
  // 연결 단계 오류는 'fetch failed'만 남기므로 원인(cause)과 주소를 붙인다
  const get = () => fetch(url).catch(e => { throw new Error(`서버 요청 실패: ${o.id} (${e.cause?.code ?? e.cause?.message ?? e.message})\n${url}`) })
  const res = await get()
  const body = Buffer.from(await res.arrayBuffer())
  const ms = Math.round(performance.now() - t0)
  const type = res.headers.get('content-type') ?? ''
  // OGC 서버는 오류도 200 + XML로 돌려줄 때가 있다
  if (res.status !== 200 || !body.length || type.includes('xml')) throw new Error(`서버 응답 이상: ${o.id} ${res.status} ${type}\n${url}\n${body.toString('utf8', 0, 400)}`)
  const features = o.kind === 'geojson' ? JSON.parse(body.toString('utf8')).features.length : undefined
  if (features === 0) throw new Error(`피처가 없는 응답이에요: ${o.id}`)
  const t1 = performance.now()
  await (await get()).arrayBuffer()
  return { id: o.id, bytes: body.length, files: 1, features, ms, cachedMs: Math.round(performance.now() - t1) }
}

export async function runRecipe(spec: FormatSpec, recipe: Recipe, rawDir: string, pubDir: string, job?: JobRun & { work: string }): Promise<Report> {
  const work = job?.work ?? join(root, 'pipeline/work', spec.category, spec.id, recipe.id)
  const out = join(pubDir, recipe.id)
  for (const d of [work, out]) { rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); mkdirSync(d, { recursive: true }) }
  // 파일 출력의 상위 폴더만 미리 만든다 (타일 디렉터리는 도구가 직접 만들어야 하는 경우가 많다)
  for (const o of recipe.outputs) if (!o.path.includes('{') && !o.path.startsWith('/svc/')) mkdirSync(dirname(join(out, o.path)), { recursive: true })
  const all = [...recipe.preprocess, ...recipe.convert]
  const svc = usesServer(all)
  // 서비스 레시피는 서버와 같이 쓰는 폴더(/serve)에 래스터를 둔다. GeoServer도 같은 폴더를 /serve로 읽는다 (compose.yaml)
  const mounts: Record<string, string> = { '/raw': rawDir, '/work': work, '/out': out, '/scripts': join(root, 'pipeline/scripts') }
  if (svc) mkdirSync(mounts['/serve'] = join(root, 'pipeline/serve'), { recursive: true })
  const report: Report = { recipe: recipe.id, ranAt: new Date().toISOString(), totalMs: 0, env: envOf(), steps: [], outputs: [] }
  const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))

  const db = !svc && usesDb(all)
  if (svc) compose('up', '-d', '--wait')
  if (db) startDb(recipe.db)
  try {
    for (const [stage, steps] of [['preprocess', recipe.preprocess], ['convert', recipe.convert]] as const) {
      for (const step of steps) {
        const r = runStep(step, mounts, svc ? SVC : db ? { name: DB.net, env: DB_ENV } : undefined, job)
        report.steps.push({ stage, title: step.title, run: step.run, ...r })
        report.totalMs += r.ms
        save()
        if (r.code !== 0) throw new Error(`실패: ${step.title}`)
      }
    }
  } finally {
    if (db) stopDb()
  }

  for (const o of recipe.outputs) {
    if (o.path.startsWith('/svc/')) { report.outputs.push(await probe(o, spec).catch(e => { save(); throw e })); continue }
    const i = o.path.indexOf('{')
    const target = join(out, i < 0 ? o.path : o.path.slice(0, i))
    // 3D Tiles는 tileset.json이 가리키는 폴더 전체가 결과물이다
    const size = o.kind === '3dtiles' ? sizeOf(dirname(target)) : sizeOf(target, i < 0 ? '' : (o.path.match(/\.\w+$/)?.[0] ?? ''))
    if (!size.files || !size.bytes) { save(); throw new Error(`출력이 비었어요: ${o.id} (${o.path})`) }
    let features: number | undefined
    if (o.kind === 'geojson') {
      const fc = JSON.parse(readFileSync(target, 'utf8'))
      features = fc.features.length
      if (!fc.features.some((f: any) => f.geometry)) { save(); throw new Error(`도형이 없는 GeoJSON이에요: ${o.id}`) }
      const id = dirname(o.path).split('/').pop()
      writeFileSync(join(dirname(target), 'index.json'), JSON.stringify({
        id, title: o.label, itemType: 'feature',
        extent: { spatial: { bbox: [bboxOf(fc)], crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
        links: [
          { rel: 'self', type: 'application/json', href: './index.json' },
          { rel: 'items', type: 'application/geo+json', href: './items.json' },
        ],
      }, null, 2))
    }
    report.outputs.push({ id: o.id, ...size, features })
  }
  save()
  // 성공하면 중간 파일(/work)을 지운다. 실패하면 남겨 원인 확인
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  return report
}

type Bounds = [number, number, number, number]
const deg = (r: number) => r * 180 / Math.PI

/** 타일 폴더(z/x/y.ext)에서 줌 범위와 가장 깊은 줌의 타일 범위를 읽는다 (XYZ 규칙) */
function tileRange(dir: string): { minzoom: number; maxzoom: number; bounds: Bounds } | undefined {
  const nums = (d: string) => readdirSync(d).map(f => Number.parseInt(f)).filter(Number.isFinite)
  const zs = existsSync(dir) ? nums(dir) : []
  if (!zs.length) return
  const z = Math.max(...zs)
  const xs = nums(join(dir, String(z)))
  const ys = xs.flatMap(x => nums(join(dir, String(z), String(x))))
  const n = 2 ** z
  const lon = (x: number) => x / n * 360 - 180
  const lat = (y: number) => deg(Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))))
  return { minzoom: Math.min(...zs), maxzoom: z, bounds: [lon(Math.min(...xs)), lat(Math.max(...ys) + 1), lon(Math.max(...xs) + 1), lat(Math.min(...ys))] }
}

/** 3D Tiles 루트 경계 → 경위도 범위. region은 그대로, box·sphere는 (transform을 적용한) 중심과 반지름으로 어림한다 */
function tilesetBounds(file: string): Bounds | undefined {
  const { root } = JSON.parse(readFileSync(file, 'utf8'))
  const bv = root.boundingVolume
  if (bv.region) return bv.region.slice(0, 4).map(deg) as Bounds
  const v = bv.box ?? bv.sphere
  if (!v) return
  const t = root.transform ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const [x, y, z] = [0, 1, 2].map(i => t[i]! * v[0] + t[4 + i]! * v[1] + t[8 + i]! * v[2] + t[12 + i]!) as [number, number, number]
  const r = bv.sphere ? v[3] : Math.hypot(...v.slice(3, 6), ...v.slice(6, 9), ...v.slice(9, 12))
  // ECEF → 경위도 (Bowring 근사, 지도 시점용이라 충분하다)
  const a = 6378137, e2 = 6.69437999014e-3, b = a * Math.sqrt(1 - e2), p = Math.hypot(x, y)
  const th = Math.atan2(z * a, p * b)
  const lat = deg(Math.atan2(z + e2 / (1 - e2) * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3))
  const lon = deg(Math.atan2(y, x))
  const dLat = r / 110540, dLon = r / (111320 * Math.cos(lat * Math.PI / 180))
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
}

/** 업로드 결과의 출력마다 범위·줌을 채우고, 그 범위로 처음 시점을 정한다 */
export function fillView(recipe: Recipe, out: string): Recipe {
  const outputs = recipe.outputs.map((o): Output => {
    const file = join(out, o.path.split('{')[0]!)
    let found: Partial<Output> = {}
    if (o.kind === 'geojson') found.bounds = bboxOf(JSON.parse(readFileSync(file, 'utf8'))) as Bounds
    else if (o.kind === 'xyz-raster' || o.kind === 'terrain-rgb' || o.kind === 'mvt') found = tileRange(file) ?? {}
    else if (o.kind === 'pmtiles') {
      const h = readFileSync(file).subarray(0, 127)
      found = { minzoom: h[100], maxzoom: h[101], bounds: [102, 106, 110, 114].map(i => h.readInt32LE(i) / 1e7) as Bounds }
    } else if (o.kind === 'quantized-mesh') found.bounds = JSON.parse(readFileSync(join(file, 'layer.json'), 'utf8')).bounds
    else if (o.kind === '3dtiles') found.bounds = tilesetBounds(file)
    else if (o.kind === 'image') found.bounds = JSON.parse(readFileSync(join(out, 'bounds.json'), 'utf8'))
    else if (o.kind === 'glb' && o.anchor) found.bounds = [o.anchor[0] - 5e-4, o.anchor[1] - 4e-4, o.anchor[0] + 5e-4, o.anchor[1] + 4e-4]
    return { ...found, ...o }
  })
  // 뷰어가 쓰는 출력 중 가장 좁은 범위(타일 경계로 넓히기 전의 실제 데이터)로 시점을 잡는다.
  // 줌은 타일이 있는 가장 얕은 줌보다 얕지 않게 한다 (그보다 멀면 타일을 요청하지 않는다)
  const used = outputs.filter(o => Object.values(recipe.viewers).some(v => 'output' in v && v.output === o.id))
  const area = (b: Bounds) => (b[2] - b[0]) * (b[3] - b[1])
  const b = used.flatMap(o => o.bounds ? [o.bounds] : []).sort((x, y) => area(x) - area(y))[0]
  if (!b) return { ...recipe, outputs }
  // 위치를 정해 세운 모델은 그 기준점을 가운데에 둔다
  const anchor = used.find(o => o.anchor)?.anchor
  const center: [number, number] = anchor ? [anchor[0], anchor[1]] : [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
  const span = Math.max(b[2] - b[0], (b[3] - b[1]) / Math.cos(center[1] * Math.PI / 180), 1e-4)
  const floor = Math.max(1, ...used.map(o => o.kind === 'xyz-raster' || o.kind === 'terrain-rgb' ? o.minzoom ?? 0 : 0))
  const zoom = Math.min(19, Math.max(floor, Math.log2(400 / span) - 0.3))
  const solid = outputs.some(o => ['terrain-rgb', 'quantized-mesh', '3dtiles', 'glb'].includes(o.kind) || o.style?.height)
  const korea = center[0] > 124 && center[0] < 132 && center[1] > 33 && center[1] < 39
  return { ...recipe, outputs, view: { center, zoom, ...(solid && { pitch: 55 }), ...(!korea && { basemap: 'osm' as const }) } }
}

/** 서버가 띄우는 업로드 작업. job.json을 읽고 업로드 레시피를 돌린 뒤 결과를 job.json에 다시 쓴다 */
async function runJob(dir: string) {
  const file = join(dir, 'job.json')
  const job: Job = JSON.parse(readFileSync(file, 'utf8'))
  const work = join(dir, 'work')
  try {
    const spec = (await loadFormats()).find(s => `${s.category}/${s.id}` === job.format)
    if (!spec || !('recipe' in spec.upload)) throw new Error(`업로드를 받지 않는 확장자예요: ${job.format}`)
    const input = readdirSync(join(dir, 'raw'))[0]!
    if (!spec.upload.accept.some(e => input.endsWith(e))) throw new Error(`이 페이지는 ${spec.upload.accept.join(', ')} 파일만 가능.`)
    await runRecipe(spec, spec.upload.recipe, join(dir, 'raw'), dir, { input: `/raw/${input}`, name: `geo-job-${job.id}`, work })
    job.recipe = fillView(spec.upload.recipe, join(dir, spec.upload.recipe.id))
    job.state = 'done'
  } catch (e) {
    job.state = 'failed'
    job.error = (e as Error).message.replace(/^실패: (.+)$/, '"$1" 단계에서 중단.')
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    writeFileSync(file, JSON.stringify(job, null, 2))
  }
}

/** 확장자별 현황(원본을 받았는지, 레시피마다 변환에 성공했는지)을 public/data/status.json 하나로 모은다 */
export async function writeStatus() {
  const read = <T>(file: string): T | null => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)
  const status: StatusEntry[] = (await loadFormats()).map(spec => {
    const pub = join(root, 'public/data', spec.category, spec.id)
    const raw = sizeOf(join(root, 'pipeline/raw', spec.category, spec.id))
    return {
      format: `${spec.category}/${spec.id}`,
      raw: raw.files ? raw : null,
      published: existsSync(join(pub, 'raw')),
      recipes: spec.recipes.map(r => {
        const rep = read<Report>(join(pub, r.id, 'report.json'))
        if (!rep) return { id: r.id, state: 'none' as const }
        const failed = rep.steps.find(s => s.code !== 0)
        return {
          id: r.id,
          state: failed || rep.outputs.length !== r.outputs.length ? 'failed' as const : 'done' as const,
          ranAt: rep.ranAt,
          totalMs: rep.totalMs,
          bytes: rep.outputs.reduce((a, o) => a + o.bytes, 0),
          failedStep: failed?.title,
        }
      }),
    }
  })
  mkdirSync(join(root, 'public/data'), { recursive: true })
  writeFileSync(join(root, 'public/data/status.json'), JSON.stringify(status, null, 2))
}

async function main() {
  const [target = '', ...flags] = process.argv.slice(2)
  if (target === '--job') return runJob(resolve(flags[0]!))
  if (target === '--status') return writeStatus()
  if (!target) throw new Error('사용법: node scripts/pipeline.ts <category/format[/recipe]> | <category> | all [--recollect]')
  try { process.loadEnvFile(join(root, '.env')) } catch {}
  const [cat, fmt, recipeId] = target.split('/')
  const specs = (await loadFormats()).filter(s => cat === 'all' || (s.category === cat && (!fmt || s.id === fmt)))
  if (!specs.length) throw new Error(`해당하는 확장자가 없어요: ${target}`)
  for (const spec of specs) {
    console.log(`■ ${spec.category}/${spec.id}`)
    if (spec.closed) { console.log(`  · 샘플 없음, 건너뜀: ${spec.closed}`); continue }
    const rawDir = join(root, 'pipeline/raw', spec.category, spec.id)
    const pubDir = join(root, 'public/data', spec.category, spec.id)
    collect(spec, rawDir, pubDir, flags.includes('--recollect'))
    for (const recipe of spec.recipes.filter(r => !recipeId || r.id === recipeId)) {
      const r = await runRecipe(spec, recipe, rawDir, pubDir)
      console.log(`  ✓ ${recipe.id}: ${(r.totalMs / 1000).toFixed(1)}초, ${r.outputs.map(o => `${o.id} ${(o.bytes / 1024).toFixed(0)}KB/${o.ms === undefined ? `${o.files}개` : `${o.ms}ms`}`).join(', ')}`)
    }
  }
  await writeStatus()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`✗ ${e.message}`, process.env.DEBUG ? e.stack : ""); process.exit(1) })
}
