import { z } from 'zod'
import { linkAccess, linkHandler, readLinkJson } from '../../services/link/access.ts'
import { startLinkJob } from '../../services/link/jobs.ts'
import { linkInputSchema } from '../../services/link/service.ts'
export default linkHandler(async event => {
  const raw = await readLinkJson(event)
  const wrapped = raw?.input !== undefined ? z.object({ input: linkInputSchema, idempotencyKey: z.string().optional() }).strict().parse(raw) : { input: raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'idempotencyKey')) : raw, idempotencyKey: raw?.idempotencyKey }
  const { accessToken, ...job } = await startLinkJob(wrapped.input, linkAccess(event), wrapped.idempotencyKey)
  return job
})
