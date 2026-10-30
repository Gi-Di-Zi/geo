import assert from 'node:assert/strict'
import test from 'node:test'
import { lookupRegions, parsePnu, resolveRows } from '../../shared/link/core.ts'
import type { LinkOptions } from '../../shared/link/types.ts'
import { fixture } from './fixtures/reference.ts'

const row = (value: string, id = '1') => ({ id, original: { 원문: value }, value })
const resolve = (value: string, options: Partial<LinkOptions> = {}) => resolveRows([row(value)], options, fixture).rows[0]!
const pnu = '1111010100100010000'

test('PNU 일반·산, 본번·부번의 문자열 분해와 -0 생략', () => {
  assert.deepEqual(parsePnu(pnu).parts, { regionCode: '1111010100', landType: '1', mountain: false, main: '0001', sub: '0000', parcel: '1' })
  assert.equal(parsePnu('1111010100200100002').parts?.parcel, '산 10-2')
})
for (const [value, code] of [['111', 'PNU_LENGTH'], ['11110101001A0010000', 'IDENTIFIER_CHARACTERS'], ['1111010100300010000', 'LAND_TYPE'], ['1111010100100000000', 'PARCEL_NUMBER']]) {
  test(`PNU 오류 ${code}를 분리하고 행 유지`, () => { const result = resolve(value!, { inputType: 'pnu' }); assert.equal(result.status, 'invalid'); assert.equal(result.errors[0]?.code, code); assert.equal(result.original.원문, value) })
}
for (const [level, code] of [['sido', '11'], ['sigungu', '11110'], ['eupmyeondong', '11110101'], ['ri', '1111010100']] as const) {
  test(`${level}: 접두 ${code.length}자리와 등록 전체 코드 분리`, () => { const result = resolve(pnu, { level }); assert.equal(result.output.code, code); assert.equal(result.output.registered_code.length, 10); assert.equal(result.output.code_kind, 'region_prefix') })
}
test('코드 단계와 주소 전체·최하위 표시가 독립', () => {
  assert.equal(resolve(pnu, { level: 'sido', addressStyle: 'full' }).output.name, '서울특별시 종로구 청운동')
  assert.equal(resolve(pnu, { level: 'sido', addressStyle: 'leaf' }).output.name, '청운동')
})
test('리 없는 동은 동 10자리만 출력하고 리 열은 비움', () => {
  const result = resolve(pnu, { level: 'ri', output: 'columns' })
  assert.equal(result.output.code, '1111010100'); assert.equal(result.output.ri_name, ''); assert.equal(result.output.ri_code, '')
})
test('사용자 문자열 추출은 공식 확인을 수행하지 않음', () => {
  const result = resolve('ABC000123', { level: 'custom', prefixLength: 5 })
  assert.equal(result.output.code, 'ABC00'); assert.equal(result.output.code_kind, 'custom_string_prefix'); assert.equal(result.code, 'not_checked'); assert.equal(result.format, 'not_applicable')
})
test('0패딩 코드가 미등록이면 공식 확인 실패', () => {
  const result = resolve('11112', { inputType: 'code', level: 'sigungu' })
  assert.equal(result.status, 'not_found'); assert.equal(result.output.registered_code, '')
})
test('실제 등록된 시도는 패딩 코드와 달라도 공식 계층에서 찾음', () => {
  const result = resolve('36', { inputType: 'code', level: 'sido' })
  assert.equal(result.output.code, '36'); assert.equal(result.output.registered_code, '3611000000')
})
test('자동 5자리 입력은 우편번호 혼동 방지 선택 요구', () => {
  assert.equal(resolve('11110').errors[0]?.code, 'AMBIGUOUS_CODE_SYSTEM')
  assert.equal(resolve('11110', { inputType: 'code', level: 'sigungu' }).status, 'ok')
})
test('미등록·폐지 코드와 필지 확인은 분리', () => {
  assert.equal(resolve('9999999999100010000').errors[0]?.code, 'REGION_NOT_FOUND')
  const retired = resolve('1111019900100010000')
  assert.equal(retired.code, 'retired'); assert.equal(retired.errors[0]?.code, 'REGION_RETIRED'); assert.equal(retired.parcel, 'not_checked')
})
test('전체 지번주소와 PNU 형식값 왕복', () => {
  const result = resolve('서울특별시 종로구 청운동 산 1-2')
  assert.equal(result.pnu, '1111010100200010002'); assert.equal(resolve(result.pnu).address, result.address); assert.equal(result.parcel, 'not_checked')
})
test('숫자 포함 법정동명 및 로로 끝나는 실제 법정동명 허용', () => {
  assert.equal(resolve('서울특별시 종로구 종로1가 1').pnu, '1111015600100010000')
  assert.equal(resolve('서울특별시 종로구 세종로 1').pnu, '1111011900100010000')
})
test('부분명·동명이인 후보를 임의 확정하지 않음', () => {
  const result = resolve('청운동 1')
  assert.equal(result.status, 'needs_selection'); assert.equal(result.candidates.length, 2)
  assert.equal(resolve('종로구 청운동 1').status, 'needs_selection')
})
test('후보 선택과 무관한 후보 거절', () => {
  assert.equal(resolve('청운동 1', { selections: { '1': '1111010100' } }).pnu, pnu)
  assert.equal(resolve('청운동 1', { selections: { '1': '0000000000' } }).errors[0]?.code, 'SELECTION_INVALID')
})
test('리가 누락된 읍 주소는 리 선택을 요구', () => {
  const result = resolve('경기도 수원시 권선구 시험읍 1')
  assert.equal(result.status, 'needs_selection'); assert.equal(result.errors[0]?.code, 'MISSING_RI'); assert.equal(result.candidates.length, 2)
})
for (const value of ['서울특별시 종로구 사직로 1', '서울특별시 종로구 청운동 1 101동 2호', '서울특별시 종로구 청운동 1 (건물명)', '서울특별시 종로구 청운효자동 1']) {
  test(`도로명·동호·미해석 원문 보존: ${value}`, () => { const result = resolve(value); assert.notEqual(result.status, 'ok'); assert.equal(result.pnu, ''); assert.ok(result.unparsed); assert.equal(result.original.원문, value) })
}
test('시 전체 하위 일반구는 등록 부모 관계로 조회', () => {
  const result = lookupRegions({ parentCode: '4111000000', descendants: true }, fixture)
  assert.ok(result.rows.some(r => r.code === '4111100000')); assert.ok(result.rows.some(r => r.code === '4111300000')); assert.ok(result.rows.some(r => r.code === '4111325021'))
})
test('빈 값·실패·중복과 원본 순서를 보존, 선택한 중복제거만 적용', () => {
  const input = [row(pnu, '1'), row('', '2'), row(pnu, '3')]
  assert.deepEqual(resolveRows(input, {}, fixture).rows.map(r => r.inputId), ['1', '2', '3'])
  const result = resolveRows(input, { deduplicate: true }, fixture)
  assert.equal(result.summary.omittedDuplicates, 1); assert.deepEqual(result.rows.map(r => r.inputId), ['1', '2'])
})
test('후보 펼침은 입력 ID와 후보 ID를 보존', () => {
  const result = resolveRows([row('청운동 1', 'company-row')], { expandCandidates: true }, fixture)
  assert.equal(result.rows.length, 2); assert.ok(result.rows.every(r => r.inputId === 'company-row' && r.candidateId && r.id !== r.inputId))
})
test('원천 미확보·부분수집 밖·정상 미일치의 상태 분리', () => {
  assert.equal(resolveRows([row(pnu)], {}, { ...fixture, available: false, coverage: 'none', regions: [] }).rows[0]?.status, 'unavailable')
  assert.equal(resolveRows([row('9999999999100010000')], {}, { ...fixture, coverage: 'partial' }).rows[0]?.errors[0]?.code, 'OUT_OF_COVERAGE')
  assert.equal(resolve('9999999999100010000').status, 'not_found')
})
test('숫자 손상 issue는 복구하지 않고 오류로 남김', () => {
  const result = resolveRows([{ ...row('1111010100100010000'), issue: 'IDENTIFIER_PRECISION_LOSS' }], {}, fixture)
  assert.equal(result.rows[0]?.status, 'invalid'); assert.equal(result.rows[0]?.pnu, '')
})
test('수식 셀은 실행하지 않고 한국어 사유와 원문 유지', () => {
  const result = resolveRows([{ ...row('=A1'), issue: 'FORMULA_NOT_EVALUATED' }], {}, fixture).rows[0]!
  assert.equal(result.errors[0]?.code, 'FORMULA_NOT_EVALUATED'); assert.match(result.errors[0]!.message, /수식 셀/); assert.equal(result.original.원문, '=A1'); assert.equal(result.pnu, '')
})
test('지수 표기의 긴 식별자는 복원하지 않고 사용자 문자열 작업과 구분', () => {
  assert.equal(resolve('1.11101010010001E+18').errors[0]?.code, 'IDENTIFIER_PRECISION_LOSS')
  assert.equal(resolve('1.11101010010001E+18', { level: 'custom', prefixLength: 3 }).output.code, '1.1')
})
test('지역 검색은 2·5·8·10자리 코드 접두어를 받음', () => {
  assert.ok(lookupRegions('11110101', fixture).rows.some(r => r.code === '1111010100'))
})
test('코드 사전 성공으로 필지 확인 상태가 승격되지 않음', () => {
  const result = resolve(pnu)
  assert.equal(result.code, 'active'); assert.equal(result.parcel, 'not_checked'); assert.equal(result.codeSystem, 'pnu')
})
