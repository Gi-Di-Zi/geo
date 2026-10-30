import assert from 'node:assert/strict'
import test from 'node:test'
import type { AdministrativeRegion, AdministrativeSnapshot } from '../../shared/link/administrative.ts'
import type { LinkOptions } from '../../shared/link/types.ts'
import { resolveAdministrativeRows } from '../../server/services/link/administrative.ts'
import { fixture } from './fixtures/reference.ts'

const region = (code: string, name: string, status: 'active' | 'retired' = 'active'): AdministrativeRegion => ({ code, name, fullName: '서울특별시 종로구 ' + name, parentCode: '1111000000', level: 'eupmyeondong', status, createdAt: '2020-01-01', retiredAt: status === 'retired' ? '2021-01-01' : null })
const admin: AdministrativeSnapshot = { version: 'admin-service-fixture', available: true, source: '행정동 변환 테스트 fixture', sourceUrl: '', sourceDate: '2026-10-12', publishedAt: null, checkedAt: null, coverage: 'fixture', codeSystem: 'mois_administrative_region', codeLength: 10,
  regions: [region('1111051500', '청운효자동'), region('1111051600', '시험행정동'), region('1111051700', '폐지행정동', 'retired'), region('1111051800', '출장소')],
  relations: [
    { legalCode: '1111010100', administrativeCode: '1111051500', legalName: '서울특별시 종로구 청운동', verified: true, createdAt: null, retiredAt: null },
    { legalCode: '1111010100', administrativeCode: '1111051600', legalName: '서울특별시 종로구 청운동', verified: true, createdAt: null, retiredAt: null },
    { legalCode: '1111011900', administrativeCode: '1111051500', legalName: '서울특별시 종로구 세종로', verified: true, createdAt: null, retiredAt: null },
    { legalCode: '1111051800', administrativeCode: '1111051800', legalName: '', verified: false, createdAt: null, retiredAt: null },
  ] }
const row = (value: string, id = '1') => ({ id, value, original: { 원문: value } })
const resolve = (value: string, options: Partial<LinkOptions> = {}, snapshot = admin) => resolveAdministrativeRows([row(value)], { inputType: 'administrative', target: 'address', output: 'name', ...options }, fixture, snapshot).rows[0]!
const pnu = '1111010100100010000'

test('행정동 입력은 법정동과 별도 사전으로 명칭 조회하며 가짜 지번을 만들지 않는다', () => {
  const actual = resolve('1111051500')
  assert.equal(actual.status, 'ok'); assert.equal(actual.output.name, '서울특별시 종로구 청운효자동')
  assert.equal(actual.inputType, 'administrative'); assert.equal(actual.codeSystem, 'administrative_region')
  assert.equal(actual.pnu, ''); assert.equal(actual.parcel, 'not_checked')
  assert.equal(resolve('1111010100').status, 'not_found')
})
test('기관 7자리·통계청 8자리·문자·빈 행·손상값을 보존하며 자동 패딩하지 않는다', () => {
  for (const value of ['1111051', '11110515', 'ABC', '']) {
    const actual = resolve(value)
    assert.equal(actual.status, 'invalid'); assert.equal(actual.original.원문, value); assert.equal(actual.pnu, '')
  }
  const actual = resolveAdministrativeRows([{ ...row('1111051500'), issue: 'IDENTIFIER_PRECISION_LOSS' }], { inputType: 'administrative', target: 'address' }, fixture, admin).rows[0]!
  assert.equal(actual.errors[0]?.code, 'IDENTIFIER_PRECISION_LOSS')
})
test('행정동 미등록·말소·원천 미준비를 구분한다', () => {
  assert.equal(resolve('9999999999').errors[0]?.code, 'ADMINISTRATIVE_CODE_UNKNOWN')
  assert.equal(resolve('1111051700').errors[0]?.code, 'ADMINISTRATIVE_CODE_RETIRED')
  assert.equal(resolve('1111051700').code, 'retired')
  const unavailable = resolve('1111051500', {}, { ...admin, available: false, regions: [], relations: [] })
  assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.errors[0]?.code, 'ADMINISTRATIVE_SOURCE_NOT_READY')
})
test('법정동 하나의 복수 행정동은 PNU 지번으로 임의 확정하지 않고 후보 선택', () => {
  const options: Partial<LinkOptions> = { inputType: 'pnu_legal', target: 'administrative_region', output: 'code' }
  const ambiguous = resolve(pnu, options)
  assert.equal(ambiguous.status, 'needs_selection'); assert.equal(ambiguous.candidates.length, 2)
  assert.equal(ambiguous.output.code, undefined)
  const selected = resolve(pnu, { ...options, selections: { '1': '1111010100|1111051500' } })
  assert.equal(selected.status, 'ok'); assert.equal(selected.output.code, '1111051500'); assert.equal(selected.parcel, 'not_checked')
  assert.equal(resolve(pnu, { ...options, selections: { '1': '1111010100|9999999999' } }).errors[0]?.code, 'SELECTION_INVALID')
  assert.equal(resolve(pnu, { ...options, selections: { '1': '1111011900' } }).errors[0]?.code, 'SELECTION_INVALID')
})
test('주소의 법정동 후보 선택 뒤 행정동 후보를 다시 선택할 수 있다', () => {
  const options: Partial<LinkOptions> = { inputType: 'address', target: 'administrative_region', output: 'code' }
  assert.equal(resolve('청운동 1', options).status, 'needs_selection')
  const legalSelected = resolve('청운동 1', { ...options, selections: { '1': '1111010100' } })
  assert.equal(legalSelected.status, 'needs_selection'); assert.equal(legalSelected.candidates[0]?.id, '1111010100|1111051500')
  assert.equal(resolve('청운동 1', { ...options, selections: { '1': '1111010100|1111051600' } }).output.code, '1111051600')
})
test('행정동→법정동 복수 후보와 시군구 접두 중복 결과를 구분', () => {
  const options: Partial<LinkOptions> = { target: 'legal_region', level: 'ri', output: 'code' }
  const actual = resolve('1111051500', options)
  assert.equal(actual.status, 'needs_selection'); assert.equal(actual.candidates.length, 2)
  assert.equal(resolve('1111051500', { ...options, selections: { '1': '1111011900' } }).output.code, '1111011900')
  assert.equal(resolve('1111051500', { ...options, selections: { '1': '9999999999' } }).errors[0]?.code, 'SELECTION_INVALID')
  const prefix = resolve('1111051500', { ...options, level: 'sigungu' })
  assert.equal(prefix.status, 'ok'); assert.equal(prefix.output.code, '11110'); assert.equal(prefix.output.registered_code, '1111000000')
  assert.equal(prefix.candidates.length, 0)
})
test('행정동만으로 전체 PNU 생성 불가 및 검증되지 않은 출장소 관계 차단', () => {
  const needed = resolve('1111051500', { target: 'pnu', output: 'code' })
  assert.equal(needed.status, 'unavailable'); assert.equal(needed.errors[0]?.code, 'PARCEL_REQUIRED'); assert.equal(needed.pnu, '')
  const relation = resolve('1111051800', { target: 'legal_region', level: 'ri', output: 'code' })
  assert.equal(relation.status, 'unavailable'); assert.equal(relation.errors[0]?.code, 'RELATION_NOT_AVAILABLE')
})
test('행정동 관계에는 있으나 현재 법정동 사전에 없으면 기준 버전 미확인', () => {
  const newer: AdministrativeSnapshot = { ...admin, relations: [{ legalCode: '1111018800', administrativeCode: '1111051500', legalName: '서울특별시 종로구 새동', verified: true, createdAt: null, retiredAt: null }] }
  const actual = resolve('1111051500', { target: 'legal_region', level: 'ri' }, newer)
  assert.equal(actual.status, 'unavailable'); assert.equal(actual.errors[0]?.code, 'REFERENCE_VERSION_MISMATCH')
  assert.equal(actual.code, 'active'); assert.equal(actual.output.code, undefined)
})
test('자료 준비와 형식 검증은 분리하며 두 버전과 원본·실패·중복을 유지', () => {
  const unavailable = { ...admin, available: false, regions: [], relations: [] }
  assert.equal(resolve(pnu, { inputType: 'pnu_legal', target: 'administrative_region' }, unavailable).status, 'unavailable')
  assert.equal(resolve('bad', { inputType: 'pnu', target: 'administrative_region' }, unavailable).status, 'invalid')
  const result = resolveAdministrativeRows([row('1111051500'), row('', '2'), row('1111051500', '3')], { inputType: 'administrative', target: 'address' }, fixture, admin)
  assert.deepEqual(result.rows.map(value => value.inputId), ['1', '2', '3'])
  assert.equal(result.summary.invalid, 1); assert.equal(result.summary.ok, 2)
  assert.ok(result.version.includes(fixture.version) && result.version.includes(admin.version))
  assert.ok(result.rows.every(value => value.parcel === 'not_checked'))
})
test('명시한 중복제거·후보 펼침만 적용하고 입력 ID를 보존', () => {
  const result = resolveAdministrativeRows([row(pnu), row(pnu, '2')], { inputType: 'pnu_legal', target: 'administrative_region', deduplicate: true, expandCandidates: true, output: 'code' }, fixture, admin)
  assert.equal(result.rows.length, 2); assert.equal(result.summary.omittedDuplicates, 1)
  assert.ok(result.rows.every(value => value.inputId === '1' && value.candidateId?.includes('|') && value.parcel === 'not_checked'))
})
test('실제 확보한 공식 사전에서 청운동↔청운효자동의 코드 체계를 구분', async () => {
  const { getReference } = await import('../../server/services/link/reference.ts')
  const { getAdministrativeReference } = await import('../../server/services/link/administrative-reference.ts')
  const legal = await getReference(), actual = await getAdministrativeReference()
  assert.equal(legal.available, true); assert.equal(actual.available, true)
  const toAdministrative = resolveAdministrativeRows([row(pnu)], { inputType: 'pnu_legal', target: 'administrative_region', output: 'code' }, legal, actual).rows[0]!
  assert.equal(toAdministrative.output.code, '1111051500')
  const toName = resolveAdministrativeRows([row('1111051500')], { inputType: 'administrative', target: 'address', output: 'name' }, legal, actual).rows[0]!
  assert.equal(toName.output.name, '서울특별시 종로구 청운효자동'); assert.equal(toName.parcel, 'not_checked')
})
