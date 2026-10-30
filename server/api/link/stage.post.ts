import { getHeader } from 'h3'
import { z } from 'zod'
import { assertSameOrigin, linkAccess, linkHandler, readLimitedBody } from '../../services/link/access.ts'
import { LinkServiceError } from '../../services/link/files.ts'
import { prepareUpload } from '../../services/link/service.ts'
const settingsSchema = z.object({ encoding: z.enum(['utf-8', 'euc-kr']).optional(), headerRow: z.union([z.boolean(), z.number().int().min(1)]).optional() })
export default linkHandler(async event => {
  assertSameOrigin(event)
  const contentType = getHeader(event, 'content-type') || ''
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new LinkServiceError('INVALID_UPLOAD', 'multipart/form-data 파일 업로드가 필요합니다.')
  const body = await readLimitedBody(event)
  let form: FormData
  try { form = await new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData() }
  catch { throw new LinkServiceError('INVALID_UPLOAD', '업로드 양식을 읽을 수 없습니다.') }
  const file = form.get('file')
  if (!file || typeof file === 'string' || form.getAll('file').length !== 1) throw new LinkServiceError('INVALID_UPLOAD', 'file 필드에 파일 하나가 필요합니다.')
  const rawHeader = form.get('headerRow')
  const headerRow = rawHeader === null ? undefined : rawHeader === 'false' ? false : rawHeader === 'true' ? true : Number(rawHeader)
  const settings = settingsSchema.parse({ encoding: form.get('encoding') || undefined, headerRow })
  const { accessToken, ...preview } = await prepareUpload(file.name, Buffer.from(await file.arrayBuffer()), linkAccess(event), settings)
  return preview
})
