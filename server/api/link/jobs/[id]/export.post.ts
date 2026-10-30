import { getRouterParam } from 'h3'
import { z } from 'zod'
import { linkAccess, linkHandler, readLinkJson } from '../../../../services/link/access.ts'
import { createLinkExport } from '../../../../services/link/jobs.ts'
export default linkHandler(async event => {
  const input = z.object({ format: z.enum(['csv', 'xlsx', 'json']), columns: z.array(z.string().max(2000)).max(500).optional() }).strict().parse(await readLinkJson(event))
  return createLinkExport(getRouterParam(event, 'id')!, linkAccess(event), input.format, input.columns)
})
