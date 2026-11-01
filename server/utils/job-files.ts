import { readFile, realpath, readdir, lstat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'

const completedJob = z.object({ state: z.literal('done') })

/** 완료된 작업의 출력 안에서만 파일을 연다. 변환 결과의 심볼릭 링크는 따라가지 않는다. */
export async function jobOutputPath(id: string | undefined, relative: string) {
  const directory = jobDir(id)
  const contents = await readFile(join(directory, 'job.json'), 'utf8').catch(() => '')

  if (!contents) throw createError({ statusCode: 404 })

  const job = completedJob.safeParse(JSON.parse(contents))

  if (!job.success) throw createError({ statusCode: 404, statusMessage: '완료된 결과가 없습니다.' })

  const root = await realpath(join(directory, 'upload'))
  const path = resolve(root, relative)

  if (path !== root && !path.startsWith(root + sep)) throw createError({ statusCode: 404 })

  const actual = await realpath(path).catch(() => '')

  if (actual !== path) throw createError({ statusCode: 404 })

  return path
}

export async function assertNoOutputLinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry)
    const info = await lstat(path)

    if (info.isSymbolicLink()) throw createError({ statusCode: 404, statusMessage: '출력 링크는 제공하지 않습니다.' })

    if (info.isDirectory()) await assertNoOutputLinks(path)
  }
}
