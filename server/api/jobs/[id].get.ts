import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Job, Report } from '#shared/types'

export default defineEventHandler(async event => {
  const dir = jobDir(getRouterParam(event, 'id'))
  if (!existsSync(join(dir, 'job.json'))) throw createError({ statusCode: 404, statusMessage: '없거나 기간(24시간)이 지난 작업' })
  const job: Job = JSON.parse(await readFile(join(dir, 'job.json'), 'utf8'))
  const reportFile = join(dir, 'upload', 'report.json')
  const report: Report | null = existsSync(reportFile) ? JSON.parse(await readFile(reportFile, 'utf8')) : null
  return { job, report }
})
