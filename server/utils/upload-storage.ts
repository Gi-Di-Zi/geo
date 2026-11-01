import { existsSync } from 'node:fs'
import { mkdir, readdir, stat, statfs } from 'node:fs/promises'
import { join, resolve } from 'node:path'

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
