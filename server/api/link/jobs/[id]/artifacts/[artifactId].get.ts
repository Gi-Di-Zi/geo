import { getHeader, getRouterParam, setResponseHeaders } from 'h3'
import { linkAccess, linkHandler } from '../../../../../services/link/access.ts'
import { readLinkArtifact } from '../../../../../services/link/jobs.ts'
import { mcpLinkOwner } from '../../../../../services/link/mcp-access.ts'
export default linkHandler(async event => {
  const access = getHeader(event, 'mcp-session-id') ? { owner: await mcpLinkOwner(event) } : linkAccess(event)
  const result = await readLinkArtifact(getRouterParam(event, 'id')!, getRouterParam(event, 'artifactId')!, access)
  setResponseHeaders(event, { 'Content-Type': result.mime, 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Content-Length': String(result.data.length) })
  return result.data
})
