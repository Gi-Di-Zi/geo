// 파일 업로드 → 업로드 레시피 실행. 변환은 별도 프로세스(scripts/pipeline.ts --job)가 Docker로 돌린다 (server/utils/jobs.ts)
import { extname } from 'node:path'

export default defineEventHandler(async event => {
  if (Number(getRequestHeader(event, 'content-length') ?? 0) > UPLOAD_LIMIT + 1024 ** 2) {
    throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` })
  }

  const form = await readMultipartFormData(event)
  const field = (name: string) => form?.find(p => p.name === name)?.data.toString() || undefined
  const format = field('format')
  const file = form?.find(p => p.name === 'file' && p.filename)

  if (!format || !file) throw createError({ statusCode: 400, statusMessage: '확장자와 파일 함께 필요.' })

  if (file.data.length > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` })
  // srs: 파일에 좌표계가 없을 때 고른 원본 좌표계, method: 고른 방식·도구(업로드 레시피 id)
  const id = await startJob({ format, name: file.filename!, ext: extname(file.filename!).toLowerCase(), data: file.data, srs: field('srs'), method: field('method') })

  return { id }
})
