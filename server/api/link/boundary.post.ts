import { setResponseHeaders } from 'h3'
import { z } from 'zod'
import { chargeLinkLookups, linkClient, linkHandler, readLinkJson } from '../../services/link/access.ts'
import { BOUNDARY_MAX_CODES, exportLegalBoundary } from '../../services/link/boundary.ts'

export default linkHandler(async event => {
  const input = z.object({ codes: z.array(z.string().regex(/^(?:\d{2}|\d{5}|\d{8}|\d{10})$/)).min(1).max(BOUNDARY_MAX_CODES), crs: z.literal('EPSG:4326').default('EPSG:4326') }).strict().parse(await readLinkJson(event))
  chargeLinkLookups(linkClient(event), input)
  const result = await exportLegalBoundary(input.codes, input.crs)
  setResponseHeaders(event, { 'Content-Type': result.mime, 'Content-Disposition': 'attachment; filename="' + result.filename + '"', 'Content-Length': String(result.data.length) })
  return result.data
})
