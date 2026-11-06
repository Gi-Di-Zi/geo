import { existsSync } from 'node:fs'
import { mkdir, readdir, stat, statfs } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { H3Event } from 'h3'

export const uploadDataRoot = () => resolve(process.env.GEO_DATA_DIR || '.data')

async function storedBytes(directory: string): Promise<number> {
  let size = 0

  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  })

  for (const entry of entries) {
    const path = join(directory, entry.name)

    try {
      if (entry.isDirectory()) size += await storedBytes(path)
      else if (entry.isFile()) size += (await stat(path)).size
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }

  return size
}

/** 공개 배포에서 접속자(IP)마다 하루에 올릴 수 있는 양. 한 접속자가 전체 저장 공간(10GiB)을 채우지 못하게 한다 */
export const DAILY_UPLOAD_BYTES = 1024 ** 3

/** 접속자별 하루(UTC) 사용량: 한도 안이면 기록하고 true. ponytail: 메모리 기록 — 작업자를 다시 시작하면 초기화, 재시작이 잦아지면 파일에 기록 */
export function dailyCounter(limit: number) {
  const used = new Map<string, number>()
  let today = ''

  return (client: string, amount: number, now = Date.now()) => {
    const day = new Date(now).toISOString().slice(0, 10)

    if (day !== today) { used.clear(); today = day }

    const total = (used.get(client) ?? 0) + amount

    if (total > limit) return false
    used.set(client, total)

    return true
  }
}

export const chargeDaily = dailyCounter(DAILY_UPLOAD_BYTES)

/** 공개 배포의 접속자별 업로드 한도. 접속자 = 전용 프록시가 넣는 X-Real-IP (작업자는 그 프록시의 요청만 받는다) */
export function chargeUpload(event: H3Event, bytes: number) {
  if (process.env.GEO_PUBLIC_CONVERSIONS !== '1') return

  if (!chargeDaily(getHeader(event, 'x-real-ip') || 'unknown', bytes)) {
    throw createError({ statusCode: 429, statusMessage: `하루 업로드 한도(${DAILY_UPLOAD_BYTES / 1024 ** 3}GiB)를 넘었습니다. 내일 다시 시도해 주세요.` })
  }
}

/** 원본을 자동 삭제하지 않는다. 공간이 부족하면 새 업로드를 거절한다. */
export async function assertUploadSpace(incoming: number) {
  const root = uploadDataRoot()

  if (!existsSync(root)) await mkdir(root, { recursive: true })

  const disk = await statfs(root)
  const free = disk.bavail * disk.bsize

  if (free - incoming < 10 * 1024 ** 3 || await storedBytes(root) + incoming > 10 * 1024 ** 3) {
    throw createError({ statusCode: 507, statusMessage: '업로드 저장 공간이 가득 찼습니다. 운영자에게 문의해 주세요.' })
  }
}
