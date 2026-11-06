import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 기준자료 자동 확인 플러그인(server/plugins/link-reference.ts): 뜰 때 오늘 확인을 하고, 같은 날 다시 불러도 새 확인을 만들지 않는다.
// 공식 원천(행정표준코드관리시스템·행정안전부)을 실제로 받는다 → 네트워크 필요. 이 저장소의 기준 사전(.data/reference)을 임시 폴더에 복사해 쓴다
test('기준자료는 서버가 뜰 때 하루 한 번 자동으로 확인한다', { timeout: 180_000 }, async t => {
  const data = await mkdtemp(join(tmpdir(), 'geo-reference-schedule-'))
  t.after(() => rm(data, { recursive: true, force: true }))
  await cp('.data/reference', join(data, 'reference'), { recursive: true }).catch(() => undefined)
  process.env.GEO_DATA_DIR = data
  process.env.LINK_REFERENCE_AUTOSTART = '1'
  const timers: unknown[] = []
  const realInterval = globalThis.setInterval
  globalThis.setInterval = ((fn: () => void, ms: number) => { timers.push(ms); return { unref() {} } }) as typeof setInterval
  t.after(() => { globalThis.setInterval = realInterval })
  Object.assign(globalThis, { defineNitroPlugin: (plugin: () => void) => plugin })

  const { referenceDay, referenceUpdateStatus } = await import('../../server/services/link/reference-updates.ts')
  const { default: plugin } = await import('../../server/plugins/link-reference.ts') as { default: () => void }
  plugin()
  assert.deepEqual(timers, [3600_000], '1시간마다 다시 본다')

  let status = await referenceUpdateStatus()
  for (let i = 0; i < 120 && status.state !== 'done' && status.state !== 'failed'; i++) {
    await new Promise(done => setTimeout(done, 1000))
    status = await referenceUpdateStatus()
  }
  assert.equal(status.state, 'done', status.message)
  assert.equal(status.canUpdate, false)
  assert.equal(status.lastCheckedAt && referenceDay(status.lastCheckedAt), status.day, `마지막 확인 ${status.lastCheckedAt}`)
  assert.ok(status.lastUpdatedAt, '마지막 변경 시각')

  // 같은 날 다시(다음 시각의 확인): 새 시도를 만들지 않는다
  const attempts = await readdir(join(data, 'reference/link/updates', status.day))
  plugin()
  await new Promise(done => setTimeout(done, 1500))
  assert.deepEqual(await readdir(join(data, 'reference/link/updates', status.day)), attempts)
})
