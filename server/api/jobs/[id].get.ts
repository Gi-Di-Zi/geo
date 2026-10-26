import { existsSync } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Job, Report } from '#shared/types'

/** 도는 단계의 출력 끝부분 (pipeline이 live.log에 바로 쓴다). 진행 표시(\r로 덮어쓰는 줄)는 마지막 상태만 */
async function tail(file: string) {
  if (!existsSync(file)) return ''
  const f = await open(file, 'r')
  try {
    const { size } = await f.stat()
    const n = Math.min(size, 8192)
    const { buffer } = await f.read(Buffer.alloc(n), 0, n, size - n)
    return buffer.toString('utf8').split('\n').slice(n < size ? 1 : 0).map(l => l.split('\r').filter(Boolean).at(-1) ?? '').slice(-40).join('\n')
  } finally {
    await f.close()
  }
}

export default defineEventHandler(async event => {
  const dir = jobDir(getRouterParam(event, 'id'))
  if (!existsSync(join(dir, 'job.json'))) throw createError({ statusCode: 404, statusMessage: '없거나 기간(24시간)이 지난 작업' })
  const job: Job = JSON.parse(await readFile(join(dir, 'job.json'), 'utf8'))
  const reportFile = join(dir, 'upload', 'report.json')
  // pipeline이 쓰는 도중에 읽으면 깨진 JSON → null (화면은 앞서 받은 기록을 유지)
  const report: Report | null = existsSync(reportFile) ? await readFile(reportFile, 'utf8').then(JSON.parse).catch(() => null) : null
  // now: 화면이 서버 시계 기준으로 경과 시간을 센다
  return { job, report, live: job.state === 'running' ? await tail(join(dir, 'live.log')) : '', now: Date.now() }
})
