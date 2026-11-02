import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateRawSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import type { ReferenceSnapshot } from '../../shared/link/types.ts'
import { boundaryCapabilities, exportLegalBoundary } from '../../server/services/link/boundary.ts'

const reference: ReferenceSnapshot = {
  version: 'boundary-fixture-v1', available: true, source: '경계 테스트 전용 fixture', sourceUrl: 'https://example.invalid/fixture',
  sourceDate: null, checkedAt: null, activatedAt: null, coverage: 'fixture', regions: [
    { code: '1100000000', name: '시험시', fullName: '시험시', parentCode: null, level: 'sido', status: 'active' },
    { code: '1111000000', name: '시험구', fullName: '시험시 시험구', parentCode: '1100000000', level: 'sigungu', status: 'active' },
    { code: '1111010100', name: '시험동', fullName: '시험시 시험구 시험동', parentCode: '1111000000', level: 'eupmyeondong', status: 'active' },
    { code: '1111025000', name: '시험면', fullName: '시험시 시험구 시험면', parentCode: '1111000000', level: 'eupmyeondong', status: 'active' },
    { code: '1111025021', name: '시험리', fullName: '시험시 시험구 시험면 시험리', parentCode: '1111025000', level: 'ri', status: 'active' },
    { code: '1111010200', name: '폐지동', fullName: '시험시 시험구 폐지동', parentCode: '1111000000', level: 'eupmyeondong', status: 'retired' },
  ],
}
const outer = [[126, 36], [128, 36], [128, 38], [126, 38], [126, 36]]
const hole = [[126.5, 36.5], [126.5, 37], [127, 37], [127, 36.5], [126.5, 36.5]]
const other = [[129, 36], [130, 36], [130, 37], [129, 37], [129, 36]]
const polygon = { type: 'Polygon', coordinates: [outer, hole] }
function feature(geometry: unknown = polygon, properties: object = { emd_cd: '11110101' }, id = 'ADEMD.123') { return { type: 'Feature', id, properties, geometry } }
function response(features: unknown[] = [feature()], total = features.length) {
  return new Response(JSON.stringify({ response: { status: 'OK', record: { total: String(total) }, result: { featureCollection: { type: 'FeatureCollection', features } } } }))
}
async function mocked(run: (state: { calls: URL[]; privateValue: string }) => Promise<void>, handler?: (url: URL) => Response | Promise<Response>) {
  const previous = { fetch: globalThis.fetch, key: process.env.VWORLD_KEY, domain: process.env.VWORLD_DOMAIN }
  const state = { calls: [] as URL[], privateValue: 'boundary-test-private-' + randomUUID() }
  process.env.VWORLD_KEY = state.privateValue; process.env.VWORLD_DOMAIN = 'https://boundary-tests.example.invalid'
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)); state.calls.push(url)
    assert.equal(url.origin + url.pathname, 'https://api.vworld.kr/req/data')
    assert.equal(options?.redirect, 'error'); assert.ok(options?.signal)
    assert.equal(url.searchParams.get('key'), state.privateValue)
    return handler ? handler(url) : response()
  }
  try { await run(state) } finally {
    globalThis.fetch = previous.fetch
    if (previous.key === undefined) delete process.env.VWORLD_KEY; else process.env.VWORLD_KEY = previous.key
    if (previous.domain === undefined) delete process.env.VWORLD_DOMAIN; else process.env.VWORLD_DOMAIN = previous.domain
  }
}
function entries(zip: Buffer) {
  // 생성기와 독립적으로 ZIP 중앙 디렉터리와 deflate 데이터를 읽는다.
  const files: Record<string, Buffer> = {}
  let end = zip.length - 22
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--
  assert.ok(end >= 0)
  let offset = zip.readUInt32LE(end + 16)
  for (let index = 0; index < zip.readUInt16LE(end + 10); index++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50)
    const method = zip.readUInt16LE(offset + 10), size = zip.readUInt32LE(offset + 20)
    const nameLength = zip.readUInt16LE(offset + 28), extraLength = zip.readUInt16LE(offset + 30), commentLength = zip.readUInt16LE(offset + 32)
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'), local = zip.readUInt32LE(offset + 42)
    assert.equal(zip.readUInt32LE(local), 0x04034b50)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const compressed = zip.subarray(start, start + size)
    files[name] = method === 8 ? inflateRawSync(compressed) : compressed
    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}
function shapeRecords(shp: Buffer, shx: Buffer) {
  assert.equal(shp.readInt32BE(0), 9994); assert.equal(shp.readInt32LE(28), 1000); assert.equal(shp.readInt32LE(32), 5)
  assert.equal(shp.readInt32BE(24) * 2, shp.length); assert.equal(shx.readInt32BE(24) * 2, shx.length)
  const records: number[][][][] = []
  for (let offset = 100, index = 0; offset < shp.length; index++) {
    const length = shp.readInt32BE(offset + 4) * 2, start = offset + 8
    assert.equal(shx.readInt32BE(100 + index * 8) * 2, offset); assert.equal(shx.readInt32BE(104 + index * 8) * 2, length)
    assert.equal(shp.readInt32LE(start), 5)
    const partCount = shp.readInt32LE(start + 36), pointCount = shp.readInt32LE(start + 40), points: number[][] = []
    const indices = Array.from({ length: partCount }, (_, i) => shp.readInt32LE(start + 44 + i * 4))
    for (let i = 0; i < pointCount; i++) { const p = start + 44 + partCount * 4 + i * 16; points.push([shp.readDoubleLE(p), shp.readDoubleLE(p + 8)]) }
    records.push(indices.map((begin, i) => points.slice(begin, indices[i + 1] ?? pointCount)))
    offset += 8 + length
  }
  return records
}
function dbfRows(dbf: Buffer) {
  const count = dbf.readUInt32LE(4), header = dbf.readUInt16LE(8), length = dbf.readUInt16LE(10), fields: { name: string; size: number }[] = []
  for (let p = 32; dbf[p] !== 0x0d; p += 32) { assert.equal(dbf[p + 11], 67); fields.push({ name: dbf.subarray(p, p + 11).toString('ascii').replace(/\0.*$/, ''), size: dbf[p + 16]! }) }
  return Array.from({ length: count }, (_, index) => { let p = header + index * length + 1; return Object.fromEntries(fields.map(field => { const value = dbf.subarray(p, p + field.size).toString('ascii').trim(); p += field.size; return [field.name, value] })) })
}
function area(ring: number[][]) { return ring.slice(1).reduce((sum, point, index) => sum + ring[index]![0]! * point[1]! - point[0]! * ring[index]![1]!, 0) / 2 }
const rejects = (code: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === code

test('Polygon·구멍·MultiPolygon을 실제 SHP/SHX/DBF ZIP으로 출력하고 독립적으로 해독', async () => {
  await mocked(async ({ calls, privateValue }) => {
    const result = await exportLegalBoundary(['1111010100'], 'EPSG:4326', reference), files = entries(result.data), stem = 'legal-boundary-1111010100'
    assert.deepEqual(Object.keys(files).sort(), ['metadata.json', ...['.shp', '.shx', '.dbf', '.prj', '.cpg'].map(ext => stem + ext)].sort())
    const records = shapeRecords(files[stem + '.shp']!, files[stem + '.shx']!)
    assert.deepEqual(records.map(r => r.length), [2, 3]); assert.ok(area(records[0]![0]!) < 0); assert.ok(area(records[0]![1]!) > 0)
    assert.ok(area(records[1]![0]!) < 0); assert.ok(area(records[1]![1]!) > 0); assert.ok(area(records[1]![2]!) < 0)
    assert.deepEqual(records[0]![0], [...outer].reverse()); assert.deepEqual(records[0]![1], [...hole].reverse())
    assert.deepEqual(dbfRows(files[stem + '.dbf']!), [{ legal_cd: '1111010100', area_code: '11110101', source_id: 'ADEMD.123' }, { legal_cd: '1111010100', area_code: '11110101', source_id: 'ADEMD.456' }])
    assert.match(files[stem + '.prj']!.toString(), /WGS_1984/); assert.equal(files[stem + '.cpg']!.toString(), 'UTF-8')
    const metadata = JSON.parse(files['metadata.json']!.toString('utf8'))
    assert.equal(metadata.referenceVersion, 'boundary-fixture-v1'); assert.equal(metadata.sourceDate, null); assert.equal(metadata.selections[0].name, '시험시 시험구 시험동')
    assert.equal(result.features, 2); assert.equal(result.mime, 'application/zip'); assert.equal(calls.length, 1)
    assert.ok(!files['metadata.json']!.toString().includes(privateValue)); assert.equal(boundaryCapabilities().sourceAccess, 'available')
  }, () => response([feature(), feature({ type: 'MultiPolygon', coordinates: [[outer, hole], [other]] }, undefined, 'ADEMD.456')]))
})
test('2·5·8·10자리 코드는 등록 계층으로 고르고 리와 읍면동 원천을 구분', async () => {
  await mocked(async ({ calls }) => {
    for (const code of ['11', '11110', '11110101', '1111025021']) await exportLegalBoundary([code], 'EPSG:4326', reference)
    assert.deepEqual(calls.map(url => [url.searchParams.get('data'), url.searchParams.get('attrFilter')]), [
      ['LT_C_ADSIDO_INFO', 'ctprvn_cd:=:11'], ['LT_C_ADSIGG_INFO', 'sig_cd:=:11110'], ['LT_C_ADEMD_INFO', 'emd_cd:=:11110101'], ['LT_C_ADRI_INFO', 'li_cd:=:1111025021'],
    ])
  }, url => { const [field, code] = url.searchParams.get('attrFilter')!.split(':=:'); return response([feature(polygon, { [field!]: code })]) })
})
test('동일 구역·동시 요청은 원천 조회를 합치고 기준 버전과 이름은 각 요청에 고정', async () => {
  await mocked(async ({ calls }) => {
    const changed = { ...reference, version: 'boundary-fixture-v2', regions: reference.regions.map(r => ({ ...r, fullName: '변경 ' + r.fullName })) }
    const [first, second] = await Promise.all([exportLegalBoundary(['1111010100', '11110101'], 'EPSG:4326', reference), exportLegalBoundary(['11110101'], 'EPSG:4326', changed)])
    assert.equal(calls.length, 1); assert.equal(first.features, 1)
    const metadata = JSON.parse(entries(second.data)['metadata.json']!.toString())
    assert.equal(metadata.referenceVersion, 'boundary-fixture-v2'); assert.match(metadata.selections[0].name, /^변경 /)
  })
})
test('미등록·폐지·코드 길이·필터 삽입·원천 미준비·미지원 CRS를 구분', async () => {
  await mocked(async ({ calls }) => {
    for (const code of ['', '111', '11110101:=:x', '111101010000']) await assert.rejects(exportLegalBoundary([code], 'EPSG:4326', reference), rejects('INVALID_BOUNDARY_CODE'))
    await assert.rejects(exportLegalBoundary(['1111010300'], 'EPSG:4326', reference), rejects('BOUNDARY_CODE_UNKNOWN'))
    await assert.rejects(exportLegalBoundary(['1111010200'], 'EPSG:4326', reference), rejects('BOUNDARY_CODE_RETIRED'))
    await assert.rejects(exportLegalBoundary(['11'], 'EPSG:4326', { ...reference, available: false }), rejects('SOURCE_NOT_READY'))
    await assert.rejects(exportLegalBoundary(['11'], 'EPSG:5179', reference), rejects('BOUNDARY_UNSUPPORTED_CRS'))
    await assert.rejects(exportLegalBoundary(Array(21).fill('11'), 'EPSG:4326', reference), rejects('INVALID_BOUNDARY_CODE'))
    assert.equal(calls.length, 0)
  })
})
test('현재 코드에 0을 붙여 리를 만들지 않고 등록 읍면동으로 조회', async () => {
  await mocked(async ({ calls }) => {
    await exportLegalBoundary(['1111025000'], 'EPSG:4326', reference)
    assert.equal(calls[0]!.searchParams.get('data'), 'LT_C_ADEMD_INFO')
    assert.equal(calls[0]!.searchParams.get('attrFilter'), 'emd_cd:=:11110250')
  }, () => response([feature(polygon, { emd_cd: '11110250' })]))
})
for (const [name, geometry] of [
  ['점 도형', { type: 'Point', coordinates: [127, 37] }], ['빈 다각형', { type: 'Polygon', coordinates: [] }],
  ['열린 링', { type: 'Polygon', coordinates: [outer.slice(0, -1)] }], ['범위 밖 좌표', { type: 'Polygon', coordinates: [[[190, 0], [190, 1], [191, 1], [190, 0]]] }],
] as const) test(name + '을 가짜 경계로 출력하지 않음', async () => {
  await mocked(async () => { await assert.rejects(exportLegalBoundary(['11110101'], 'EPSG:4326', reference), rejects('BOUNDARY_INVALID_GEOMETRY')) }, () => response([feature(geometry)]))
})
for (const [name, handler, code] of [
  ['정상 조회 미일치', () => new Response(JSON.stringify({ response: { status: 'NOT_FOUND' } })), 'BOUNDARY_NO_MATCH'],
  ['다른 코드의 도형', () => response([feature(polygon, { emd_cd: '99999999' })]), 'BOUNDARY_CODE_MISMATCH'],
  ['일부 결과만 수신', () => response([feature()], 2), 'BOUNDARY_RESULT_LIMIT'],
  ['과대 응답', () => new Response('{}', { headers: { 'content-length': String(8 * 1024 ** 2 + 1) } }), 'BOUNDARY_RESPONSE_LIMIT'],
  ['비 JSON 응답', () => new Response('<html>failure</html>'), 'BOUNDARY_INVALID_RESPONSE'],
] as const) test(name + '을 오류 코드로 구분', async () => {
  await mocked(async () => { await assert.rejects(exportLegalBoundary(['11110101'], 'EPSG:4326', reference), rejects(code)) }, handler)
})
test('인증·네트워크 오류에 키·원천 메시지·요청 URL을 노출하지 않음', async () => {
  await mocked(async ({ privateValue }) => {
    await assert.rejects(exportLegalBoundary(['11110101'], 'EPSG:4326', reference), error => {
      assert.ok(rejects('BOUNDARY_AUTH_REQUIRED')(error)); assert.ok(!String(error).includes(privateValue)); assert.ok(!String(error).includes('api.vworld.kr')); return true
    })
    assert.equal(boundaryCapabilities().sourceAccess, 'auth_required'); assert.equal(boundaryCapabilities().state, 'source_unavailable')
  }, url => new Response(JSON.stringify({ response: { status: 'ERROR', error: { code: 'INCORRECT_KEY', text: url.href } } })))
  await mocked(async () => { await assert.rejects(exportLegalBoundary(['11110101'], 'EPSG:4326', reference), rejects('BOUNDARY_SOURCE_UNAVAILABLE')) }, () => { throw new Error('내부 URL·비밀 포함 오류는 공개하지 않음') })
})
test('자료 API 설정이 없으면 미확보를 미일치로 표시하지 않음', async () => {
  await mocked(async ({ calls }) => {
    delete process.env.VWORLD_DOMAIN
    await assert.rejects(exportLegalBoundary(['11110101'], 'EPSG:4326', reference), rejects('BOUNDARY_SETUP_REQUIRED'))
    assert.equal(boundaryCapabilities().state, 'setup_required'); assert.equal(calls.length, 0)
  })
})
test('도형 20개·좌표점 10만 개를 넘으면 SHP 출력 거절', async () => {
  await mocked(async () => { await assert.rejects(exportLegalBoundary(['11110101'], 'EPSG:4326', reference), rejects('BOUNDARY_RESULT_LIMIT')) }, () => response(Array.from({ length: 21 }, () => feature())))
  const oversizedRing = Array.from({ length: 100_001 }, (_, index) => [126 + index % 2, 36 + index % 3])
  oversizedRing[oversizedRing.length - 1] = oversizedRing[0]!
  await mocked(async () => { await assert.rejects(exportLegalBoundary(['11110101'], 'EPSG:4326', reference), rejects('BOUNDARY_GEOMETRY_LIMIT')) }, () => response([feature({ type: 'Polygon', coordinates: [oversizedRing] })]))
})
test('잘못된 전체 건수는 완전한 경계 결과로 주장하지 않음', async () => {
  await mocked(async () => { await assert.rejects(exportLegalBoundary(['11110101'], 'EPSG:4326', reference), rejects('BOUNDARY_INVALID_RESPONSE')) }, () => new Response(JSON.stringify({ response: { status: 'OK', record: { total: 'unknown' }, result: { featureCollection: { features: [feature()] } } } })))
})
