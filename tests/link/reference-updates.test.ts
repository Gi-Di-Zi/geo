import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createReferenceUpdater, referenceDay } from '../../server/services/link/reference-updates.ts'
import type { ReferenceUpdateInfo, ReferenceUpdateSource } from '../../server/services/link/reference-updates.ts'

function fixture() {
  let clock = Date.parse('2026-10-30T05:00:00Z')
  const directory = resolve('.data/link-tests/reference-updates', randomUUID()), calls: string[] = [], forced: boolean[] = []
  const info = (name: string): ReferenceUpdateInfo => ({ available: true, version: name + '-v1', source: '검사 전용 자료', sourceUrl: 'https://example.invalid/reference', sourceDate: '2026-10-01', activatedAt: '2026-10-01T00:00:00Z', checkedAt: '2026-10-29T00:00:00Z', count: 1 })
  const legal = info('legal'), administrative = info('administrative')
  let fail = false
  const sources: ReferenceUpdateSource[] = [legal, administrative].map((value, index) => ({ id: index ? 'administrative' : 'legal', label: index ? '행정동' : '법정동', info: async () => ({ ...value }), refresh: async force => {
    calls.push(index ? 'administrative' : 'legal'); forced.push(!!force)
    await new Promise(done => setTimeout(done, 15))
    if (index && fail) throw new Error('검사용 공식 원천 장애')
    value.checkedAt = new Date(clock).toISOString()
    return { state: 'no_change', version: value.version }
  } }))
  const make = () => createReferenceUpdater({ directory, sources, now: () => clock })
  return { directory, sources, calls, forced, legal, administrative, make, now: () => clock, setClock: (value: number) => { clock = value }, setFail: (value: boolean) => { fail = value } }
}

test('한국 날짜를 기준으로 당일 확인·반영은 요청 없이 완료로 표시한다', async () => {
  assert.equal(referenceDay('2026-10-30T14:59:59.999Z'), '2026-10-30')
  assert.equal(referenceDay('2026-10-30T15:00:00.000Z'), '2026-10-31')
  const data = fixture()
  data.legal.checkedAt = new Date(data.now()).toISOString()
  data.administrative.activatedAt = new Date(data.now()).toISOString()
  const status = await data.make().update()
  assert.equal(status.state, 'done'); assert.equal(status.canUpdate, false)
  assert.deepEqual(data.calls, [])
})

test('동시에 여러 번 눌러도 원천당 한 번 확인하고 재시작 뒤 같은 날 재실행하지 않는다', async () => {
  const data = fixture(), manager = data.make()
  const statuses = await Promise.all(Array.from({ length: 6 }, () => manager.update()))
  assert.ok(statuses.every(status => status.state === 'done'))
  assert.deepEqual(data.calls.sort(), ['administrative', 'legal'])
  const restarted = data.make()
  assert.equal((await restarted.update()).canUpdate, false)
  assert.equal(data.calls.length, 2)
  assert.equal((await readdir(join(data.directory, '2026-10-30'))).length, 1)
  assert.equal(data.legal.version, 'legal-v1')
})

test('독립 manager 인스턴스도 영속 독점 시도로 같은 업데이트를 공유한다', async () => {
  const data = fixture(), first = data.make(), second = data.make()
  const results = await Promise.all([first.update(), second.update(), data.make().update()])
  assert.ok(results.every(value => value.state === 'checking' || value.state === 'done'))
  assert.equal(data.calls.length, 2)
  assert.equal((await second.status()).state, 'done')
})

test('원본이 그대로여도 다음 한국 날짜에는 한 번 다시 확인할 수 있다', async () => {
  const data = fixture(), manager = data.make()
  await manager.update()
  data.setClock(Date.parse('2026-10-30T15:00:01Z'))
  assert.equal((await manager.status()).state, 'ready')
  const next = await manager.update()
  assert.equal(next.day, '2026-10-31'); assert.equal(next.state, 'done')
  assert.equal(data.calls.length, 4)
  assert.equal(data.legal.version, 'legal-v1')
})

test('실패는 정상 자료를 유지하고 5분 후 실패한 원천만 재시도한다', async () => {
  const data = fixture(); data.setFail(true)
  const manager = data.make(), first = await manager.update()
  assert.equal(first.state, 'failed'); assert.equal(first.canUpdate, false)
  assert.equal(first.sources[0]?.state, 'done'); assert.equal(first.sources[1]?.state, 'failed')
  assert.equal(data.administrative.version, 'administrative-v1')
  await data.make().update(); assert.equal(data.calls.length, 2)
  data.setClock(data.now() + 5 * 60_000 + 1); data.setFail(false)
  assert.equal((await data.make().update()).state, 'done')
  assert.deepEqual(data.calls, ['legal', 'administrative', 'administrative'])
  assert.deepEqual(data.forced, [false, false, true])
  assert.equal((await readdir(join(data.directory, '2026-10-30'))).length, 2)
})

test('서버 중단·기록 손상을 무한 확인 중으로 남기지 않고 복구 시도를 보존한다', async () => {
  const data = fixture(), day = referenceDay(data.now()), folder = join(data.directory, day)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, '0001.json'), JSON.stringify({ day, attempt: 1, state: 'checking', startedAt: new Date(data.now() - 10 * 60_000).toISOString(), pid: process.pid, leaseUntil: data.now() - 1, results: {} }))
  const interrupted = await data.make().status()
  assert.equal(interrupted.state, 'failed'); assert.equal(interrupted.canUpdate, true)
  assert.equal((await data.make().update()).state, 'done')
  assert.equal((await readdir(folder)).length, 2)
  const broken = fixture(), brokenFolder = join(broken.directory, day)
  await mkdir(brokenFolder, { recursive: true }); await writeFile(join(brokenFolder, '0001.json'), '{')
  const corrupt = await broken.make().status()
  assert.equal(corrupt.state, 'failed'); assert.equal(corrupt.canUpdate, false)
})

test('소스 확인 중은 중복 요청을 막고 당일 실패 기록은 숨기지 않는다', async () => {
  const data = fixture(), checkedAt = new Date(data.now() - 60_000).toISOString()
  data.sources[0]!.history = async () => ({ state: 'checking', checkedAt, leaseUntil: data.now() + 60_000, pid: process.pid })
  const pending = await data.make().update()
  assert.equal(pending.state, 'checking'); assert.equal(pending.canUpdate, false); assert.equal(data.calls.length, 0)
  data.sources[0]!.history = async () => ({ state: 'failed', checkedAt, message: '원천 장애' })
  const failed = await data.make().status()
  assert.equal(failed.state, 'failed'); assert.equal(failed.canUpdate, false)
})

test('소스가 기존 실행을 공유한다고 응답하면 기록을 잠시 읽지 못해도 재실행하지 않는다', async () => {
  const data = fixture()
  data.sources[0]!.refresh = async () => { data.calls.push('legal'); return { state: 'checking' } }
  const manager = data.make()
  assert.equal((await manager.update()).state, 'checking')
  assert.equal((await data.make().update()).canUpdate, false)
  assert.deepEqual(data.calls, ['legal', 'administrative'])
  data.setClock(data.now() + 6 * 60_000)
  const interrupted = await data.make().status()
  assert.equal(interrupted.state, 'failed'); assert.equal(interrupted.canUpdate, true)
})
