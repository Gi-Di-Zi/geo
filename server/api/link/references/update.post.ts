import { z } from 'zod'
import { assertSameOrigin, linkHandler, readLimitedBody } from '../../../services/link/access.ts'
import { LinkServiceError } from '../../../services/link/files.ts'
import { updateReferences } from '../../../services/link/reference-updates.ts'
export default linkHandler(async event => {
  assertSameOrigin(event)
  let input: unknown
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readLimitedBody(event, 1024))) }
  catch (error) { if (error instanceof LinkServiceError) throw error; throw new LinkServiceError('INVALID_JSON', '올바른 업데이트 요청이 필요합니다.') }
  z.object({}).strict().parse(input)
  return updateReferences()
})
