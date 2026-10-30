import { getQuery, getRouterParam } from 'h3'
import { z } from 'zod'
import { linkAccess, linkHandler } from '../../../services/link/access.ts'
import { getLinkJob } from '../../../services/link/jobs.ts'
const schema = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50), status: z.enum(['ok', 'needs_selection', 'invalid', 'not_found', 'unavailable']).optional() }).strict()
export default linkHandler(async event => {
  const query = schema.parse(getQuery(event))
  return getLinkJob(getRouterParam(event, 'id')!, linkAccess(event), query.offset, query.limit, query.status)
})
