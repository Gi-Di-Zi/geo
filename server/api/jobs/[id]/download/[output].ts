// 결과 내려받기 (파일 방식). 파일 하나는 그대로, 여러 파일(타일·3D Tiles·지형)은 폴더째 zip으로 묶어 바로 보낸다.
// 대화 안 화면(MCP App, 다른 출처)이 받아서 호스트에 넘기므로 CORS 허용 (server/api/stage.ts와 같은 이유)
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import archiver from 'archiver'
import { downloadOf } from '#shared/catalog/delivery'
import type { Job } from '#shared/types'

export default defineEventHandler(async event => {
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Private-Network': 'true',
  })

  if (event.method === 'OPTIONS') { setResponseStatus(event, 204);

 return '' }

  if (event.method !== 'GET') throw createError({ statusCode: 405 })

  const dir = jobDir(getRouterParam(event, 'id'))
  const job: Job | null = await readFile(join(dir, 'job.json'), 'utf8').then(JSON.parse, () => null)
  const o = job?.state === 'done' ? job.recipe?.outputs.find(x => x.id === getRouterParam(event, 'output')) : undefined

  if (!job || !o || o.path.startsWith('/svc/')) throw createError({ statusCode: 404, statusMessage: '내려받을 결과 없음' })
  const { path, zip, name } = downloadOf(o, job.name)
  const target = await jobOutputPath(getRouterParam(event, 'id'), path)

  if (!existsSync(target)) throw createError({ statusCode: 404, statusMessage: '결과 파일 없음' })

  setResponseHeaders(event, {
    'content-type': zip ? 'application/zip' : 'application/octet-stream',
    'content-disposition': `attachment; filename="${o.id}${extname(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  })

  if (!zip) {
    setResponseHeader(event, 'content-length', statSync(target).size)

    return sendStream(event, createReadStream(target))
  }

  // 타일 수가 많아도(ZIP64) 메모리에 모으지 않고 흘려 보낸다
  await assertNoOutputLinks(target)
  const a = archiver('zip')
  a.directory(target, basename(target))
  void a.finalize()

  return sendStream(event, a)
})
