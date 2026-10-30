import { linkHandler } from '../../services/link/access.ts'
import { capabilities } from '../../services/link/service.ts'
export default linkHandler(async () => capabilities())
