import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { activateReference, decodeOfficialZip, getReference, parseReferenceText, refreshReference, validateRegions } from '../../server/services/link/reference.ts'

const text = '법정동코드\t법정동명\t폐지여부\r\n1100000000\t시험도\t존재\r\n1111000000\t시험도 시험시\t존재\r\n1111100000\t시험도 시험시 시험구\t존재\r\n1111110100\t시험도 시험시 시험구 숫자1동 \t존재\r\n'

test('공식 원문 필수 열·문자 코드·일반구 부모 경로·공백 정규화', () => {
  const rows = parseReferenceText(text)
  assert.equal(rows[2]?.parentCode, '1111000000'); assert.equal(rows[3]?.parentCode, '1111100000')
  assert.equal(rows[3]?.name, '숫자1동'); assert.equal(typeof rows[3]?.code, 'string')
})
test('잘못된 헤더·중복 코드·부모 누락·순환은 활성화 전 거절', () => {
  assert.throws(() => parseReferenceText('코드\t주소\n'), /필수 열/)
  assert.throws(() => parseReferenceText(`${text}1100000000\t중복도\t존재\n`), /중복/)
  assert.throws(() => parseReferenceText(text.replace('1111000000\t시험도 시험시\t존재\r\n', '')), /상위 지역/)
  const rows = parseReferenceText(text); rows[0]!.parentCode = rows[3]!.code
  assert.throws(() => validateRegions(rows), /순환/)
})
test('ZIP가 아닌 입력·큰 압축 크기·손상된 CRC를 거절', async () => {
  assert.throws(() => decodeOfficialZip(Buffer.from('html response')), /ZIP/)
  const bomb = Buffer.alloc(30)
  bomb.writeUInt32LE(0x04034b50); bomb.writeUInt16LE(8, 8); bomb.writeUInt32LE(10 * 1024 ** 2 + 1, 22)
  assert.throws(() => decodeOfficialZip(bomb), /지원하지 않는/)
  const raw = await readFile('.data/reference/link/raw/code-full.zip').catch(() => null)
  if (raw) {
    const decoded = decodeOfficialZip(raw)
    assert.match(decoded.text, /^법정동코드\t법정동명\t폐지여부/)
    assert.match(decoded.fileDate, /^\d{4}-\d{2}-\d{2}$/)
    const corrupted = Buffer.from(raw); corrupted[14] = corrupted[14]! ^ 1
    assert.throws(() => decodeOfficialZip(corrupted), /체크섬/)
  }
})

test('버전 고정·재적용·실패시 정상본 유지·포인터 중단 복구·일일 확인 이력', async () => {
  const previousDir = process.env.LINK_REFERENCE_DIR
  // 테스트 자료는 별도 영속 경로에만 남긴다. 전역 삭제 금지 합의를 지킨다.
  const dir = resolve('.data/link-tests/reference', randomUUID())
  process.env.LINK_REFERENCE_DIR = dir
  const lines = ['법정동코드\t법정동명\t폐지여부']
  for (let province = 10; province < 30; province++) {
    lines.push(`${province}00000000\t시험${province}도\t존재`, `${province}11000000\t시험${province}도 시험시\t존재`)
    for (let n = 1; n <= 600; n++) lines.push(`${province}110${String(n).padStart(3, '0')}00\t시험${province}도 시험시 시험${n}동\t존재`)
  }
  const synthetic = lines.join('\n')
  try {
    assert.equal((await getReference()).available, false)
    const first = await activateReference(synthetic)
    const pinned = await getReference()
    assert.equal(first.state, 'updated'); assert.equal(pinned.regions.length, 12040)
    const initialActivations = await readdir(join(dir, 'activations'))
    assert.equal((await activateReference(synthetic)).state, 'no_change')
    assert.deepEqual(await readdir(join(dir, 'activations')), initialActivations)
    const realFetch = globalThis.fetch
    try {
      globalThis.fetch = async () => { throw new Error('당일 반영 자료는 다시 받으면 안 됩니다.') }
      assert.equal((await refreshReference() as { state: string }).state, 'already_checked')
    } finally { globalThis.fetch = realFetch }
    await assert.rejects(() => activateReference(text), /불완전 자료/)
    assert.equal((await getReference()).version, first.version)
    const second = await activateReference(synthetic.replace('시험1동\t존재', '시험1동\t폐지'))
    assert.notEqual(second.version, first.version); assert.equal(pinned.version, first.version)
    const secondActivations = await readdir(join(dir, 'activations'))
    assert.equal((await activateReference(synthetic)).state, 'no_change')
    assert.equal((await getReference()).version, second.version)
    assert.deepEqual(await readdir(join(dir, 'activations')), secondActivations)
    assert.equal(pinned.regions.find(r => r.code === '1011000100')?.status, 'active')
    await writeFile(join(dir, 'active.json'), '{interrupted')
    assert.equal((await getReference()).version, second.version)
    const interruptedText = synthetic.replace('시험2동\t존재', '시험2동\t폐지')
    const interruptedVersion = `code-go-kr-${createHash('sha256').update(interruptedText).digest('hex').slice(0, 16)}`
    const interruptedDir = join(dir, 'versions', interruptedVersion)
    await mkdir(interruptedDir, { recursive: true })
    await writeFile(join(interruptedDir, 'snapshot.json'), '{interrupted')
    await writeFile(join(interruptedDir, 'source.txt'), '일부만 기록된 원문')
    await writeFile(join(interruptedDir, 'manifest.json'), '{interrupted')
    const recovered = await activateReference(interruptedText)
    assert.equal(recovered.version, interruptedVersion); assert.equal((await getReference()).version, interruptedVersion)
    await writeFile(join(dir, 'versions', first.version, 'manifest.json'), '{damaged-published-manifest')
    await assert.rejects(() => activateReference(synthetic), /manifest 검증 실패/)
    assert.equal((await getReference()).version, interruptedVersion)
    await writeFile(join(dir, 'active.json'), JSON.stringify({ version: 'code-go-kr-0000000000000000', checkedAt: '2099-01-01T00:00:00Z' }))
    const fallback = await getReference()
    assert.equal(fallback.version, interruptedVersion); assert.notEqual(fallback.checkedAt, '2099-01-01T00:00:00Z')
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = async () => new Response('too large', { headers: { 'content-length': String(10 * 1024 ** 2 + 1) } })
      await assert.rejects(() => refreshReference(true), /크기 제한/)
      globalThis.fetch = async () => new Response(new Uint8Array(10 * 1024 ** 2 + 1))
      await assert.rejects(() => refreshReference(true), /크기 제한/)
      assert.equal((await getReference()).version, interruptedVersion)
    } finally { globalThis.fetch = originalFetch }
    const tooManyRetired = synthetic.replaceAll('\t존재', '\t폐지')
    await assert.rejects(() => activateReference(tooManyRetired), /불완전 자료/)
    await mkdir(join(dir, 'checks'), { recursive: true })
    await writeFile(join(dir, 'checks', `${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}.json`), JSON.stringify({ state: 'failed', message: '시험용 실패 이력' }))
    assert.equal((await refreshReference() as { state: string }).state, 'failed')
  } finally {
    if (previousDir === undefined) delete process.env.LINK_REFERENCE_DIR
    else process.env.LINK_REFERENCE_DIR = previousDir
  }
})

test('법정동 갱신은 한국 날짜당 한 번·동시 요청 공유·중단 확인 복구를 영속 기록한다', async () => {
  const previousDir = process.env.LINK_REFERENCE_DIR, OriginalDate = globalThis.Date, originalFetch = globalThis.fetch
  const root = resolve('.data/link-tests/reference', randomUUID()), instant = Date.parse('2026-10-30T18:00:00Z')
  process.env.LINK_REFERENCE_DIR = root
  globalThis.Date = class extends OriginalDate { constructor(value?: string | number) { super(value === undefined ? instant : value) } static now() { return instant } } as DateConstructor
  let calls = 0
  try {
    globalThis.fetch = async () => { calls++; await new Promise(done => setTimeout(done, 10)); return new Response('오류', { status: 503 }) }
    const first = refreshReference(), duplicate = refreshReference()
    assert.equal(first, duplicate)
    assert.equal((await Promise.allSettled([first, duplicate]))[0]!.status, 'rejected')
    assert.equal(calls, 1)
    const path = join(root, 'checks', '2026-10-31.json')
    assert.equal(JSON.parse(await readFile(path, 'utf8')).state, 'failed')
    assert.equal((await refreshReference() as { state: string }).state, 'failed'); assert.equal(calls, 1)
    await writeFile(path, JSON.stringify({ state: 'checking', checkedAt: new Date().toISOString(), pid: process.pid, leaseUntil: new Date(Date.now() + 60_000).toISOString() }))
    assert.equal((await refreshReference() as { state: string }).state, 'checking'); assert.equal(calls, 1)
    await writeFile(path, JSON.stringify({ state: 'checking', checkedAt: new Date().toISOString(), pid: 99999999, leaseUntil: new Date(Date.now() - 1).toISOString() }))
    const recovered = await refreshReference() as { state: string; code: string }
    assert.equal(recovered.state, 'failed'); assert.equal(recovered.code, 'CHECK_INTERRUPTED'); assert.equal(calls, 1)
  } finally {
    globalThis.Date = OriginalDate; globalThis.fetch = originalFetch
    if (previousDir === undefined) delete process.env.LINK_REFERENCE_DIR; else process.env.LINK_REFERENCE_DIR = previousDir
  }
})
