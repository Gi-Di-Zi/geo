import { createHash } from 'node:crypto'
import { LOCATION_CRS, LocationError, toWgs84 } from '../../../shared/link/location.ts'
import type { LocationPoint } from '../../../shared/link/location.ts'

export { LocationError } from '../../../shared/link/location.ts'
export const LOCATION_SOURCE = 'VWorld Geocoder 2.0'
export const LOCATION_SOURCE_URL = 'https://www.vworld.kr/dev/v4dv_geocoderguide2_s001.do'
const ENDPOINT = 'https://api.vworld.kr/req/address'
// 검색 API: 도로명주소 → 건물의 대표지번 PNU(id)·우편번호·건물 좌표, 행정구역 → 대표점(시도청·시군구청 등)
const SEARCH = 'https://api.vworld.kr/req/search'
const BASE: Record<string, Record<string, string>> = {
  [ENDPOINT]: { service: 'address', version: '2.0', crs: 'EPSG:4326', format: 'json', errorFormat: 'json', simple: 'false', refine: 'false' },
  [SEARCH]: { service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326', format: 'json', errorFormat: 'json', size: '10' },
}
const key = () => process.env.VWORLD_KEY?.trim() || process.env.NUXT_PUBLIC_VWORLD_KEY?.trim() || ''
const metadata = (method: 'address_point' | 'region_representative' | 'reverse_geocoded', checkedAt: string) => ({ source: LOCATION_SOURCE, sourceUrl: LOCATION_SOURCE_URL, sourceDate: null, checkedAt, method })
type Meta = ReturnType<typeof metadata>
export type ForwardLocation = Meta & { x: number; y: number; lon: number; lat: number; crs: 'EPSG:4326'; warning: string }
export type ReverseLocation = ForwardLocation & { address: string; parcelAddress: string; roadAddress: string; addressType: 'parcel' | 'road'; legalCode?: string; administrativeCode?: string; postcode?: string; parcelNumber?: string }
const cache = new Map<string, { expires: number; data: unknown }>(), pending = new Map<string, Promise<unknown>>()
let active = 0
const waiting: Array<() => void> = []
async function limited<T>(run: () => Promise<T>) {
  if (active >= 2) {
    if (waiting.length >= 40) throw new LocationError('GEOCODER_BUSY', '위치 조회 요청이 많습니다. 잠시 뒤 다시 시도하세요.', 'unavailable')
    await new Promise<void>(resolve => waiting.push(resolve))
  } else active++
  try { return await run() } finally { const next = waiting.shift(); if (next) next(); else active-- }
}
async function request(parameters: Record<string, string>, endpoint = ENDPOINT): Promise<Record<string, any>> {
  const apiKey = key()
  if (!apiKey) throw new LocationError('GEOCODER_SETUP_REQUIRED', '위치 조회를 위한 VWorld API 키가 서버에 설정되지 않았습니다.', 'unavailable')
  const fingerprint = createHash('sha256').update(endpoint + JSON.stringify(parameters) + apiKey).digest('hex')
  const cached = cache.get(fingerprint)
  if (cached && cached.expires > Date.now()) return cached.data as Record<string, any>
  const existing = pending.get(fingerprint)
  if (existing) return existing as Promise<Record<string, any>>
  const operation = limited(async () => {
    const url = new URL(endpoint)
    for (const [name, value] of Object.entries({ ...BASE[endpoint], ...parameters, key: apiKey })) url.searchParams.set(name, value)
    let response: Response
    try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) }) }
    catch { throw new LocationError('GEOCODER_UNAVAILABLE', '위치 조회 원천에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.', 'unavailable') }
    if (response.status === 401 || response.status === 403) throw new LocationError('GEOCODER_AUTH_REQUIRED', 'VWorld API 키와 허용 도메인 설정을 확인하세요.', 'unavailable')
    if (response.status === 429) throw new LocationError('GEOCODER_LIMIT', '위치 조회 원천의 호출 한도에 도달했습니다.', 'unavailable')
    if (!response.ok || !response.body) throw new LocationError('GEOCODER_UNAVAILABLE', '위치 조회 원천의 응답을 확인할 수 없습니다.', 'unavailable')
    if (Number(response.headers.get('content-length') || 0) > 1024 ** 2) { await response.body.cancel(); throw new LocationError('GEOCODER_RESPONSE_LIMIT', '위치 조회 응답 크기 한도를 넘었습니다.', 'unavailable') }
    let value: unknown
    try {
      const parts: Uint8Array[] = []; let size = 0
      for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) { if ((size += part.length) > 1024 ** 2) throw new Error('size'); parts.push(part) }
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)))
    } catch { throw new LocationError('GEOCODER_INVALID_RESPONSE', '위치 조회 원천의 응답 형식이나 크기를 확인할 수 없습니다.', 'unavailable') }
    const data = value && typeof value === 'object' && 'response' in value ? (value as { response: Record<string, any> }).response : undefined
    if (!data || typeof data !== 'object') throw new LocationError('GEOCODER_INVALID_RESPONSE', '위치 조회 원천의 응답 형식이 올바르지 않습니다.', 'unavailable')
    if (data.status === 'NOT_FOUND') throw new LocationError('GEOCODER_NO_MATCH', '지원하는 원천에서 대응하는 위치·주소를 찾지 못했습니다.', 'not_found')
    if (data.status !== 'OK') {
      if (/KEY|DOMAIN|AUTH/i.test(typeof data.error?.code === 'string' ? data.error.code : '')) throw new LocationError('GEOCODER_AUTH_REQUIRED', 'VWorld API 키와 허용 도메인 설정을 확인하세요.', 'unavailable')
      throw new LocationError('GEOCODER_SOURCE_ERROR', '위치 조회 원천이 요청을 처리하지 못했습니다.', 'unavailable')
    }
    // 원문 주소·좌표는 짧은 메모리 캐시에만 남기고 로그·디스크에 기록하지 않는다.
    const result = { status: 'OK', result: data.result, checkedAt: new Date().toISOString() }
    cache.set(fingerprint, { expires: Date.now() + 60_000, data: result })
    for (const [id, item] of cache) if (item.expires < Date.now() || cache.size > 256) cache.delete(id)
    return result
  })
  pending.set(fingerprint, operation)
  try { return await operation } finally { pending.delete(fingerprint) }
}
const text = (value: unknown) => typeof value === 'string' && value.length <= 2000 ? value.trim() : ''
const code = (value: unknown) => typeof value === 'string' && /^\d{10}$/.test(value) ? value : undefined
const zip = (value: unknown) => typeof value === 'string' && /^\d{5}$/.test(value) ? value : undefined
function korea(point: { lon: number; lat: number }) {
  if (point.lon < 122 || point.lon > 135 || point.lat < 28 || point.lat > 41) throw new LocationError('OUT_OF_COVERAGE', '국내 주소 조회 범위 밖의 위치입니다. 좌표계와 X·Y 순서를 확인하세요.', 'unavailable')
  return point
}
export function getLocationCapabilities() {
  return { state: key() ? 'available' : 'setup_required', crs: LOCATION_CRS, source: LOCATION_SOURCE, sourceUrl: LOCATION_SOURCE_URL, axisOrder: 'X=easting/longitude, Y=northing/latitude', maxRows: 20, globalConcurrency: 2, cacheSeconds: 60, warning: '주소 좌표와 구역 대표점은 필지 중심점·관할 경계의 확정값이 아닙니다.' }
}
export interface RoadMatch { pnu: string; road: string; parcel: string; building: string; postcode?: string; lon: number; lat: number; checkedAt: string }
/** 도로명주소 검색 (VWorld 검색 API, 도로명주소 DB): 건물마다 대표지번 PNU·도로명·지번·우편번호·건물 좌표. 같은 주소의 동(본관·신관)은 PNU가 같다 */
export async function searchRoad(address: string): Promise<RoadMatch[]> {
  if (!address.trim() || address.length > 200 || /[\u0000-\u001f]/.test(address)) throw new LocationError('INVALID_ADDRESS', '조회할 주소를 확인하세요.')
  const data = await request({ query: address.trim(), type: 'address', category: 'road' }, SEARCH)
  const items: Array<Record<string, any>> = Array.isArray(data.result?.items) ? data.result.items : []
  return items.flatMap(item => {
    const lon = Number(item.point?.x), lat = Number(item.point?.y)
    if (typeof item.id !== 'string' || !/^\d{19}$/.test(item.id) || !(lon >= 122 && lon <= 135 && lat >= 28 && lat <= 41)) return []
    return [{ pnu: item.id, road: text(item.address?.road), parcel: text(item.address?.parcel), building: text(item.address?.bldnm), postcode: zip(item.address?.zipcode), lon, lat, checkedAt: data.checkedAt }]
  })
}
/** 법정구역 대표점 (VWorld 검색 API 행정구역: L1 시도·L2 시군구·L4 읍면동, 리는 없음). 결과 id가 요청 코드와 같을 때만 */
async function district(name: string, code: string) {
  const digits = code.endsWith('00000000') ? 2 : code.endsWith('00000') ? 5 : code.endsWith('00') ? 8 : 0
  if (!digits || !/^\d{10}$/.test(code)) return undefined
  const data = await request({ query: name, type: 'district', category: { 2: 'L1', 5: 'L2', 8: 'L4' }[digits]! }, SEARCH).catch(() => undefined)
  const items: Array<Record<string, any>> = Array.isArray(data?.result?.items) ? data.result.items : []
  const item = items.find(i => i.id === code.slice(0, digits)), lon = Number(item?.point?.x), lat = Number(item?.point?.y)
  return item && lon >= 122 && lon <= 135 && lat >= 28 && lat <= 41 ? { lon, lat, checkedAt: data!.checkedAt as string } : undefined
}
export async function forwardLocation(address: string, type: 'parcel' | 'road' | 'region' = 'parcel', regionCode = ''): Promise<ForwardLocation> {
  if (!['parcel', 'road', 'region'].includes(type) || !address.trim() || address.length > 2000 || /[\u0000-\u001f]/.test(address)) throw new LocationError('INVALID_ADDRESS', '조회할 주소·지역명을 확인하세요.')
  // 지역은 행정구역 대표점을 먼저 쓴다. 지오코더에 지역명을 넣으면 그 안의 아무 필지 좌표가 나온다
  const center = type === 'region' && regionCode ? await district(address.trim(), regionCode) : undefined
  if (center) return { x: center.lon, y: center.lat, lon: center.lon, lat: center.lat, crs: 'EPSG:4326', ...metadata('region_representative', center.checkedAt), source: 'VWorld 검색 API (행정구역)', warning: '원천의 행정구역 대표점(시도청·시군구청 등)입니다. 구역 중심점이나 경계를 확정한 결과가 아닙니다.' }
  const data = await request({ request: 'getCoord', address: address.trim(), type: type === 'road' ? 'road' : 'parcel' })
  const raw = data.result?.point
  const x = typeof raw?.x === 'string' || typeof raw?.x === 'number' ? String(raw.x) : '', y = typeof raw?.y === 'string' || typeof raw?.y === 'number' ? String(raw.y) : ''
  if (!raw || (data.result.crs && data.result.crs !== 'EPSG:4326') || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(x) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(y)) throw new LocationError('GEOCODER_INVALID_RESPONSE', '원천이 유효한 좌표를 제공하지 않았습니다.', 'unavailable')
  let point: ReturnType<typeof toWgs84>
  try { point = korea(toWgs84({ x: Number(raw.x), y: Number(raw.y), crs: 'EPSG:4326' })) }
  catch { throw new LocationError('GEOCODER_INVALID_RESPONSE', '원천의 좌표가 국내 조회 범위와 맞지 않습니다.', 'unavailable') }
  return { ...point, ...metadata(type === 'region' ? 'region_representative' : 'address_point', data.checkedAt), warning: type === 'region' ? '지역명으로 조회한 원천의 대표 위치입니다. 구역 중심점·개별 필지 위치·관할 경계를 확정한 결과가 아닙니다.' : '원천의 주소 대표 좌표입니다. 필지 중심점이나 지적 경계를 확인한 결과가 아닙니다.' }
}
export async function reverseLocation(input: LocationPoint): Promise<ReverseLocation> {
  const point = korea(toWgs84(input))
  const data = await request({ request: 'getAddress', point: point.lon + ',' + point.lat, type: 'both' })
  if (!Array.isArray(data.result)) throw new LocationError('GEOCODER_INVALID_RESPONSE', '원천의 주소 응답 형식이 올바르지 않습니다.', 'unavailable')
  const parcel = data.result.find((row: Record<string, unknown>) => row?.type === 'parcel' && text(row.text)), road = data.result.find((row: Record<string, unknown>) => row?.type === 'road' && text(row.text))
  if (!parcel && !road) throw new LocationError('GEOCODER_NO_MATCH', '지원하는 원천에서 해당 위치의 주소를 찾지 못했습니다.', 'not_found')
  const addressType = parcel ? 'parcel' : 'road'
  return { ...point, ...metadata('reverse_geocoded', data.checkedAt), address: text(parcel?.text) || text(road?.text), parcelAddress: text(parcel?.text), roadAddress: text(road?.text), addressType,
    // 도로명 응답의 level4LC는 도로명코드이므로 법정동코드로 사용하지 않는다.
    legalCode: code(parcel?.structure?.level4LC), administrativeCode: code(parcel?.structure?.level4AC) || code(road?.structure?.level4AC),
    // 원천이 지번 뒤에 지목 약자(학·대 등)를 붙이는 경우가 있어 지번만 남긴다.
    postcode: zip(road?.zipcode) || zip(parcel?.zipcode), parcelNumber: text(parcel?.structure?.level5).replace(/[가-힣]+$/, ''), warning: '원천의 역지오코딩 주소·관할 코드입니다. 경계선의 포함 관계나 실제 필지 존재를 확정하지 않습니다.' }
}
