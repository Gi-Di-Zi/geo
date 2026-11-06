import assert from 'node:assert/strict'
import test from 'node:test'
import { detectInputType, resolveAllRows } from '../../server/services/link/all.ts'
import { resolveRows } from '../../shared/link/core.ts'
import { linkOptionsSchema } from '../../shared/link/types.ts'
import { LocationError } from '../../shared/link/location.ts'
import type { AdministrativeSnapshot } from '../../shared/link/administrative.ts'
import type { ForwardLocation, ReverseLocation } from '../../server/services/link/location.ts'
import { fixture } from './fixtures/reference.ts'

const administrative: AdministrativeSnapshot = {
  version: 'all-admin-fixture', available: true, source: '전체 결과 검사 fixture', sourceUrl: '', sourceDate: null, publishedAt: null, checkedAt: null, coverage: 'fixture', codeSystem: 'mois_administrative_region', codeLength: 10,
  regions: [{ code: '1111051500', name: '청운효자동', fullName: '서울특별시 종로구 청운효자동', parentCode: null, level: 'eupmyeondong', status: 'active', createdAt: null, retiredAt: null }],
  relations: [{ legalCode: '1111010100', administrativeCode: '1111051500', legalName: '서울특별시 종로구 청운동', verified: true, createdAt: null, retiredAt: null }],
}
const point: ForwardLocation = { x: 126.97, y: 37.58, lon: 126.97, lat: 37.58, crs: 'EPSG:4326', source: '위치 fixture', sourceUrl: '', sourceDate: null, checkedAt: '2026-10-30T00:00:00Z', method: 'address_point', warning: '필지 중심점 확인 없음' }
const found: ReverseLocation = { ...point, method: 'reverse_geocoded', address: '서울특별시 종로구 청운동 1', parcelAddress: '서울특별시 종로구 청운동 1', roadAddress: '', addressType: 'parcel', legalCode: '1111010100', administrativeCode: '1111051500', postcode: '03046', parcelNumber: '1' }
const row = (value: string, id = '1') => ({ id, value, original: { 원문: value } })
const provider = { forwardLocation: async () => point, reverseLocation: async () => found }

test('PNU 한 번 입력으로 모든 유형·공식 상위 코드가 함께 나오며 가짜 리는 만들지 않는다', async () => {
  let calls = 0
  const batch = await resolveAllRows([row('1111010100100010000')], { inputType: 'pnu_legal' }, fixture, administrative, { ...provider, forwardLocation: async () => { calls++; return point } })
  const actual = batch.rows[0]!
  assert.equal(actual.output.address, '서울특별시 종로구 청운동 1')
  assert.equal(actual.output.pnu, '1111010100100010000')
  assert.equal(actual.output.legal_code, '1111010100')
  assert.equal(actual.output.administrative_code, '1111051500')
  assert.equal(actual.output.sido_code, '11'); assert.equal(actual.output.sigungu_code, '11110')
  assert.equal(actual.output.eupmyeondong_code, '1111010100'); assert.equal(actual.output.ri_code, '')
  assert.equal(actual.output.location, '126.97000000, 37.58000000')
  assert.equal(actual.parcel, 'not_checked'); assert.equal(calls, 1); assert.equal(actual.output.postcode, '03046')
  assert.ok(Object.values(actual.conversions!).every(value => value.status === 'ok'))
})

test('위치 입력은 역조회 한 번을 공유하고 입력 좌표와 필지 미확인을 보존한다', async () => {
  let calls = 0
  const actual = (await resolveAllRows([row('126.97, 37.58')], { inputType: 'location', sourceCrs: 'EPSG:4326', outputCrs: 'EPSG:5179' }, fixture, administrative, { ...provider, reverseLocation: async () => { calls++; return found } })).rows[0]!
  assert.equal(calls, 1)
  assert.equal(actual.conversions?.address.value, found.address)
  assert.equal(actual.conversions?.pnu.value, '1111010100100010000')
  assert.equal(actual.output.legal_code, '1111010100'); assert.equal(actual.output.administrative_code, '1111051500')
  assert.equal(actual.output.location_method, 'input_point'); assert.equal(actual.output.crs, 'EPSG:5179')
  assert.equal(actual.value, '126.97, 37.58'); assert.equal(actual.parcel, 'not_checked')
})

test('일부 원천 장애는 확인된 결과를 지우지 않고 각 항목의 사유로 남긴다', async () => {
  const actual = (await resolveAllRows([row('1111010100100010000')], { inputType: 'pnu_legal' }, fixture, administrative, { ...provider, forwardLocation: async () => { throw new LocationError('GEOCODER_AUTH_REQUIRED', '위치 원천 권한 필요', 'unavailable') } })).rows[0]!
  assert.equal(actual.status, 'ok')
  assert.equal(actual.conversions?.location.status, 'unavailable')
  assert.equal(actual.conversions?.location.errors[0]?.code, 'GEOCODER_AUTH_REQUIRED')
  assert.equal(actual.output.address, '서울특별시 종로구 청운동 1')
  assert.equal(actual.output.pnu, '1111010100100010000'); assert.equal(actual.output.location, '')
})

test('역조회 장애에도 입력 위치의 좌표 변환은 유지하고 실제 리의 공식 상위 관계를 표시한다', async () => {
  let calls = 0
  const location = (await resolveAllRows([row('1000000, 2000000')], { inputType: 'location', sourceCrs: 'EPSG:5179' }, fixture, administrative, { ...provider, reverseLocation: async () => { calls++; throw new LocationError('GEOCODER_UNAVAILABLE', '검사 원천 장애', 'unavailable') } })).rows[0]!
  assert.equal(calls, 1); assert.equal(location.output.location, '127.50000000, 38.00000000')
  assert.equal(location.conversions?.address.status, 'unavailable'); assert.equal(location.output.legal_code, '')
  const ri = (await resolveAllRows([row('4111325021100010000')], { inputType: 'pnu_legal', conversionSelections: {} }, fixture, administrative, provider)).rows[0]!
  assert.equal(ri.output.ri_name, '동리'); assert.equal(ri.output.ri_code, '4111325021')
  assert.equal(ri.output.eupmyeondong_code, '41113250'); assert.equal(ri.output.sigungu_code, '41113')
  assert.equal(ri.conversions?.pnu.status, 'ok')
})

test('지역코드·행정동만으로 PNU를 만들지 않고 알려진 명칭·관할 결과는 유지한다', async () => {
  for (const [value, inputType] of [['1111010100', 'pnu_legal'], ['1111051500', 'administrative']] as const) {
    const actual = (await resolveAllRows([row(value)], { inputType }, fixture, administrative, provider)).rows[0]!
    assert.equal(actual.output.pnu, ''); assert.equal(actual.conversions?.pnu.status, 'unavailable')
    assert.equal(actual.conversions?.pnu.errors[0]?.code, 'PARCEL_REQUIRED')
    assert.equal(actual.output.legal_code, '1111010100')
    assert.ok(actual.output.address); assert.ok(actual.output.administrative_code)
  }
})

test('법정동 후보 선택을 공통 적용하고 행정동 복수 관계 선택은 독립적으로 보존한다', async () => {
  const ambiguous = await resolveAllRows([row('청운동 1')], { inputType: 'address' }, fixture, administrative, provider)
  assert.equal(ambiguous.rows[0]?.conversions?.legal_region.status, 'needs_selection')
  const selected = await resolveAllRows([row('청운동 1')], { inputType: 'address', conversionSelections: { legal_region: { '1': '1111010100' } } }, fixture, administrative, provider)
  assert.equal(selected.rows[0]?.output.pnu, '1111010100100010000')
  assert.equal(selected.rows[0]?.output.legal_code, '1111010100')
  const multiple: AdministrativeSnapshot = { ...administrative, regions: [...administrative.regions, { ...administrative.regions[0]!, code: '1111051600', name: '시험동', fullName: '서울특별시 종로구 시험동' }], relations: [...administrative.relations, { ...administrative.relations[0]!, administrativeCode: '1111051600' }] }
  // 필지 위치를 역조회한 행정동이 후보 중에 있으면 그것으로, 위치가 없으면 후보 유지
  const batch = await resolveAllRows([row('1111010100100010000')], { inputType: 'pnu_legal' }, fixture, multiple, provider)
  assert.equal(batch.rows[0]?.conversions?.administrative_region.status, 'ok')
  assert.equal(batch.rows[0]?.output.administrative_code, '1111051500')
  assert.equal(batch.rows[0]?.conversions?.pnu.status, 'ok')
  const unplaced = await resolveAllRows([row('1111010100100010000')], { inputType: 'pnu_legal' }, fixture, multiple, { ...provider, forwardLocation: async () => { throw new LocationError('GEOCODER_NO_MATCH', '없음', 'not_found') } })
  assert.equal(unplaced.rows[0]?.conversions?.administrative_region.status, 'needs_selection')
  const resolved = await resolveAllRows([row('1111010100100010000')], { inputType: 'pnu_legal', conversionSelections: { administrative_region: { '1': '1111010100|1111051600' } } }, fixture, multiple, provider)
  assert.equal(resolved.rows[0]?.output.administrative_code, '1111051600')
  assert.equal(resolved.rows[0]?.output.pnu, '1111010100100010000')
})

test('자동 입력은 줄마다 PNU·법정동·행정동·주소를 구분하고 입력 순서를 유지한다', async () => {
  const values = ['1111051500', '1111010100100010000', '서울특별시 종로구 세종로 1', '1111010100', '11110']
  const batch = await resolveAllRows(values.map((value, index) => row(value, String(index + 1))), {}, fixture, administrative, provider)
  assert.deepEqual(batch.rows.map(value => value.inputId), ['1', '2', '3', '4', '5'])
  assert.deepEqual(batch.rows.map(value => value.inputType), ['administrative', 'pnu', 'address', 'code', 'code'])
  assert.equal(batch.rows[0]!.output.administrative_code, '1111051500'); assert.equal(batch.rows[0]!.output.legal_code, '1111010100')
  assert.equal(batch.rows[1]!.output.pnu, '1111010100100010000'); assert.equal(batch.rows[2]!.output.pnu, '1111011900100010000')
  assert.equal(batch.rows[4]!.output.sigungu_code, '11110')
  // 시군구·읍면처럼 두 사전에 같은 코드가 있으면 법정동, 폐지된 법정동과 겹치면 행정동
  const legal = new Map(fixture.regions.map(region => [region.code, region]))
  assert.equal(detectInputType('1111000000', legal, new Set(['1111000000'])), 'pnu_legal')
  assert.equal(detectInputType('1111019900', legal, new Set(['1111019900'])), 'administrative')
})

test('우편번호는 같은 필지·위치일 때만 정하고 구역·다른 필지는 정하지 않으며 우편번호 입력은 주소 검색으로 안내한다', async () => {
  const values = ['1111010100100010000', '1111010100100020000', '1111010100', '126.97, 37.58', '03045']
  const batch = await resolveAllRows(values.map((value, index) => row(value, String(index + 1))), {}, fixture, administrative, provider)
  const postcode = batch.rows.map(value => value.conversions!.postcode)
  assert.equal(postcode[0]!.value, '03046')
  assert.equal(postcode[1]!.errors[0]?.code, 'POSTCODE_ADDRESS_MISMATCH')
  assert.equal(postcode[2]!.errors[0]?.code, 'POSTCODE_REGION')
  // 좌표 입력은 그 위치의 역조회 결과를 쓴다.
  const location = await resolveAllRows([row('126.97, 37.58')], { inputType: 'location' }, fixture, administrative, provider)
  assert.equal(location.rows[0]!.conversions!.postcode.value, '03046')
  assert.equal(batch.rows[4]!.inputType, 'postcode'); assert.equal(postcode[4]!.errors[0]?.code, 'POSTCODE_SEARCH_REQUIRED')
  assert.ok(Object.values(batch.rows[4]!.conversions!).every(value => value.status === 'unavailable'))
  // 실제 시군구가 있는 5자리는 시군구코드, 없으면 우편번호
  const legal = new Map(fixture.regions.map(region => [region.code, region]))
  assert.equal(detectInputType('11110', legal, new Set()), 'pnu_legal'); assert.equal(detectInputType('03045', legal, new Set()), 'postcode')
  // 도로명주소는 원천이 붙인 괄호(동·건물명)를 빼고 같은 주소일 때만 쓴다.
  const roadFound = { ...found, roadAddress: '서울특별시 종로구 사직로 9 (행촌동,대신중고등학교)', postcode: '03029' }
  const road = await resolveAllRows([row('서울특별시 종로구 사직로 9'), row('서울특별시 종로구 사직로 10', '2')], { inputType: 'address' }, fixture, administrative, { ...provider, reverseLocation: async () => roadFound })
  assert.equal(road.rows[0]!.conversions!.postcode.value, '03029'); assert.equal(road.rows[1]!.conversions!.postcode.errors[0]?.code, 'POSTCODE_ADDRESS_MISMATCH')
})

test('도로명주소는 원천의 건물 대표지번 PNU·건물 위치·우편번호로 정하고, 다른 주소·띄어쓰기 경계 밖 일치는 쓰지 않는다', async () => {
  const searchRoad = async () => [{ pnu: '1111011900100010000', road: '서울특별시 종로구 세종대로 175 (세종로)', parcel: '세종로 1', building: '', postcode: '03172', lon: 126.9769, lat: 37.572, checkedAt: '2026-11-06T00:00:00Z' }]
  const batch = await resolveAllRows([row('서울 종로구 세종대로175'), row('세종대로 175', '2'), row('서울특별시 종로구 세종대로 1', '3'), row('대로 175', '4')], {}, fixture, administrative, { ...provider, searchRoad })
  const [full, short, other, partial] = batch.rows
  assert.equal(full!.inputType, 'address'); assert.equal(full!.value, '서울 종로구 세종대로175')
  assert.equal(full!.output.pnu, '1111011900100010000'); assert.equal(full!.output.postcode, '03172'); assert.equal(full!.output.location_method, 'building_point')
  assert.equal(short!.output.pnu, '1111011900100010000'); assert.match(short!.warnings.join(), /시도·시군구를 도로명주소 검색 결과에서 채웠습니다/)
  assert.notEqual(other!.output.pnu, '1111011900100010000'); assert.notEqual(partial!.output.pnu, '1111011900100010000')
})

test('외부 조회 끔(lookups=false): 위치 원천을 부르지 않고 사전 결과만, 한 번에 200줄까지', async () => {
  let calls = 0
  const counting = { forwardLocation: async () => { calls++; return point }, reverseLocation: async () => { calls++; return found } }
  const batch = await resolveAllRows(Array.from({ length: 30 }, (_, index) => row('1111010100100010000', String(index))), { inputType: 'pnu_legal', lookups: false }, fixture, administrative, counting)
  assert.equal(calls, 0)
  assert.equal(batch.rows[0]!.output.address, '서울특별시 종로구 청운동 1'); assert.equal(batch.rows[0]!.output.administrative_code, '1111051500')
  assert.equal(batch.rows[0]!.conversions!.location.errors[0]?.code, 'LOOKUP_OFF')
  await assert.rejects(() => resolveAllRows(Array.from({ length: 21 }, (_, index) => row('11', String(index))), { inputType: 'pnu_legal' }, fixture, administrative, counting), { code: 'ALL_ROW_LIMIT' })
})

test('입력 순서·중복·실패 행을 보존하고 전체 한도와 직접 실행 경계를 검사한다', async () => {
  const inputs = [row('1111010100100010000', 'first'), row('bad', 'failed'), row('1111010100100010000', 'duplicate')]
  const batch = await resolveAllRows(inputs, { inputType: 'pnu_legal' }, fixture, administrative, provider)
  assert.deepEqual(batch.rows.map(value => value.inputId), ['first', 'failed', 'duplicate'])
  assert.equal(batch.rows[1]?.conversions?.pnu.status, 'invalid')
  assert.deepEqual(batch.rows.map(value => value.original), inputs.map(value => value.original))
  await assert.rejects(() => resolveAllRows(Array.from({ length: 21 }, (_, index) => row('11', String(index))), { inputType: 'pnu_legal' }, fixture, administrative, provider), { code: 'ALL_ROW_LIMIT', statusCode: 413 })
  await assert.rejects(() => resolveAllRows(inputs, { inputType: 'pnu_legal', expandCandidates: true }, fixture, administrative, provider), { code: 'ALL_ROW_OPTIONS_UNSUPPORTED' })
  assert.throws(() => resolveRows(inputs, { inputType: 'pnu_legal', target: 'all' }, fixture), /공통 서비스/)
  assert.equal(linkOptionsSchema.parse({ conversionSelections: { legal_region: { first: '1111010100' } } }).conversionSelections?.legal_region?.first, '1111010100')
})
