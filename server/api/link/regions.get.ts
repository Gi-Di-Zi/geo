import { getQuery } from 'h3'
import { z } from 'zod'
import { lookupRegions } from '../../../shared/link/core.ts'
import { linkHandler } from '../../services/link/access.ts'
import { getReference } from '../../services/link/reference.ts'
import { getAdministrativeReference } from '../../services/link/administrative-reference.ts'
import { lookupAdministrative } from '../../../shared/link/administrative.ts'
const schema = z.object({ query: z.string().max(200).optional(), parentCode: z.string().regex(/^\d{10}$/).optional(), descendants: z.enum(['true', 'false']).optional(), includeRetired: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(1000).default(100), codeSystem: z.enum(['legal_region', 'administrative_region']).default('legal_region') }).strict()
export default linkHandler(async event => {
  const query = schema.parse(getQuery(event))
  const options = { ...query, descendants: query.descendants === 'true', includeRetired: query.includeRetired === 'true' }
  return query.codeSystem === 'administrative_region' ? lookupAdministrative(options, await getAdministrativeReference()) : lookupRegions(options, await getReference())
})
