import { createHash } from 'node:crypto'
import archiver from 'archiver'
import { write as writeShape } from '@mapbox/shp-write'
import type { ReferenceSnapshot, RegionLevel } from '../../../shared/link/types.ts'
import { getReference } from './reference.ts'
import { LinkServiceError } from './files.ts'

const ENDPOINT = 'https://api.vworld.kr/req/data'
export const BOUNDARY_SOURCE_URL = 'https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=ademd'
export const BOUNDARY_MAX_CODES = 20
const MAX_BYTES = 8 * 1024 ** 2, MAX_POINTS = 100_000, MAX_FEATURES = 20
const WGS84_PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]'
const layers: Record<RegionLevel, { data: string; field: string; length: number }> = {
  sido: { data: 'LT_C_ADSIDO_INFO', field: 'ctprvn_cd', length: 2 },
  sigungu: { data: 'LT_C_ADSIGG_INFO', field: 'sig_cd', length: 5 },
  eupmyeondong: { data: 'LT_C_ADEMD_INFO', field: 'emd_cd', length: 8 },
  ri: { data: 'LT_C_ADRI_INFO', field: 'li_cd', length: 10 },
}
const key = () => process.env.VWORLD_KEY?.trim() || process.env.NUXT_PUBLIC_VWORLD_KEY?.trim() || ''
const domain = () => (process.env.VWORLD_DOMAIN || process.env.PUBLIC_URL || '').trim()
const error = (code: string, message: string, status = 503) => new LinkServiceError(code, message, status)
let lastSourceState: 'not_checked' | 'available' | 'auth_required' = 'not_checked'
export function boundaryCapabilities() {
  const configured = !!key() && !!domain()
  return { state: !configured ? 'setup_required' : lastSourceState === 'auth_required' ? 'source_unavailable' : lastSourceState === 'available' ? 'available' : 'not_checked', configured, sourceAccess: lastSourceState,
    reason: lastSourceState === 'auth_required' ? 'VWorld 경계 원천이 인증을 거절했습니다. 2D 데이터 API 권한과 등록 도메인을 확인하세요.' : configured ? '서버 설정 여부이며 실제 원천 접근 성공은 조회 시 확인합니다.' : 'VWorld 2D 데이터 API 키와 등록 서비스 URL(VWORLD_DOMAIN)이 필요합니다.',
    crs: ['EPSG:4326'], units: ['sido', 'sigungu', 'eupmyeondong', 'ri'], maxCodes: BOUNDARY_MAX_CODES,
    source: 'VWorld 2D Data API 법정 행정구역 경계', sourceUrl: BOUNDARY_SOURCE_URL, sourceDate: null }
}
interface Selection { requested: string; code: string; fullCode: string; name: string; level: RegionLevel; data: string; field: string }
type Ring = number[][]
interface BoundaryFeature { selection: Selection; sourceId: string; rings: Ring[] }
function selectCodes(codes: string[], snapshot: ReferenceSnapshot): Selection[] {
  if (!Array.isArray(codes) || !codes.length || codes.length > BOUNDARY_MAX_CODES || codes.some(code => typeof code !== 'string' || !/^(?:\d{2}|\d{5}|\d{8}|\d{10})$/.test(code))) throw error('INVALID_BOUNDARY_CODE', '경계는 2·5·8·10자리 법정구역 코드를 최대 20개까지 지정하세요.', 400)
  if (!snapshot.available) throw error('SOURCE_NOT_READY', '법정구역 기준 자료가 준비되지 않았습니다.', 409)
  const result = new Map<string, Selection>()
  for (const requested of codes) {
    const region = snapshot.regions.find(region => region.status === 'active' && (requested.length === 10 ? region.code === requested : layers[region.level].length === requested.length && region.code.slice(0, requested.length) === requested))
    if (!region) {
      if (snapshot.regions.some(region => region.status === 'retired' && region.code === requested)) throw error('BOUNDARY_CODE_RETIRED', '폐지된 법정구역의 현재 경계는 조회할 수 없습니다.', 400)
      throw error('BOUNDARY_CODE_UNKNOWN', '현재 법정구역 사전에서 지정한 코드를 확인할 수 없습니다.', 400)
    }
    const layer = layers[region.level], code = region.code.slice(0, layer.length)
    result.set(layer.data + ':' + code, { requested, code, fullCode: region.code, name: region.fullName, level: region.level, data: layer.data, field: layer.field })
  }
  return [...result.values()]
}
const cache = new Map<string, { expires: number; features: BoundaryFeature[] }>(), pending = new Map<string, Promise<BoundaryFeature[]>>()
let active = 0
function ringArea(ring: Ring) { let area = 0; for (let i = 0; i < ring.length - 1; i++) area += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!; return area / 2 }
/** SHP는 바깥 링 시계·구멍 반시계 방향을 사용한다. 원천의 링 구성은 유지한다. */
function ringsOf(geometry: unknown, count: { points: number }): Ring[] {
  if (!geometry || typeof geometry !== 'object' || !('type' in geometry) || !('coordinates' in geometry)) throw error('BOUNDARY_INVALID_GEOMETRY', '원천 경계 도형의 형식을 확인할 수 없습니다.')
  const { type, coordinates } = geometry as { type: string; coordinates: unknown }
  if (!['Polygon', 'MultiPolygon'].includes(type) || !Array.isArray(coordinates)) throw error('BOUNDARY_INVALID_GEOMETRY', '다각형 경계만 SHP로 출력할 수 있습니다.')
  const polygons = type === 'Polygon' ? [coordinates] : coordinates
  const rings: Ring[] = []
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw error('BOUNDARY_INVALID_GEOMETRY', '비어 있는 경계 도형입니다.')
    for (let index = 0; index < polygon.length; index++) {
      const ring = polygon[index]
      if (!Array.isArray(ring) || ring.length < 4 || (count.points += ring.length) > MAX_POINTS) throw error('BOUNDARY_GEOMETRY_LIMIT', '경계 점 수가 한도를 넘거나 링 구조가 잘못되었습니다.', 413)
      const points: Ring = ring.map(value => {
        if (!Array.isArray(value) || value.length < 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number' || !Number.isFinite(value[0]) || !Number.isFinite(value[1]) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw error('BOUNDARY_INVALID_GEOMETRY', '경계 좌표가 WGS84 경도·위도 범위가 아닙니다.')
        return [value[0], value[1]]
      })
      if (points[0]![0] !== points.at(-1)![0] || points[0]![1] !== points.at(-1)![1]) throw error('BOUNDARY_INVALID_GEOMETRY', '닫히지 않은 경계 링입니다.')
      const area = ringArea(points)
      if (!area) throw error('BOUNDARY_INVALID_GEOMETRY', '면적이 없는 경계 링입니다.')
      rings.push((index === 0 ? area > 0 : area < 0) ? points.reverse() : points)
    }
  }
  if (!rings.length) throw error('BOUNDARY_INVALID_GEOMETRY', '비어 있는 경계 도형입니다.')
  return rings
}
async function sourceFeatures(selection: Selection): Promise<BoundaryFeature[]> {
  const apiKey = key(), registered = domain()
  if (!apiKey || !registered) throw error('BOUNDARY_SETUP_REQUIRED', 'VWorld 2D 데이터 API 키와 등록 서비스 URL(VWORLD_DOMAIN)을 설정해 주세요.')
  try { const value = new URL(registered); if (!/^https?:$/.test(value.protocol) || value.username || value.password) throw new Error() } catch { throw error('BOUNDARY_SETUP_REQUIRED', 'VWORLD_DOMAIN에는 키에 등록한 http·https 서비스 URL을 설정하세요.') }
  const fingerprint = createHash('sha256').update(apiKey + registered + selection.data + selection.code).digest('hex')
  const saved = cache.get(fingerprint)
  if (saved && saved.expires > Date.now()) return saved.features
  const running = pending.get(fingerprint)
  if (running) return running
  if (active >= 2) throw error('BOUNDARY_BUSY', '다른 경계 조회가 진행 중입니다. 잠시 뒤 다시 시도하세요.', 429)
  const operation = (async () => {
    active++
    try {
      const url = new URL(ENDPOINT)
      for (const [name, value] of Object.entries({ service: 'data', request: 'GetFeature', version: '2.0', data: selection.data, attrFilter: selection.field + ':=:' + selection.code, geometry: 'true', attribute: 'true', crs: 'EPSG:4326', format: 'json', size: String(MAX_FEATURES + 1), key: apiKey, domain: registered })) url.searchParams.set(name, value)
      let response: Response
      try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) }) } catch { throw error('BOUNDARY_SOURCE_UNAVAILABLE', '법정동 경계 원천에 연결하지 못했습니다.') }
      if (response.status === 401 || response.status === 403) { lastSourceState = 'auth_required'; throw error('BOUNDARY_AUTH_REQUIRED', 'VWorld 경계 API 권한과 등록 서비스 URL을 확인하세요.') }
      if (!response.ok || !response.body) throw error('BOUNDARY_SOURCE_UNAVAILABLE', '경계 원천의 응답을 확인할 수 없습니다.')
      if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) { await response.body.cancel(); throw error('BOUNDARY_RESPONSE_LIMIT', '경계 원천의 응답 크기 한도를 넘었습니다.', 413) }
      let value: any
      try {
        const parts: Uint8Array[] = []; let bytes = 0
        for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) { if ((bytes += part.length) > MAX_BYTES) throw new Error(); parts.push(part) }
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)))
      } catch { throw error('BOUNDARY_INVALID_RESPONSE', '경계 원천의 응답 형식이나 크기가 올바르지 않습니다.') }
      const result = value?.response
      if (result?.status === 'NOT_FOUND') throw error('BOUNDARY_NO_MATCH', '경계 원천에서 이 법정구역 코드에 해당하는 도형을 찾지 못했습니다.', 404)
      if (result?.status !== 'OK') {
        if (/KEY|DOMAIN|AUTH/i.test(String(result?.error?.code || ''))) { lastSourceState = 'auth_required'; throw error('BOUNDARY_AUTH_REQUIRED', 'VWorld 경계 원천이 인증을 거절했습니다. 키의 2D 데이터 API 권한과 등록 도메인을 확인하세요.') }
        throw error('BOUNDARY_SOURCE_UNAVAILABLE', '경계 원천이 요청을 처리하지 못했습니다.')
      }
      const features = result.result?.featureCollection?.features
      if (!Array.isArray(features) || !features.length) throw error('BOUNDARY_NO_MATCH', '정상 조회했으나 이 법정구역의 경계 도형이 없습니다.', 404)
      const total = Number(result.record?.total)
      if (!Number.isSafeInteger(total) || total < features.length) throw error('BOUNDARY_INVALID_RESPONSE', '경계 원천의 전체 결과 수를 확인할 수 없습니다.')
      if (features.length > MAX_FEATURES || total > features.length) throw error('BOUNDARY_RESULT_LIMIT', '경계 조회 결과가 한도를 넘었습니다. 입력 구역을 나누어 주세요.', 413)
      const count = { points: 0 }
      const normalized = features.map((feature: any, index: number): BoundaryFeature => {
        if (feature?.type !== 'Feature' || feature?.properties?.[selection.field] !== selection.code) throw error('BOUNDARY_CODE_MISMATCH', '원천 도형의 법정구역 코드가 요청한 코드와 다릅니다.')
        const sourceId = typeof feature.id === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(feature.id) ? feature.id : selection.data + '.' + index
        return { selection, sourceId, rings: ringsOf(feature.geometry, count) }
      })
      lastSourceState = 'available'
      cache.set(fingerprint, { expires: Date.now() + 5 * 60_000, features: normalized })
      for (const [id, item] of cache) if (item.expires < Date.now() || cache.size > 100) cache.delete(id)
      return normalized
    } finally { active-- }
  })()
  pending.set(fingerprint, operation)
  try { return await operation } finally { pending.delete(fingerprint) }
}
function zip(entries: Record<string, Buffer | string>) {
  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } }), parts: Buffer[] = []; let bytes = 0
    archive.on('error', () => reject(error('BOUNDARY_EXPORT_FAILED', 'SHP 파일을 묶지 못했습니다.')))
    archive.on('data', chunk => { bytes += chunk.length; if (bytes > 20 * 1024 ** 2) { archive.abort(); reject(error('BOUNDARY_EXPORT_LIMIT', 'SHP 파일 크기 한도를 넘었습니다.', 413)) } else parts.push(chunk) })
    archive.on('end', () => resolve(Buffer.concat(parts)))
    for (const [name, data] of Object.entries(entries)) archive.append(data, { name })
    void archive.finalize().catch(() => reject(error('BOUNDARY_EXPORT_FAILED', 'SHP 파일을 묶지 못했습니다.')))
  })
}
export async function exportLegalBoundary(codes: string[], crs = 'EPSG:4326', referenceSnapshot?: ReferenceSnapshot) {
  if (crs !== 'EPSG:4326') throw error('BOUNDARY_UNSUPPORTED_CRS', '현재 경계 SHP는 EPSG:4326(경도·위도)으로 출력합니다.', 400)
  const reference = referenceSnapshot ?? await getReference(), selections = selectCodes(codes, reference), started = Date.now(), features: BoundaryFeature[] = []
  for (const selection of selections) {
    if (Date.now() - started > 60_000) throw error('BOUNDARY_TIMEOUT', '경계 조회 시간이 길어졌습니다. 구역을 나누어 다시 시도하세요.')
    features.push(...(await sourceFeatures(selection)).map(feature => ({ ...feature, selection })))
    if (features.length > MAX_FEATURES || features.reduce((sum, feature) => sum + feature.rings.reduce((n, ring) => n + ring.length, 0), 0) > MAX_POINTS) throw error('BOUNDARY_RESULT_LIMIT', '경계 도형 수·점 수 한도를 넘었습니다.', 413)
  }
  const rows = features.map(feature => ({ legal_cd: feature.selection.fullCode, area_code: feature.selection.code, source_id: feature.sourceId }))
  const files = await new Promise<{ shp: DataView; shx: DataView; dbf: DataView }>((resolve, reject) => {
    try { writeShape(rows, 'POLYGON', features.map(feature => feature.rings), (failure, data) => failure ? reject(error('BOUNDARY_EXPORT_FAILED', '경계 SHP를 만들지 못했습니다.')) : resolve(data)) }
    catch { reject(error('BOUNDARY_EXPORT_FAILED', '경계 SHP를 만들지 못했습니다.')) }
  })
  const checkedAt = new Date().toISOString(), stem = selections.length === 1 ? 'legal-boundary-' + selections[0]!.code : 'legal-boundaries'
  const metadata = { source: 'VWorld 2D Data API 법정 행정구역 경계', sourceUrl: BOUNDARY_SOURCE_URL, sourceDate: null, checkedAt, crs,
    referenceVersion: reference.version, referenceCoverage: reference.coverage, records: features.length, selections: selections.map(({ data, field, ...selection }) => ({ ...selection, layer: data })),
    warning: '법정구역 경계이며 개별 필지 경계·행정동 경계가 아닙니다. 원천은 기준일을 제공하지 않아 확인 시각과 구분합니다. DBF는 ASCII 코드·원천 ID만 담고 한글 명칭은 이 JSON에 보존합니다.' }
  const data = await zip({ [stem + '.shp']: Buffer.from(files.shp.buffer), [stem + '.shx']: Buffer.from(files.shx.buffer), [stem + '.dbf']: Buffer.from(files.dbf.buffer), [stem + '.prj']: WGS84_PRJ, [stem + '.cpg']: 'UTF-8', 'metadata.json': JSON.stringify(metadata, null, 2) })
  return { data, mime: 'application/zip', filename: stem + '.zip', features: features.length, codes: selections.map(item => item.code), sourceDate: null, checkedAt }
}
