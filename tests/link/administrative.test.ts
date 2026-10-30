import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { crc32, deflateRawSync } from 'node:zlib'
import ExcelJS from 'exceljs-community'
import { administrativeForLegal, legalForAdministrative, lookupAdministrative } from '../../shared/link/administrative.ts'
import type { AdministrativeSnapshot } from '../../shared/link/administrative.ts'
import { activateAdministrativeReference, administrativeInfo, administrativeZipEntries, getAdministrativeReference, parseAdministrativeZip, refreshAdministrativeReference, validateAdministrative } from '../../server/services/link/administrative-reference.ts'

const fixture: AdministrativeSnapshot = { version: 'fixture-administrative', available: true, source: '테스트 fixture', sourceUrl: '', sourceDate: '2026-10-12', publishedAt: null, checkedAt: null, coverage: 'fixture', codeSystem: 'mois_administrative_region', codeLength: 10,
  regions: [
    { code: '1100000000', name: '서울특별시', fullName: '서울특별시', parentCode: null, level: 'sido', status: 'active', createdAt: null, retiredAt: null },
    { code: '1111000000', name: '종로구', fullName: '서울특별시 종로구', parentCode: '1100000000', level: 'sigungu', status: 'active', createdAt: null, retiredAt: null },
    { code: '1111051500', name: '청운효자동', fullName: '서울특별시 종로구 청운효자동', parentCode: '1111000000', level: 'eupmyeondong', status: 'active', createdAt: null, retiredAt: null },
    { code: '1111053000', name: '사직동', fullName: '서울특별시 종로구 사직동', parentCode: '1111000000', level: 'eupmyeondong', status: 'active', createdAt: null, retiredAt: null },
  ], relations: [
    { administrativeCode: '1111051500', legalCode: '1111010100', legalName: '서울특별시 종로구 청운동', verified: true, createdAt: null, retiredAt: null },
    { administrativeCode: '1111053000', legalCode: '1111010100', legalName: '서울특별시 종로구 청운동', verified: true, createdAt: null, retiredAt: null },
    { administrativeCode: '1111053000', legalCode: '1111053000', legalName: '', verified: false, createdAt: null, retiredAt: null },
  ] }
test('행안부 10자리 행정동과 법정동은 같은 접두어만으로 연결하지 않고 복수 관계를 유지한다', () => {
  assert.deepEqual(administrativeForLegal('1111010100', fixture).map(row => row.code), ['1111051500', '1111053000'])
  assert.deepEqual(administrativeForLegal('11110101', fixture), [])
  assert.equal(legalForAdministrative('1111053000', fixture).length, 1)
  assert.deepEqual(legalForAdministrative('11110530', fixture), [])
  assert.equal(lookupAdministrative('청운효자동', fixture).rows[0]?.code, '1111051500')
  assert.equal(lookupAdministrative({ parentCode: '1100000000', descendants: true }, fixture).total, 3)
})
test('행정동 자료는 중복·기관코드7자리·부모순환·관계 미등록을 거절한다', () => {
  assert.throws(() => validateAdministrative([...fixture.regions, fixture.regions[0]!], fixture.relations), /중복/)
  assert.throws(() => validateAdministrative([{ ...fixture.regions[0]!, code: '1234567' }], fixture.relations), /10자리/)
  assert.throws(() => validateAdministrative(fixture.regions.map((row, i) => i === 0 ? { ...row, parentCode: row.code } : row), fixture.relations), /순환/)
  assert.throws(() => validateAdministrative(fixture.regions, [{ ...fixture.relations[0]!, administrativeCode: '9999999999' }]), /미등록/)
})
function zip(files: Array<[string, Buffer]>) {
  const locals: Buffer[] = [], central: Buffer[] = []; let at = 0
  for (const [path, data] of files) {
    const name = Buffer.from(path), packed = deflateRawSync(data), local = Buffer.alloc(30), directory = Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26)
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(crc32(data), 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(at, 42)
    locals.push(local, name, packed); central.push(directory, name); at += local.length + name.length + packed.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(at, 16)
  return Buffer.concat([...locals, directory, end])
}
async function book(headers: string[], rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('자료'); sheet.addRow(headers); sheet.addRows(rows)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
async function source(large = false, numeric = false, special = false) {
  const h: unknown[][] = [['1100000000', '서울특별시', '', '', '19880423', ''], ['1111000000', '서울특별시', '종로구', '', '19880423', '']]
  const b: unknown[][] = [], mix: unknown[][] = []
  if (special) h.push(
    ['3600000000', '세종특별자치시', '', '', '20120701', ''],
    ['3611000000', '세종특별자치시', '', '', '20120701', ''],
    ['3611051000', '세종특별자치시', '', '한솔동', '20120701', ''],
    ['4100000000', '경기도', '', '', '19880423', ''],
    ['4110500000', '북부출장소', '', '', '19880423', ''],
  )
  for (let i = 0; i < (large ? 2500 : 2); i++) {
    const admin = '11999' + String(i).padStart(5, '0'); h.push([numeric ? Number(admin) : admin, '서울특별시', '종로구', '시험' + i + '동', '20261012', ''])
    for (let j = 0; j < (large ? 6 : 1); j++) { const legal = '11888' + String(j).padStart(5, '0'); mix.push([admin, '서울특별시', '종로구', '시험' + i + '동', legal, '법정' + j + '동', '20261012', '']) }
  }
  for (let i = 0; i < (large ? 6 : 1); i++) b.push(['11888' + String(i).padStart(5, '0'), '서울특별시', '종로구', '법정' + i + '동', '', '20261012', ''])
  return zip([
    ['jscode20261012/KIKcd_H.20261012.xlsx', await book(['행정동코드', '시도명', '시군구명', '읍면동명', '생성일자', '말소일자'], h)],
    ['jscode20261012/KIKcd_B.20261012.xlsx', await book(['법정동코드', '시도명', '시군구명', '읍면동명', '동리명', '생성일자', '말소일자'], b)],
    ['jscode20261012/KIKmix.20261012.xlsx', await book(['행정동코드', '시도명', '시군구명', '읍면동명', '법정동코드', '동리명', '생성일자', '말소일자'], mix)],
  ])
}
test('공식 세 XLSX의 문자형 코드·기준일·관계 파싱과 숫자 셀 거절', async () => {
  const result = await parseAdministrativeZip(await source())
  assert.equal(result.regions.length, 4); assert.equal(result.relations.length, 2); assert.equal(result.sourceDate, '2026-10-12')
  assert.equal(result.regions[2]!.parentCode, '1111000000')
  await assert.rejects(parseAdministrativeZip(await source(false, true)), /문자형/)
  assert.throws(() => administrativeZipEntries(Buffer.from('invalid')), /크기/)
  const corrupt = await source(); corrupt[40] = corrupt[40]! ^ 1
  assert.throws(() => administrativeZipEntries(corrupt))
})
test('동일 전체명 시도·시군구와 시도명 열의 출장소를 실제 등록 상위 코드로 구분한다', async () => {
  const { regions } = await parseAdministrativeZip(await source(false, false, true)), byCode = new Map(regions.map(region => [region.code, region]))
  assert.equal(byCode.get('3600000000')!.level, 'sido')
  assert.equal(byCode.get('3611000000')!.level, 'sigungu')
  assert.equal(byCode.get('3611000000')!.parentCode, '3600000000')
  assert.equal(byCode.get('3611051000')!.parentCode, '3611000000')
  assert.equal(byCode.get('4110500000')!.level, 'sigungu')
  assert.equal(byCode.get('4110500000')!.parentCode, '4100000000')
})
test('전국 자료 검증 후 활성화하고 실패·포인터 중단 시 이전 정상본을 유지한다', async () => {
  const original = process.env.LINK_ADMINISTRATIVE_DIR, root = resolve('.data/link-tests/administrative', randomUUID()); process.env.LINK_ADMINISTRATIVE_DIR = root
  try {
    assert.equal((await getAdministrativeReference()).available, false)
    await assert.rejects(activateAdministrativeReference(await source(), { sourceUrl: 'fixture' }), /불완전/)
    const data = await source(true), result = await activateAdministrativeReference(data, { sourceUrl: 'fixture', checkedAt: '2026-10-30T00:00:00Z' })
    assert.equal(result.available, true); assert.equal(result.count, 2502); assert.equal(result.relationCount, 15000)
    const initialActivations = await readdir(join(root, 'activations'))
    const initialInfo = await administrativeInfo(); assert.ok(initialInfo.activatedAt); assert.ok(initialInfo.ingestedAt)
    const first = await getAdministrativeReference()
    const reapplied = await activateAdministrativeReference(data, { sourceUrl: 'fixture', checkedAt: '2026-10-30T01:00:00Z' })
    assert.equal(reapplied.state, 'no_change'); assert.equal((await getAdministrativeReference()).checkedAt, '2026-10-30T01:00:00Z'); assert.equal(first.checkedAt, '2026-10-30T00:00:00Z')
    assert.deepEqual(await readdir(join(root, 'activations')), initialActivations)
    assert.equal((await administrativeInfo()).activatedAt, initialInfo.activatedAt)
    const fetchBefore = globalThis.fetch
    try {
      globalThis.fetch = async () => { throw new Error('당일 반영 자료는 다시 받으면 안 됩니다.') }
      assert.equal((await refreshAdministrativeReference() as { state: string }).state, 'already_checked')
    } finally { globalThis.fetch = fetchBefore }
    await assert.rejects(activateAdministrativeReference(Buffer.from('bad'), { sourceUrl: 'fixture' }))
    await mkdir(root, { recursive: true }); await writeFile(join(root, 'active.json'), '{interrupted', 'utf8')
    assert.equal((await getAdministrativeReference()).version, result.version)
  } finally { if (original === undefined) delete process.env.LINK_ADMINISTRATIVE_DIR; else process.env.LINK_ADMINISTRATIVE_DIR = original }
})

test('행정동 갱신은 한국 날짜·다중 요청·중단 상태를 기록하고 같은 날 재다운로드하지 않는다', async () => {
  const previousDir = process.env.LINK_ADMINISTRATIVE_DIR, OriginalDate = globalThis.Date, originalFetch = globalThis.fetch
  const root = resolve('.data/link-tests/administrative', randomUUID()), instant = Date.parse('2026-10-30T18:00:00Z')
  process.env.LINK_ADMINISTRATIVE_DIR = root
  globalThis.Date = class extends OriginalDate { constructor(value?: string | number) { super(value === undefined ? instant : value) } static now() { return instant } } as DateConstructor
  let calls = 0
  try {
    globalThis.fetch = async () => { calls++; await new Promise(done => setTimeout(done, 10)); return new Response('오류', { status: 503 }) }
    const first = refreshAdministrativeReference(), duplicate = refreshAdministrativeReference(); assert.equal(first, duplicate)
    assert.equal((await Promise.allSettled([first, duplicate]))[0]!.status, 'rejected'); assert.equal(calls, 1)
    const path = join(root, 'checks', '2026-10-31.json')
    assert.equal(JSON.parse(await readFile(path, 'utf8')).state, 'failed')
    assert.equal((await refreshAdministrativeReference() as { state: string }).state, 'failed'); assert.equal(calls, 1)
    await writeFile(path, JSON.stringify({ state: 'checking', checkedAt: new Date().toISOString(), pid: process.pid, leaseUntil: new Date(Date.now() + 60_000).toISOString() }))
    assert.equal((await refreshAdministrativeReference() as { state: string }).state, 'checking'); assert.equal(calls, 1)
    await writeFile(path, JSON.stringify({ state: 'checking', checkedAt: new Date().toISOString(), pid: 99999999, leaseUntil: new Date(Date.now() - 1).toISOString() }))
    const recovered = await refreshAdministrativeReference() as { state: string; code: string }
    assert.equal(recovered.state, 'failed'); assert.equal(recovered.code, 'CHECK_INTERRUPTED'); assert.equal(calls, 1)
  } finally {
    globalThis.Date = OriginalDate; globalThis.fetch = originalFetch
    if (previousDir === undefined) delete process.env.LINK_ADMINISTRATIVE_DIR; else process.env.LINK_ADMINISTRATIVE_DIR = previousDir
  }
})
