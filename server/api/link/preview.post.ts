import { z } from 'zod'
import { linkAccess, linkHandler, readLinkJson } from '../../services/link/access.ts'
import { previewUpload } from '../../services/link/service.ts'
const schema = z.object({ uploadId: z.string().uuid(), sheet: z.string().max(200).optional(), headerRow: z.union([z.boolean(), z.number().int().min(1)]).optional(), column: z.number().int().min(0).optional() }).strict()
export default linkHandler(async event => {
  const { uploadId, ...settings } = schema.parse(await readLinkJson(event))
  return previewUpload(uploadId, linkAccess(event), settings)
})
