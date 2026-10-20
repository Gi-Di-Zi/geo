import { join, resolve } from 'node:path'

export const JOBS_DIR = resolve('.data/jobs')
/** 올릴 수 있는 파일 크기 상한 */
export const UPLOAD_LIMIT = 200 * 1024 ** 2
/** 결과를 남겨 두는 시간 */
export const JOB_TTL = 24 * 3600_000

/** 작업 폴더. id는 서버가 만든 UUID만 받는다 (경로 조작 방지) */
export function jobDir(id: string | undefined) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw createError({ statusCode: 404, statusMessage: '없는 작업' })
  }
  return join(JOBS_DIR, id)
}
