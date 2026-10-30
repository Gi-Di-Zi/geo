import { getRouterParam } from 'h3'
import { z } from 'zod'
import { getLinkOwner, linkHandler, readLinkJson } from '../../../../services/link/access.ts'
import { claimLinkJob } from '../../../../services/link/jobs.ts'
export default linkHandler(async event => {
  const input = z.object({ accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(await readLinkJson(event))
  return claimLinkJob(getRouterParam(event, 'id')!, input.accessToken, getLinkOwner(event))
})
