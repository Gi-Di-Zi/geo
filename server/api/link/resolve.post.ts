import { linkAccess, linkHandler, readLinkJson } from '../../services/link/access.ts'
import { resolveInput } from '../../services/link/service.ts'
export default linkHandler(async event => resolveInput(await readLinkJson(event), linkAccess(event)))
