import { getRouterParam } from 'h3'
import { z } from 'zod'
import { linkOptionsSchema } from '../../../../../shared/link/types.ts'
import { linkAccess, linkHandler, readLinkJson } from '../../../../services/link/access.ts'
import { rerunLinkJob } from '../../../../services/link/jobs.ts'
export default linkHandler(async event => {
  const input = z.object({ options: linkOptionsSchema.optional() }).strict().parse(await readLinkJson(event))
  const { accessToken, ...job } = await rerunLinkJob(getRouterParam(event, 'id')!, linkAccess(event), input.options)
  return job
})
