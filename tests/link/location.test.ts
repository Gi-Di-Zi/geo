import assert from 'node:assert/strict'
import test from 'node:test'
import { LOCATION_CRS, parseLocation, transformLocation, toWgs84 } from '../../shared/link/location.ts'
import { forwardLocation, getLocationCapabilities, reverseLocation } from '../../server/services/link/location.ts'

const originalFetch = globalThis.fetch
let keyNumber = 0
async function withProvider<T>(fetcher: typeof fetch, run: () => Promise<T>) {
  const oldKey = process.env.VWORLD_KEY, oldPublic = process.env.NUXT_PUBLIC_VWORLD_KEY
  process.env.VWORLD_KEY = 'LOCATION_TEST_' + ++keyNumber
  process.env.NUXT_PUBLIC_VWORLD_KEY = ''
  globalThis.fetch = fetcher
  try { return await run() }
  finally { globalThis.fetch = originalFetch; if (oldKey === undefined) delete process.env.VWORLD_KEY; else process.env.VWORLD_KEY = oldKey; if (oldPublic === undefined) delete process.env.NUXT_PUBLIC_VWORLD_KEY; else process.env.NUXT_PUBLIC_VWORLD_KEY = oldPublic }
}
const json = (response: object) => new Response(JSON.stringify({ response }), { headers: { 'Content-Type': 'application/json' } })
const forward = () => json({ status: 'OK', result: { crs: 'EPSG:4326', point: { x: '126.9778863587207', y: '37.576976230338815' } } })

test('위치는 X·Y 두 숫자로 검증하며 코드와 다르게 좌표 숫자로만 해석한다', () => {
  assert.deepEqual(parseLocation('126.98, 37.57'), { x: 126.98, y: 37.57, crs: 'EPSG:4326' })
  assert.deepEqual(parseLocation('1e6 2e6', 'EPSG:5179'), { x: 1000000, y: 2000000, crs: 'EPSG:5179' })
  for (const value of ['', '126', '126,37,1', 'NaN,37', 'Infinity,37', '1e999,37', '126도,37도', '37.5,127']) assert.throws(() => parseLocation(value))
  assert.throws(() => parseLocation('126,37', 'EPSG:999999'), { code: 'UNSUPPORTED_CRS' })
})
test('국내 EPSG 원점과 5개 좌표계 왕복에서 경도·위도 및 동·북 축을 유지한다', () => {
  const unified = transformLocation({ x: 127.5, y: 38, crs: 'EPSG:4326' }, 'EPSG:5179')
  assert.ok(Math.abs(unified.x - 1000000) < .001); assert.ok(Math.abs(unified.y - 2000000) < .001)
  for (const [crs, north] of [['EPSG:5186', 600000], ['EPSG:5181', 500000]] as const) {
    const point = transformLocation({ x: 127, y: 38, crs: 'EPSG:4326' }, crs)
    assert.ok(Math.abs(point.x - 200000) < .001); assert.ok(Math.abs(point.y - north) < .001)
  }
  const original = { x: 126.9778863587207, y: 37.576976230338815, crs: 'EPSG:4326' as const }
  for (const crs of LOCATION_CRS) {
    const result = toWgs84(transformLocation(original, crs))
    assert.ok(Math.abs(result.lon - original.x) < 1e-7, crs)
    assert.ok(Math.abs(result.lat - original.y) < 1e-7, crs)
  }
})
test('EPSG 범위·알 수 없는 CRS·유한하지 않은 값은 원천 호출 전에 차단한다', async () => {
  let calls = 0
  await withProvider(async () => { calls++; return forward() }, async () => {
    await assert.rejects(reverseLocation({ x: 37, y: 127, crs: 'EPSG:4326' }), { code: 'COORDINATE_RANGE' })
    await assert.rejects(reverseLocation({ x: 0, y: 0, crs: 'EPSG:4326' }), { code: 'OUT_OF_COVERAGE' })
    assert.throws(() => transformLocation({ x: Number.NaN, y: 37, crs: 'EPSG:4326' }, 'EPSG:5179'))
    assert.throws(() => transformLocation({ x: 0, y: 21000000, crs: 'EPSG:3857' }, 'EPSG:4326'))
  })
  assert.equal(calls, 0)
})
test('주소 좌표와 지역명 대표 위치의 의미를 구분하고 키를 결과에 포함하지 않는다', async () => {
  await withProvider(async (input, options) => {
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://api.vworld.kr'); assert.equal(url.pathname, '/req/address')
    assert.equal(options?.redirect, 'error'); assert.equal(url.searchParams.get('refine'), 'false')
    return forward()
  }, async () => {
    const address = await forwardLocation('서울특별시 종로구 사직로 161', 'road')
    assert.equal(address.method, 'address_point'); assert.match(address.warning, /필지 중심점/)
    const region = await forwardLocation('서울특별시 종로구 청운효자동', 'region')
    assert.equal(region.method, 'region_representative'); assert.match(region.warning, /대표 위치/)
    assert.ok(!JSON.stringify(region).includes(process.env.VWORLD_KEY!))
  })
})
test('동일 주소의 동시 요청을 공유하고 긍정 결과를 짧게 재사용한다', async () => {
  let calls = 0
  await withProvider(async () => { calls++; await new Promise(done => setTimeout(done, 5)); return forward() }, async () => {
    const [one, two] = await Promise.all([forwardLocation('서울특별시 종로구 사직로 161', 'road'), forwardLocation('서울특별시 종로구 사직로 161', 'road')])
    assert.equal(one.lon, two.lon)
    await forwardLocation('서울특별시 종로구 사직로 161', 'road')
  })
  assert.equal(calls, 1)
})
test('역지오코딩은 지번의 법정동코드와 별도 행정동코드를 사용한다', async () => {
  await withProvider(async input => {
    const url = new URL(String(input)); assert.equal(url.searchParams.get('request'), 'getAddress')
    return json({ status: 'OK', result: [
      { type: 'parcel', text: '서울특별시 종로구 세종로 1-58', zipcode: '03045', structure: { level4LC: '1111011900', level4AC: '1111051500', level5: '1-58대' } },
      { type: 'road', text: '서울특별시 종로구 사직로 161', zipcode: '03045', structure: { level4LC: '3100005', level4AC: '1111051500' } },
    ] })
  }, async () => {
    const result = await reverseLocation({ x: 126.9769, y: 37.5759, crs: 'EPSG:4326' })
    assert.equal(result.legalCode, '1111011900'); assert.equal(result.administrativeCode, '1111051500')
    assert.equal(result.addressType, 'parcel'); assert.match(result.parcelAddress, /세종로 1-58/)
    assert.equal(result.method, 'reverse_geocoded')
    // 우편번호는 5자리만, 지번 뒤 지목 약자는 뗀다.
    assert.equal(result.postcode, '03045'); assert.equal(result.parcelNumber, '1-58')
  })
})
test('도로명 결과의 level4LC를 법정동으로 오인하거나 지번을 만들지 않는다', async () => {
  await withProvider(async () => json({ status: 'OK', result: [{ type: 'road', text: '서울특별시 종로구 사직로 161', structure: { level4LC: '3100005', level4AC: '1111051500' } }] }), async () => {
    const result = await reverseLocation({ x: 126.9769, y: 37.5759, crs: 'EPSG:4326' })
    assert.equal(result.legalCode, undefined); assert.equal(result.parcelAddress, '')
    assert.equal(result.addressType, 'road'); assert.equal(result.administrativeCode, '1111051500')
  })
})
test('원천 미일치·API 인증·장애·손상 응답을 구분하고 비밀을 오류에 남기지 않는다', async () => {
  const cases: Array<[() => Response, string, string]> = [
    [() => json({ status: 'NOT_FOUND' }), 'GEOCODER_NO_MATCH', 'not_found'],
    [() => json({ status: 'ERROR', error: { code: 'INVALID_KEY', text: 'DO_NOT_EXPOSE' } }), 'GEOCODER_AUTH_REQUIRED', 'unavailable'],
    [() => new Response('', { status: 429 }), 'GEOCODER_LIMIT', 'unavailable'],
    [() => new Response('not json'), 'GEOCODER_INVALID_RESPONSE', 'unavailable'],
    [() => json({ status: 'OK', result: { crs: 'EPSG:3857', point: { x: '126', y: '37' } } }), 'GEOCODER_INVALID_RESPONSE', 'unavailable'],
    [() => json({ status: 'OK', result: { crs: 'EPSG:4326', point: { x: { toString: 'not callable' }, y: '37' } } }), 'GEOCODER_INVALID_RESPONSE', 'unavailable'],
  ]
  for (const [response, code, status] of cases) await withProvider(async () => response(), async () => {
    await assert.rejects(forwardLocation('테스트 주소', 'road'), (error: any) => error.code === code && error.status === status && !error.message.includes('DO_NOT_EXPOSE'))
  })
  await withProvider(async () => { throw new Error('request URL key=DO_NOT_EXPOSE') }, async () => {
    await assert.rejects(forwardLocation('테스트 주소', 'road'), (error: any) => error.code === 'GEOCODER_UNAVAILABLE' && !error.message.includes('DO_NOT_EXPOSE'))
  })
})
test('키 미설정·응답 크기·동시 호출 상한을 적용한다', async () => {
  await withProvider(async () => forward(), async () => {
    process.env.VWORLD_KEY = ''
    assert.equal(getLocationCapabilities().state, 'setup_required')
    await assert.rejects(forwardLocation('서울특별시 종로구'), { code: 'GEOCODER_SETUP_REQUIRED' })
  })
  await withProvider(async () => new Response('', { headers: { 'content-length': String(1024 ** 2 + 1) } }), async () => {
    await assert.rejects(forwardLocation('서울특별시 종로구'), { code: 'GEOCODER_RESPONSE_LIMIT' })
  })
  let active = 0, maximum = 0
  await withProvider(async () => { active++; maximum = Math.max(maximum, active); await new Promise(done => setTimeout(done, 5)); active--; return forward() }, async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => forwardLocation('조회 ' + i, 'region')))
  })
  assert.equal(maximum, 4)
})
