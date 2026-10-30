import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { linkLimits, LinkServiceError } from './files.ts'
import { prepareUpload } from './service.ts'

export const LINK_CHUNK_BYTES = 128 * 1024
const uploads = new Map<string, {
  owner: string; tokenHash: string; name: string; bytes: number; expires: number
  parts: Buffer[]; hashes: string[]; lastSequence?: number
  final?: Awaited<ReturnType<typeof prepareUpload>>; finalizing?: Promise<Awaited<ReturnType<typeof prepareUpload>>>
}>()
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

/** 순서와 재전송을 검증한다. 프로세스 재시작 시 파일을 처음부터 다시 올린다. */
export async function linkUploadChunk(c: { upload?: string; accessToken?: string; name: string; sequence: number; data: string; last: boolean }, owner: string) {
  for (const [id, item] of uploads) if (item.expires < Date.now()) uploads.delete(id)
  if (!Number.isSafeInteger(c.sequence) || c.sequence < 0 || c.data.length > Math.ceil(LINK_CHUNK_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(c.data)) {
    throw new LinkServiceError('INVALID_CHUNK', '업로드 조각의 순서·크기·인코딩을 확인하세요.')
  }
  const data = Buffer.from(c.data, 'base64')
  if (data.length > LINK_CHUNK_BYTES) throw new LinkServiceError('INVALID_CHUNK', '업로드 조각이 너무 큽니다.', 413)
  let id = c.upload, accessToken: string | undefined
  if (!id) {
    if (c.sequence !== 0 || !/\.(csv|xlsx)$/i.test(c.name) || c.name.length > 200) throw new LinkServiceError('INVALID_CHUNK', '첫 조각은 순서 0과 CSV·XLSX 파일명이 필요합니다.')
    if ([...uploads.values()].filter(u => !u.final).length >= 4) throw new LinkServiceError('UPLOAD_BUSY', '진행 중인 업로드가 많습니다. 잠시 뒤 다시 시도하세요.', 429)
    id = randomUUID(); accessToken = randomBytes(32).toString('base64url')
    uploads.set(id, { owner, tokenHash: hash(accessToken), name: c.name, bytes: 0, expires: Date.now() + 15 * 60_000, parts: [], hashes: [] })
  }
  const item = uploads.get(id)
  if (!item || (item.owner !== owner && (!c.accessToken || hash(c.accessToken) !== item.tokenHash))) throw new LinkServiceError('UPLOAD_FORBIDDEN', '업로드 권한이 없거나 만료되었습니다.', 403)
  if (item.name !== c.name) throw new LinkServiceError('INVALID_CHUNK', '업로드 중 파일명을 변경할 수 없습니다.')
  const digest = hash(data)
  const finalize = async () => {
    if (item.final) return item.final
    item.finalizing ??= prepareUpload(item.name, Buffer.concat(item.parts), { owner: item.owner }).then(result => {
      item.final = result; item.parts = []; return result
    }).finally(() => { item.finalizing = undefined })
    return item.finalizing
  }
  if (c.sequence < item.hashes.length) {
    if (item.hashes[c.sequence] !== digest || c.last !== (item.lastSequence === c.sequence)) throw new LinkServiceError('CHUNK_CONFLICT', '같은 순서의 조각 내용이 다릅니다.', 409)
    if (c.last) await finalize()
    return { upload: id, sequence: c.sequence, bytes: item.bytes, ...(item.final && { staged: item.final }), ...(accessToken && { accessToken }) }
  }
  if (item.lastSequence !== undefined || c.sequence !== item.hashes.length) throw new LinkServiceError('CHUNK_OUT_OF_ORDER', '업로드 조각을 순서대로 전송하세요.', 409)
  if (item.bytes + data.length > linkLimits.bytes) throw new LinkServiceError('FILE_TOO_LARGE', '파일 업로드 한도를 넘었습니다.', 413)
  item.parts.push(data); item.hashes.push(digest); item.bytes += data.length
  if (c.last) {
    item.lastSequence = c.sequence
    await finalize()
  }
  return { upload: id, sequence: c.sequence, bytes: item.bytes, ...(item.final && { staged: item.final }), ...(accessToken && { accessToken }) }
}
