// 독립 HTML 지도 내려받기: 결과 하나 + 지도 페이지(index.html) + 라이브러리(lib/) + 안내문을 한 폴더 zip으로 (shared/standalone.ts).
// 정적 호스팅에 폴더째 올리면 그대로 열린다. 뷰어 = ?viewer= 또는 작업의 대상 라이브러리, 결과 = 그 뷰어가 그리는 결과 (적용 코드와 같은 규칙)
// 대화 안 화면(MCP App, 다른 출처)도 받으므로 CORS 허용 (download와 같은 이유)
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import archiver from 'archiver'
import { downloadOf } from '#shared/catalog/delivery'
import { kindHosting } from '#shared/snippets'
import { standalonePage, standaloneReadme, type StandaloneLib } from '#shared/standalone'
import type { Job } from '#shared/types'
import { viewers } from '#shared/viewers'

export default defineEventHandler(async event => {
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Private-Network': 'true',
  })

  if (event.method === 'OPTIONS') { setResponseStatus(event, 204);

 return '' }

  const id = getRouterParam(event, 'id')
  const job: Job | null = await readFile(join(jobDir(id), 'job.json'), 'utf8').then(JSON.parse, () => null)
  const viewer = viewers.find(v => v.id === (getQuery(event).viewer || job?.intent?.viewer))
  const o = job?.state === 'done' && viewer ? viewerOutput(job, viewer.id) : undefined

  if (!job || !viewer || !o) throw createError({ statusCode: 404, statusMessage: '이 뷰어로 그리는 결과 없음' })

  if (o.path.startsWith('/')) throw createError({ statusCode: 400, statusMessage: '서비스 결과는 이 서버가 응답하는 주소라 HTML 지도 폴더로 줄 수 없음' })
  const storage = useStorage('assets:server')
  const lib: StandaloneLib | null = await storage.getItemRaw('standalone/manifest.json').then(raw => (raw ? JSON.parse(String(raw)) : null))

  if (!lib) throw createError({ statusCode: 503, statusMessage: '라이브러리 묶음 없음 (node scripts/standalone-lib.ts)' })
  const { path, zip } = downloadOf(o, job.name)
  const target = await jobOutputPath(id, path)

  if (!existsSync(target)) throw createError({ statusCode: 404, statusMessage: '결과 파일 없음' })

  if (zip) await assertNoOutputLinks(target)
  const folder = `${job.name.replace(/[.][^.]*$/, '') || 'result'}-${viewer.id}`

  setResponseHeaders(event, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="map-${viewer.id}.zip"; filename*=UTF-8''${encodeURIComponent(`${folder}.zip`)}`,
  })
  const a = archiver('zip')

  a.append(standalonePage(viewer.id, o, job.recipe?.view, lib, `${job.name} · ${viewer.name}`), { name: `${folder}/index.html` })
  a.append(standaloneReadme(viewer.id, viewer.name, kindHosting[o.kind], lib), { name: `${folder}/README.txt` })

  for (const file of lib.files[viewer.id] ?? []) {
    const raw = await storage.getItemRaw(`standalone/${viewer.id}/${file}`)

    if (raw) a.append(Buffer.from(raw), { name: `${folder}/lib/${file}` })
  }

  // 데이터: 파일 하나는 같은 이름, 여러 파일(타일·3D Tiles·지형)은 폴더째 → 페이지가 data/<결과 경로>로 읽는다
  if (zip) a.directory(target, `${folder}/data/${path}`)
  else a.file(target, { name: `${folder}/data/${o.path}` })

  // glb 여러 개 배치: 위치 목록(GeoJSON)도 함께
  if (o.instances) {
    const places = await jobOutputPath(id, o.instances)

    if (existsSync(places)) a.file(places, { name: `${folder}/data/${o.instances}` })
  }

  void a.finalize()

  return sendStream(event, a)
})
