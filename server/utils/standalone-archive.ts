import { posix } from 'node:path'
import type { ViewerId } from '../../shared/types.ts'

/** Uploaded display names may contain Windows or POSIX paths; ZIP entries use one portable folder. */
export function standaloneArchiveFolder(name: string, viewer: ViewerId) {
  const filename = posix.basename(name.replaceAll('\\', '/'))
  const stem = filename.replace(/\.[^.]*$/, '').replace(/[<>:"|?*\p{Cc}]/gu, '_').replace(/[. ]+$/, '')

  return `${stem || 'result'}-${viewer}`
}
