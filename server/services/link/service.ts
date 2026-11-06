import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { linkData } from './data-dir.ts'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { resolveRows } from '../../../shared/link/core.ts'
import { inputRowSchema, linkOptionsSchema } from '../../../shared/link/types.ts'
import type { InputRow } from '../../../shared/link/types.ts'
import { getReference } from './reference.ts'
import { getAdministrativeReference, administrativeInfo } from './administrative-reference.ts'
import { resolveAdministrativeRows } from './administrative.ts'
import { resolveLocationRows } from './location-resolve.ts'
import { resolveAllRows } from './all.ts'
import { getLocationCapabilities } from './location.ts'
import { boundaryCapabilities } from './boundary.ts'
import { hashAccess, hasAccess, newAccessToken } from './access.ts'
import type { LinkAccess } from './access.ts'
import { LinkServiceError, linkLimits, readInputFile, rowsFromBook, rowsFromText, selectedSheet } from './files.ts'
import type { InputBook, FileSettings } from './files.ts'

export const LINK_STAGE_DIR = resolve(process.env.LINK_DATA_DIR || linkData('link'), 'stage')
export const linkInputSchema = z.object({
  rows: z.array(inputRowSchema).max(linkLimits.rows).optional(), text: z.string().max(linkLimits.uncompressedBytes).optional(),
  uploadId: z.string().uuid().optional(), uploadToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  sheet: z.string().max(200).optional(), headerRow: z.union([z.boolean(), z.number().int().min(1).max(linkLimits.rows)]).optional(), column: z.number().int().min(0).max(linkLimits.columns - 1).optional(),
  options: linkOptionsSchema.optional(),
}).strict().refine(v => [v.rows !== undefined, v.text !== undefined, v.uploadId !== undefined].filter(Boolean).length === 1, '입력 경로는 하나만 지정하세요.')
export type LinkInput = z.infer<typeof linkInputSchema>
interface StoredUpload { id: string; ownerHash?: string; tokenHash: string; createdAt: string; expiresAt: string; book: InputBook }
export function linkId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new LinkServiceError('NOT_FOUND', '작업·파일을 찾을 수 없습니다.', 404)
  return id
}
async function readUpload(id: string, access: LinkAccess): Promise<StoredUpload> {
  let upload: StoredUpload
  try { upload = JSON.parse(await readFile(join(LINK_STAGE_DIR, `${linkId(id)}.json`), 'utf8')) }
  catch (error) { if (error instanceof LinkServiceError) throw error; throw new LinkServiceError('NOT_FOUND', '업로드 파일이 없습니다.', 404) }
  if (!hasAccess(upload, access)) throw new LinkServiceError('FORBIDDEN', '업로드 파일 접근권한이 없습니다.', 403)
  if (Date.parse(upload.expiresAt) <= Date.now()) throw new LinkServiceError('EXPIRED', '업로드 파일의 보관 기간이 지났습니다.', 410)
  return upload
}
function preview(upload: StoredUpload, settings: FileSettings) {
  const picked = selectedSheet(upload.book, settings)
  return { uploadId: upload.id, encoding: upload.book.encoding, name: upload.book.name, sheets: upload.book.sheets.map(s => ({ name: s.name, rows: s.rows.length })), sheet: picked.sheet.name, headers: picked.headers, preview: picked.rows.slice(0, 50).map(row => row.map(value => value.slice(0, 500))), previewCellLimit: 500, totalRows: picked.rows.length, expiresAt: upload.expiresAt, issues: picked.sheet.issues }
}
export async function prepareUpload(name: string, data: Buffer, access: LinkAccess, settings: FileSettings = {}) {
  if (!access.owner && !access.token) throw new LinkServiceError('UNAUTHORIZED', '업로드 소유자 권한이 필요합니다.', 401)
  const book = await readInputFile(name, data, settings.encoding), accessToken = newAccessToken(), id = randomUUID()
  const upload: StoredUpload = { id, ownerHash: access.owner ? hashAccess(access.owner) : undefined, tokenHash: hashAccess(accessToken), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + linkLimits.ttlMs).toISOString(), book }
  await mkdir(LINK_STAGE_DIR, { recursive: true })
  await writeFile(join(LINK_STAGE_DIR, `${id}.json`), JSON.stringify(upload))
  return { ...preview(upload, settings), accessToken }
}
export async function previewUpload(id: string, access: LinkAccess, settings: FileSettings = {}) { return preview(await readUpload(id, access), settings) }
export async function inputRows(raw: unknown, access: LinkAccess = {}): Promise<{ input: LinkInput; rows: InputRow[] }> {
  const input = linkInputSchema.parse(raw)
  const rows = input.rows ?? (input.text !== undefined ? rowsFromText(input.text, input) : rowsFromBook((await readUpload(input.uploadId!, { ...access, token: input.uploadToken || access.token })).book, input))
  if (!rows.length) throw new LinkServiceError('EMPTY_INPUT', '처리할 입력이 없습니다.')
  if (rows.length > linkLimits.rows) throw new LinkServiceError('TOO_MANY_ROWS', '입력 행 수 한도를 넘었습니다.', 413)
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new LinkServiceError('DUPLICATE_ROW_ID', '입력 행 ID는 중복될 수 없습니다.')
  if (Buffer.byteLength(JSON.stringify(rows)) > linkLimits.bytes) throw new LinkServiceError('FILE_TOO_LARGE', '입력 전체 크기 한도를 넘었습니다.', 413)
  if (rows.some(row => Object.keys(row.original).length > linkLimits.columns || Buffer.byteLength(JSON.stringify(row.original)) > 64 * 1024 || Object.values(row.original).some(v => v.length > 10_000))) throw new LinkServiceError('ROW_TOO_LARGE', '원본 행은 64KB·셀은 10,000자·열은 설정 한도 이내여야 합니다.', 413)
  return { input, rows }
}
export async function resolveInput(raw: unknown, access: LinkAccess = {}) {
  const { input, rows } = await inputRows(raw, access)
  if (rows.length > linkLimits.syncRows || input.uploadId) throw new LinkServiceError('ASYNC_REQUIRED', '파일·대량 입력은 작업 실행 API를 사용하세요.', 413)
  const options = linkOptionsSchema.parse(input.options || {}), boundary = options.target === 'legal_boundary'
  const normalized = boundary ? { ...options, target: 'legal_region' as const, level: options.level === 'pnu' ? 'eupmyeondong' as const : options.level } : options
  const result = normalized.target === 'all'
    ? await resolveAllRows(rows, normalized, await getReference(), await getAdministrativeReference())
    : normalized.inputType === 'location' || normalized.target === 'location'
      ? await resolveLocationRows(rows, normalized, await getReference(), await getAdministrativeReference())
      : normalized.inputType === 'administrative' || normalized.target === 'administrative_region'
        ? resolveAdministrativeRows(rows, normalized, await getReference(), await getAdministrativeReference())
        : resolveRows(rows, normalized, await getReference())
  if (boundary) result.options = options
  return result
}
export async function capabilities() {
  const { regions, ...reference } = await getReference()
  const administrative = await administrativeInfo()
  const location = getLocationCapabilities(), boundary = boundaryCapabilities()
  return { project: 'geo-link', inputTypes: ['auto', 'pnu_legal', 'administrative', 'address', 'location'], outputs: ['text', 'legal_boundary_shp'], workflow: '주소·코드 입력(유형 자동 판별) 또는 좌표 → 전체 결과 → 필요할 때 SHP 다운로드', allResultsMaxRows: 20, fileWorkflow: 'csv_xlsx_deferred', reference: { ...reference, count: regions.length }, administrative, location, boundary, limits: linkLimits,
    features: { pnuFormat: { state: 'available', scope: '19자리 문자열 구조' }, legalRegions: { state: reference.available ? 'available' : 'setup_required', scope: reference.coverage, version: reference.version }, parcelAddress: { state: reference.available ? 'available' : 'setup_required', scope: '법정구역명 + 산 선택 + 본번-부번; 실제 필지 확인 없음' }, administrativeRegions: { state: administrative.available ? 'available' : 'setup_required', scope: '행안부 10자리 행정동코드·검증된 법정동 관계', version: administrative.version }, addressSearch: { state: 'available', scope: '사용자가 카카오 주소 검색에서 선택한 주소; 예상 지번 사용 안 함' }, location: { state: location.state, scope: '5개 EPSG 좌표 변환; VWorld 주소·관할 조회는 API 설정 필요' }, legalBoundary: { state: boundary.state, scope: '법정구역 경계 SHP ZIP; EPSG:4326; VWorld 경계 권한 필요' }, postcode: { state: location.state, scope: '필지·도로명주소·위치의 우편번호(VWorld 역지오코딩, 같은 주소일 때만). 우편번호 입력은 웹 주소 검색에서 주소 선택' }, extensions: { state: 'planned', reason: '공공 속성 연결은 미지원' } },
    supported: { pnu: true, legalRegions: true, parcelAddress: true, administrativeRegions: administrative.available, roadAddress: false, addressSearch: true, postcode: location.state === 'available', coordinates: true, geometry: boundary.state === 'available', publicAttributes: false }, parcelVerification: 'not_checked', uploads: 'excluded_from_ui', retention: { accessExpires: true, physicalDeletion: false, reason: '저장소 작업 합의에 따라 물리 삭제를 실행하지 않습니다.' } }
}
