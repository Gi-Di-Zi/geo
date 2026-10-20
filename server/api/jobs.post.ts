// 파일 업로드 → 업로드 레시피 실행. 변환은 별도 프로세스(scripts/pipeline.ts --job)가 Docker로 돌린다
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Job } from '#shared/types'

// ponytail: 한 번에 한 작업만 돌린다. 동시에 여러 개가 필요하면 작업 큐(BullMQ 등)로 바꾼다
let running: string | null = null

async function cleanOld() {
  if (!existsSync(JOBS_DIR)) return
  for (const id of await readdir(JOBS_DIR)) {
    const dir = join(JOBS_DIR, id)
    if (id !== running && Date.now() - (await stat(dir)).mtimeMs > JOB_TTL) await rm(dir, { recursive: true, force: true })
  }
}

export default defineEventHandler(async event => {
  if (running) throw createError({ statusCode: 429, statusMessage: '다른 파일 변환 중. 끝난 뒤 다시 업로드.' })
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > UPLOAD_LIMIT + 1024 ** 2) {
    throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` })
  }
  const form = await readMultipartFormData(event)
  const format = form?.find(p => p.name === 'format')?.data.toString()
  const file = form?.find(p => p.name === 'file' && p.filename)
  if (!format || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(format) || !file) throw createError({ statusCode: 400, statusMessage: '확장자와 파일 함께 필요.' })
  if (file.data.length > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` })
  // 파일 이름은 쓰지 않고 확장자만 남긴다. 확장자가 이 포맷이 받는 것인지는 변환 프로세스가 spec으로 확인한다
  const ext = extname(file.filename!).toLowerCase()
  if (!/^\.[a-z0-9]{1,10}$/.test(ext)) throw createError({ statusCode: 400, statusMessage: '확장자를 알 수 없는 파일.' })

  await cleanOld()
  const id = randomUUID()
  const dir = join(JOBS_DIR, id)
  await mkdir(join(dir, 'raw'), { recursive: true })
  await writeFile(join(dir, 'raw', `input${ext}`), file.data)
  const job: Job = { id, format, name: file.filename!.slice(0, 200), bytes: file.data.length, state: 'running', createdAt: new Date().toISOString() }
  await writeFile(join(dir, 'job.json'), JSON.stringify(job, null, 2))

  running = id
  const child = spawn(process.execPath, ['scripts/pipeline.ts', '--job', dir], { stdio: 'ignore' })
  child.on('exit', async () => {
    running = null
    // 프로세스가 결과를 쓰지 못하고 죽었으면 실패로 남긴다
    const now: Job = JSON.parse(await readFile(join(dir, 'job.json'), 'utf8'))
    if (now.state === 'running') await writeFile(join(dir, 'job.json'), JSON.stringify({ ...now, state: 'failed', error: '변환 프로세스 중간 중단.' }, null, 2))
  })
  return { id }
})
