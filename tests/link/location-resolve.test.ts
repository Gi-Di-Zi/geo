import assert from 'node:assert/strict'
import test from 'node:test'
import type { AdministrativeSnapshot } from '../../shared/link/administrative.ts'
import type { LinkOptions } from '../../shared/link/types.ts'
import { LocationError } from '../../shared/link/location.ts'
import { resolveLocationRows } from '../../server/services/link/location-resolve.ts'
import type { ForwardLocation, ReverseLocation } from '../../server/services/link/location.ts'
import { fixture } from './fixtures/reference.ts'

const administrative: AdministrativeSnapshot = {
  version: 'location-admin-fixture', available: true, source: '위치 변환 테스트 fixture', sourceUrl: '', sourceDate: null, publishedAt: null, checkedAt: null, coverage: 'fixture', codeSystem: 'mois_administrative_region', codeLength: 10,
  regions: ['1111051500', '1111051600'].map((code, index) => ({ code, name: index ? '시험행정동' : '청운효자동', fullName: '서울특별시 종로구 ' + (index ? '시험행정동' : '청운효자동'), parentCode: '1111000000', level: 'eupmyeondong', status: 'active', createdAt: null, retiredAt: null })),
  relations: ['1111051500', '1111051600'].map(administrativeCode => ({ legalCode: '1111010100', administrativeCode, legalName: '서울특별시 종로구 청운동', verified: true, createdAt: null, retiredAt: null })),
}
const point: ForwardLocation = { x: 126.97, y: 37.58, lon: 126.97, lat: 37.58, crs: 'EPSG:4326', source: '위치 원천 fixture', sourceUrl: '', sourceDate: null, checkedAt: '2026-10-30T00:00:00.000Z', method: 'address_point', warning: '원천 주소 대표 좌표이며 필지 중심점으로 확인하지 않았습니다.' }
const found: ReverseLocation = { ...point, method: 'reverse_geocoded', address: '서울특별시 종로구 청운동 1', parcelAddress: '서울특별시 종로구 청운동 1', roadAddress: '', addressType: 'parcel', legalCode: '1111010100', administrativeCode: '1111051500' }
const row = (value: string, id = '1') => ({ id, value, original: { 원문: value } })
const provider = { forwardLocation: async () => point, reverseLocation: async () => found }
const resolve = async (value: string, options: Partial<LinkOptions>, service: NonNullable<Parameters<typeof resolveLocationRows>[4]> = provider) => (await resolveLocationRows([row(value)], options, fixture, administrative, service)).rows[0]!

test('좌표계만 변환하면 외부 원천을 호출하지 않고 XY 순서와 입력 원문을 유지한다', async () => {
  const unused = async (): Promise<never> => { assert.fail('순수 좌표 변환은 원천 조회를 하지 않는다') }
  const actual = await resolve('1000000, 2000000', { inputType: 'location', target: 'location', sourceCrs: 'EPSG:5179', outputCrs: 'EPSG:4326' }, { forwardLocation: unused, reverseLocation: unused })
  assert.equal(actual.status, 'ok'); assert.equal(actual.output.code, '127.50000000, 38.00000000')
  assert.equal(actual.output.location_method, 'input_point'); assert.equal(actual.original.원문, '1000000, 2000000')
  assert.equal(actual.parcel, 'not_checked'); assert.equal(actual.pnu, '')
})

test('역지오코딩 법정동코드는 현재 사전에서 확인하고 선택한 접두 길이로 출력한다', async () => {
  const actual = await resolve('126.97, 37.58', { inputType: 'location', target: 'legal_region', level: 'eupmyeondong', output: 'code' })
  assert.equal(actual.output.code, '11110101'); assert.equal(actual.output.registered_code, '1111010100')
  assert.equal(actual.inputType, 'location'); assert.equal(actual.value, '126.97, 37.58')
  assert.equal(actual.parcel, 'not_checked'); assert.ok(actual.evidence.some(value => value.includes(found.checkedAt)))
  const unavailable = await resolve('126.97, 37.58', { inputType: 'location', target: 'legal_region', level: 'ri' }, { ...provider, reverseLocation: async () => ({ ...found, legalCode: '1111018800' }) })
  assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.errors[0]?.code, 'REFERENCE_VERSION_MISMATCH')
  assert.equal(unavailable.output.code, undefined)
})

test('원천의 직접 행정동코드는 법정동의 여러 관할 후보로 바꾸지 않는다', async () => {
  const actual = await resolve('126.97, 37.58', { inputType: 'location', target: 'administrative_region', output: 'code' })
  assert.equal(actual.status, 'ok'); assert.equal(actual.output.code, '1111051500'); assert.equal(actual.candidates.length, 0)
  const fallback = await resolve('126.97, 37.58', { inputType: 'location', target: 'administrative_region', output: 'code' }, { ...provider, reverseLocation: async () => ({ ...found, administrativeCode: undefined }) })
  assert.equal(fallback.status, 'needs_selection'); assert.equal(fallback.output.code, undefined)
  assert.equal(fallback.candidates.length, 2)
})

test('도로명만 받은 위치에서 PNU나 법정동코드를 추측하지 않는다', async () => {
  const road = { ...provider, reverseLocation: async () => ({ ...found, address: '서울특별시 종로구 사직로 161', parcelAddress: '', roadAddress: '서울특별시 종로구 사직로 161', addressType: 'road' as const, legalCode: undefined }) }
  const actual = await resolve('126.97, 37.58', { inputType: 'location', target: 'pnu' }, road)
  assert.equal(actual.status, 'unavailable'); assert.equal(actual.errors[0]?.code, 'PARCEL_ADDRESS_UNAVAILABLE')
  assert.equal(actual.pnu, ''); assert.deepEqual(actual.output, {})
  const legal = await resolve('126.97, 37.58', { inputType: 'location', target: 'legal_region', level: 'ri' }, road)
  assert.equal(legal.errors[0]?.code, 'GEOCODER_CODE_UNAVAILABLE')
  const address = await resolve('126.97, 37.58', { inputType: 'location', target: 'address', output: 'name' }, road)
  assert.equal(address.output.name, '서울특별시 종로구 사직로 161')
})

test('구역에서 조회한 좌표는 대표점이고 지번주소의 좌표와 구분한다', async () => {
  const calls: Array<[string, string | undefined]> = []
  const service = { ...provider, forwardLocation: async (address: string, kind?: 'parcel' | 'road' | 'region') => {
    calls.push([address, kind]); return { ...point, method: kind === 'region' ? 'region_representative' as const : 'address_point' as const }
  } }
  const region = await resolve('1111010100', { inputType: 'pnu_legal', target: 'location' }, service)
  assert.equal(region.output.location_method, 'region_representative'); assert.equal(region.pnu, '')
  assert.deepEqual(calls[0], ['서울특별시 종로구 청운동', 'region'])
  const address = await resolve('서울특별시 종로구 청운동 1', { inputType: 'address', target: 'location' }, service)
  assert.equal(address.output.location_method, 'address_point'); assert.equal(address.output.crs, 'EPSG:4326')
  assert.deepEqual(calls[1], ['서울특별시 종로구 청운동 1', 'parcel'])
  assert.equal(address.parcel, 'not_checked'); assert.ok(address.warnings.includes(point.warning))
})

test('한도 초과·손상·잘못된 좌표는 원천 조회 전에 차단한다', async () => {
  let calls = 0
  const service = { ...provider, reverseLocation: async () => { calls++; return found } }
  await assert.rejects(() => resolveLocationRows(Array.from({ length: 21 }, (_, index) => row('126.97, 37.58', String(index))), { inputType: 'location', target: 'address' }, fixture, administrative, service), { code: 'LOCATION_ROW_LIMIT', statusCode: 413 })
  for (const value of ['37.58, 200', 'NaN, 37.58', '126.97, 37.58, 1']) assert.equal((await resolve(value, { inputType: 'location', target: 'address' }, service)).status, 'invalid')
  const damaged = await resolveLocationRows([{ ...row('126.97, 37.58'), issue: 'IDENTIFIER_PRECISION_LOSS' }], { inputType: 'location', target: 'address' }, fixture, administrative, service)
  assert.equal(damaged.rows[0]?.errors[0]?.code, 'IDENTIFIER_PRECISION_LOSS'); assert.equal(calls, 0)
})

test('조회 실패는 원문을 보존하고 좌표나 PNU 성공으로 채우지 않는다', async () => {
  const service = { ...provider, reverseLocation: async (): Promise<never> => { throw new LocationError('GEOCODER_AUTH_REQUIRED', '원천 권한을 확인하세요.', 'unavailable') } }
  const actual = await resolve('126.97, 37.58', { inputType: 'location', target: 'pnu' }, service)
  assert.equal(actual.status, 'unavailable'); assert.equal(actual.original.원문, '126.97, 37.58')
  assert.deepEqual(actual.output, {}); assert.equal(actual.pnu, ''); assert.equal(actual.parcel, 'not_checked')
})
