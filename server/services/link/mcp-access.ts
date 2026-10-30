import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getHeader, setHeader } from 'h3'
import type { H3Event } from 'h3'
import { getLinkOwner, hashAccess, newAccessToken } from './access.ts'
import { linkLimits, LinkServiceError } from './files.ts'

const root = () => resolve(process.env.LINK_DATA_DIR || '.data/link', 'mcp-sessions')
/** 도구 응답에 비밀을 넣지 않고 MCP 표준 세션 헤더로 작업 소유권을 이어간다. */
export async function mcpLinkOwner(event: H3Event, initialize = false) {
  const session = getHeader(event, 'mcp-session-id')
  if (session) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(session)) throw new LinkServiceError('MCP_SESSION_INVALID', 'MCP 연결이 만료되었습니다. 다시 연결하세요.', 404)
    const file = join(root(), hashAccess(session) + '.json')
    let stored: { expires: number; revoked?: boolean }
    try { stored = JSON.parse(await readFile(file, 'utf8')) } catch { throw new LinkServiceError('MCP_SESSION_INVALID', 'MCP 연결이 만료되었습니다. 다시 연결하세요.', 404) }
    if (stored.revoked || stored.expires < Date.now()) throw new LinkServiceError('MCP_SESSION_EXPIRED', 'MCP 연결이 만료되었습니다. 다시 연결하세요.', 404)
    if (event.method === 'DELETE') await writeFile(file, JSON.stringify({ ...stored, revoked: true }))
    return session
  }
  if (!initialize) return getLinkOwner(event)
  const owner = newAccessToken()
  await mkdir(root(), { recursive: true })
  await writeFile(join(root(), hashAccess(owner) + '.json'), JSON.stringify({ expires: Date.now() + linkLimits.ttlMs }), { flag: 'wx' })
  setHeader(event, 'Mcp-Session-Id', owner)
  return owner
}
