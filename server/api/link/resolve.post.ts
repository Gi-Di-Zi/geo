import { chargeLinkLookups, linkAccess, linkClient, linkHandler, readLinkJson } from '../../services/link/access.ts'
import { resolveInput } from '../../services/link/service.ts'
export default linkHandler(async event => {
  const input = await readLinkJson(event)
  chargeLinkLookups(linkClient(event), input)
  return resolveInput(input, linkAccess(event))
})
