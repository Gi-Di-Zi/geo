import { linkHandler } from '../../services/link/access.ts'
import { referenceUpdateStatus } from '../../services/link/reference-updates.ts'
export default linkHandler(async () => referenceUpdateStatus())
