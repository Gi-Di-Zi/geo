// 제공 방식별 보장 확인. 서비스: 48시간 만료 판정·정리·재시도·소유 확인 (시계 주입, 정리 함수 대역 — 실제 GeoServer·PostGIS는 건드리지 않음).
// 파일: 내려받을 결과 폴더의 형식 머리글·참조 파일·절대 주소 검사 (임시 폴더에 만든 결과로)
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serviceTtlMs, SERVICE_HOURS } from '../../shared/conversion.ts'
import type { Job, ServiceRecord } from '../../shared/types.ts'
import { checkBundle } from '../../server/utils/bundle-check.ts'
import { serviceOf, serviceState, sweepServices } from '../../server/utils/service-expiry.ts'
import { chargeDaily, DAILY_UPLOAD_BYTES } from '../../server/utils/upload-storage.ts'
import { lookupRows } from '../../server/services/link/access.ts'

const HOUR = 3600_000
const T0 = Date.parse('2026-11-02T00:00:00Z')

async function jobsDir(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'geo-jobs-'))

  t.after(() => rm(dir, { recursive: true, force: true }))

  return dir
}

/** 서비스 작업 하나를 디스크에 (pipeline runJob이 쓰는 모양) */
async function serviceJob(dir: string, id: string, service: ServiceRecord, layer = service.layer) {
  const job: Job = { id, format: 'vector-2d/geojson', name: 'a.geojson', bytes: 10, state: 'done', createdAt: new Date(T0).toISOString(), method: 'geoserver', layer, service }

  await mkdir(join(dir, id), { recursive: true })
  await writeFile(join(dir, id, 'job.json'), JSON.stringify(job))

  return job
}

const readJob = async (dir: string, id: string): Promise<Job> => JSON.parse(await readFile(join(dir, id, 'job.json'), 'utf8'))

const published = (layer: string, at = T0): ServiceRecord => ({ layer, publishedAt: new Date(at).toISOString(), expiresAt: new Date(at + SERVICE_HOURS * HOUR).toISOString(), status: 'active' })

test('이용 기간 = 정확히 48시간(172800초), 시험 단축은 production이 아닐 때만', () => {
  assert.equal(serviceTtlMs({}), 172_800_000)
  assert.equal(serviceTtlMs({ NODE_ENV: 'production', GEO_SERVICE_TTL_SEC_FOR_TEST: '30' }), 172_800_000)
  assert.equal(serviceTtlMs({ NODE_ENV: 'development', GEO_SERVICE_TTL_SEC_FOR_TEST: '30' }), 30_000)
})

test('만료 판정은 시각으로: 48시간 전 active, 지난 뒤 expired (정리 작업과 무관)', () => {
  const s = published('up_aaaaaaaa')

  assert.equal(serviceState(s, T0 + 47 * HOUR), 'active')
  assert.equal(serviceState(s, T0 + 48 * HOUR - 1), 'active')
  assert.equal(serviceState(s, T0 + 48 * HOUR), 'expired')
  // 저장 상태가 active로 남아 있어도(정리 전·서버 재시작) 만료 뒤엔 active가 아니다
  assert.equal(serviceState({ ...s }, T0 + 100 * HOUR), 'expired')
  assert.equal(serviceState({ ...s, status: 'deleted' }, T0), 'deleted')
})

test('정리: 만료 전에는 안 지우고, 만료 뒤 자기 레이어만 지운 뒤 deleted (재시작 = 디스크에서 다시 읽음)', async t => {
  const dir = await jobsDir(t)
  const mine = 'aaaaaaaa-0000-4000-8000-000000000001', other = 'bbbbbbbb-0000-4000-8000-000000000002'

  await serviceJob(dir, mine, published('up_aaaaaaaa'))
  await serviceJob(dir, other, published('up_bbbbbbbb', T0 + 10 * HOUR))
  const dropped: string[] = []
  const drop = async (layer: string) => { dropped.push(layer) }

  assert.deepEqual(await sweepServices(dir, T0 + 47 * HOUR, drop), [])
  assert.equal((await serviceOf(dir, 'up_aaaaaaaa'))?.status, 'active')
  const results = await sweepServices(dir, T0 + 49 * HOUR, drop)

  assert.deepEqual(dropped, ['up_aaaaaaaa'])
  assert.deepEqual(results.map(r => r.result), ['deleted'])
  const after = await readJob(dir, mine)

  assert.equal(after.service?.status, 'deleted')
  assert.equal(after.service?.publishedAt, new Date(T0).toISOString())
  assert.equal(after.service?.expiresAt, new Date(T0 + 48 * HOUR).toISOString())
  // 다른 작업의 서비스는 그대로, 다시 돌려도 지운 것을 또 지우지 않음 (멱등)
  assert.equal(serviceState((await readJob(dir, other)).service!, T0 + 49 * HOUR), 'active')
  await sweepServices(dir, T0 + 50 * HOUR, drop)
  assert.deepEqual(dropped, ['up_aaaaaaaa'])
  // 서버가 꺼져 있던 동안 만료된 것도 다음 정리에서
  await sweepServices(dir, T0 + 200 * HOUR, drop)
  assert.deepEqual(dropped, ['up_aaaaaaaa', 'up_bbbbbbbb'])
})

test('정리 실패 → failed + 기록 + 다음 시도 시각, 그 뒤 재시도 성공 → deleted', async t => {
  const dir = await jobsDir(t)
  const id = 'cccccccc-0000-4000-8000-000000000003'

  await serviceJob(dir, id, published('up_cccccccc'))
  let fail = true
  const drop = async () => { if (fail) throw new Error('GeoServer 응답 없음') }
  const first = await sweepServices(dir, T0 + 49 * HOUR, drop)

  assert.equal(first[0]?.result, 'failed')
  const failed = (await readJob(dir, id)).service

  assert.equal(failed?.status, 'failed')
  assert.equal(failed?.cleanup?.error, 'GeoServer 응답 없음')
  assert.equal(failed?.cleanup?.attempts, 1)
  assert.ok(failed?.cleanup?.next)
  // 다음 시도 시각 전에는 다시 부르지 않고, 실패한 서비스는 열리지 않는다
  assert.deepEqual(await sweepServices(dir, T0 + 49 * HOUR + 60_000, drop), [])
  assert.notEqual(serviceState(failed!, T0 + 49 * HOUR), 'active')
  fail = false
  const retried = await sweepServices(dir, Date.parse(failed!.cleanup!.next!) + 1, drop)

  assert.equal(retried[0]?.result, 'deleted')
  assert.equal((await readJob(dir, id)).service?.cleanup?.attempts, 2)
})

test('정리 도중 멈춘 deleting·발행 실패 기록도 정리, 소유를 확인할 수 없는 레이어는 지우지 않음', async t => {
  const dir = await jobsDir(t)
  const stuck = 'dddddddd-0000-4000-8000-000000000004', half = 'eeeeeeee-0000-4000-8000-000000000005', odd = 'ffffffff-0000-4000-8000-000000000006'

  await serviceJob(dir, stuck, { ...published('up_dddddddd'), status: 'deleting' })
  await serviceJob(dir, half, { layer: 'up_eeeeeeee', status: 'failed' })
  // 기록의 레이어가 이 작업 id로 만든 이름이 아님 (샘플·남의 레이어일 수 있음)
  await serviceJob(dir, odd, published('geo_sample'), 'geo_sample')
  const dropped: string[] = []
  const results = await sweepServices(dir, T0 + 49 * HOUR, async layer => { dropped.push(layer) })

  assert.deepEqual(dropped.sort(), ['up_dddddddd', 'up_eeeeeeee'])
  assert.equal(results.find(r => r.job === odd)?.result, 'skipped')
  const kept = (await readJob(dir, odd)).service

  assert.equal(kept?.status, 'failed')
  assert.equal(kept?.cleanup?.stop, true)
  // 한 번 멈춘 것은 다시 시도하지 않는다
  await sweepServices(dir, T0 + 300 * HOUR, async layer => { dropped.push(layer) })
  assert.ok(!dropped.includes('geo_sample'))
})

test('파일 결과 검사: 3D Tiles 참조 파일·외부 tileset, 빠진 파일·절대 주소는 문제로', async t => {
  const out = await mkdtemp(join(tmpdir(), 'geo-out-'))

  t.after(() => rm(out, { recursive: true, force: true }))
  await mkdir(join(out, 'tiles', 'sub'), { recursive: true })
  await writeFile(join(out, 'tiles', 'a.b3dm'), 'b3dm')
  await writeFile(join(out, 'tiles', 'sub', 'b.pnts'), 'pnts')
  await writeFile(join(out, 'tiles', 'sub', 'tileset.json'), JSON.stringify({ root: { content: { uri: 'b.pnts' } } }))
  await writeFile(join(out, 'tiles', 'tileset.json'), JSON.stringify({ root: { content: { url: 'a.b3dm' }, children: [{ content: { uri: 'sub/tileset.json' } }] } }))
  const o = { id: 'tiles', kind: '3dtiles' as const, path: 'tiles/tileset.json', label: '3D Tiles', why: '' }
  const ok = await checkBundle(out, o, 'tiles')

  assert.equal(ok.ok, true, ok.problems.join())
  assert.equal(ok.files, 4)
  await writeFile(join(out, 'tiles', 'tileset.json'), JSON.stringify({ root: { content: { uri: 'missing.b3dm' }, children: [{ content: { uri: 'http://localhost:3000/api/jobs/x/files/c.b3dm' } }] } }))
  const bad = await checkBundle(out, o, 'tiles')

  assert.equal(bad.ok, false)
  assert.ok(bad.problems.some(p => p.includes('missing.b3dm')))
  assert.ok(bad.problems.some(p => p.includes('절대 주소')))
})

test('파일 결과 검사: quantized-mesh layer.json + 타일, PMTiles·GeoJSON 머리글, 없는 결과', async t => {
  const out = await mkdtemp(join(tmpdir(), 'geo-out-'))

  t.after(() => rm(out, { recursive: true, force: true }))
  await mkdir(join(out, 'terrain', '0', '0'), { recursive: true })
  await writeFile(join(out, 'terrain', 'layer.json'), JSON.stringify({ tiles: ['{z}/{x}/{y}.terrain'] }))
  await writeFile(join(out, 'terrain', '0', '0', '0.terrain'), 'mesh')
  assert.equal((await checkBundle(out, { id: 'mesh', kind: 'quantized-mesh', path: 'terrain', label: '', why: '' }, 'terrain')).ok, true)
  await writeFile(join(out, 'data.pmtiles'), Buffer.concat([Buffer.from('PMTiles'), Buffer.from([3])]))
  assert.equal((await checkBundle(out, { id: 'tiles', kind: 'pmtiles', path: 'data.pmtiles', label: '', why: '' }, 'data.pmtiles')).ok, true)
  await writeFile(join(out, 'data.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'a', height: 3 }, geometry: null }] }))
  const geojson = await checkBundle(out, { id: 'features', kind: 'geojson', path: 'data.geojson', label: '', why: '' }, 'data.geojson')

  assert.equal(geojson.ok, true)
  assert.deepEqual(geojson.fields, ['name', 'height'])
  assert.equal((await checkBundle(out, { id: 'x', kind: 'mvt', path: 'none/{z}/{x}/{y}.pbf', label: '', why: '' }, 'none')).ok, false)
})

test('공개 업로드 한도: 접속자마다 하루 1GiB, 다른 접속자·다음 날은 따로', () => {
  const day = Date.parse('2026-11-03T05:00:00Z')

  assert.equal(chargeDaily('1.1.1.1', DAILY_UPLOAD_BYTES - 10, day), true)
  assert.equal(chargeDaily('1.1.1.1', 11, day), false)
  assert.equal(chargeDaily('1.1.1.1', 10, day), true)
  assert.equal(chargeDaily('2.2.2.2', DAILY_UPLOAD_BYTES, day), true)
  assert.equal(chargeDaily('1.1.1.1', 1, day + 24 * HOUR), true)
})

test('주소·코드 연계: 외부 원천(위치·우편번호·경계)을 부르는 줄만 하루 한도에 센다', () => {
  assert.equal(lookupRows({ text: '1111010100100010000\n\n서울 강남구 테헤란로 152', options: { target: 'all' } }), 2)
  assert.equal(lookupRows({ rows: [{}, {}, {}], options: { inputType: 'location' } }), 3)
  assert.equal(lookupRows({ codes: ['11', '11110'] }), 2)
  // 사전만 쓰는 변환은 세지 않는다
  assert.equal(lookupRows({ text: '1111010100100010000', options: { target: 'pnu' } }), 0)
})


test('Coolify 설정 경로만 release로 전환하며 데이터·키 bind와 web 격리는 유지한다', async () => {
  const compose = JSON.parse(await readFile(new URL('../../deploy/compose.coolify.json', import.meta.url), 'utf8'))

  assert.deepEqual(compose.services.web.volumes, [
    '/srv/storage/sda/apps/geo/source/public/data:/public-data:ro',
    '/srv/storage/sda/apps/geo/worker-config/nginx-key.conf:/etc/nginx/private/worker-key.conf:ro',
    { type: 'bind', source: '${GEO_PUBLIC_NGINX_CONF:-/srv/storage/sda/apps/geo/source/deploy/public.nginx.conf}', target: '/etc/nginx/conf.d/default.conf', read_only: true },
    { type: 'bind', source: '${GEO_WORKER_PROXY_CONF:-/srv/storage/sda/apps/geo/source/deploy/worker.proxy.conf}', target: '/etc/nginx/geo-worker-proxy.conf', read_only: true },
  ])
  assert.deepEqual(compose.services.app.volumes, ['/srv/storage/sda/apps/geo/source/public/data:/app/.output/public/data:ro'])
  assert.equal(compose.services.app.image, '${GEO_VERIFIED_IMAGE:?verified image is required}')
  assert.equal(compose.services.web.read_only, true)
  assert.deepEqual(compose.services.web.cap_drop, ['ALL'])
  assert.deepEqual(compose.services.web.security_opt, ['no-new-privileges:true'])
  assert.equal(compose.services.web.mem_limit, '64m')
  assert.equal(compose.services.web.pids_limit, 64)
  assert.deepEqual(Object.keys(compose.services).sort(), ['app', 'web'])
})
