// 업로드 작업: 만들기(파일 → .data/jobs/<id> → scripts/pipeline.ts --job), 정리, 상태·결과 주소. 업로드 API와 MCP 도구가 같이 쓴다
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { downloadOf } from '#shared/catalog/delivery'
import type { Job, Output, Report } from '#shared/types'
import { engineOutput } from '#shared/viewers'

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

// ponytail: 한 번에 한 작업만 돌린다. 동시에 여러 개가 필요하면 작업 큐(BullMQ 등)로 바꾼다
let running: string | null = null

async function cleanOld() {
  if (!existsSync(JOBS_DIR)) return
  for (const id of await readdir(JOBS_DIR)) {
    const dir = join(JOBS_DIR, id)
    if (id === running || Date.now() - (await stat(dir)).mtimeMs <= JOB_TTL) continue
    // 서버 방식 작업이 만든 DB 표·GeoServer 레이어도 지운다 (기다리지 않음)
    const { layer } = JSON.parse(await readFile(join(dir, 'job.json'), 'utf8').catch(() => '{}')) as Job
    if (layer) spawn(process.execPath, ['scripts/pipeline.ts', '--drop', layer], { stdio: 'ignore', detached: true }).unref()
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 작업 시작: 올린 내용(data) 또는 맡겨 둔 파일(file)을 작업 폴더로 옮기고 변환 프로세스를 띄운다.
 * 형식·방식이 이 형식에 맞는지는 변환 프로세스가 spec으로 확인한다 (방식이 없으면 첫 번째)
 */
export async function startJob(o: { format: string; name: string; ext: string; data?: Uint8Array; file?: string; srs?: string; method?: string }) {
  if (running) throw createError({ statusCode: 429, statusMessage: '다른 파일 변환 중. 끝난 뒤 다시.' })
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(o.format)) throw createError({ statusCode: 400, statusMessage: '형식은 유형/확장자 (예: vector-2d/shp).' })
  if (o.srs && !/^EPSG:\d{4,6}$/.test(o.srs)) throw createError({ statusCode: 400, statusMessage: '좌표계는 EPSG:번호 형식.' })
  if (o.method && !/^[a-z0-9-]{1,40}$/.test(o.method)) throw createError({ statusCode: 400, statusMessage: '방식·도구 이름 형식 아님.' })
  if (!/^\.[a-z0-9]{1,10}$/.test(o.ext)) throw createError({ statusCode: 400, statusMessage: '확장자를 알 수 없는 파일.' })

  await cleanOld()
  const id = randomUUID()
  const dir = join(JOBS_DIR, id)
  await mkdir(join(dir, 'raw'), { recursive: true })
  // 파일 이름은 쓰지 않고 확장자만 남긴다
  const input = join(dir, 'raw', `input${o.ext}`)
  if (o.file) await copyFile(o.file, input)
  else await writeFile(input, o.data!)
  const bytes = (await stat(input)).size
  const job: Job = { id, format: o.format, name: o.name.slice(0, 200), bytes, state: 'running', createdAt: new Date().toISOString(), srs: o.srs, method: o.method }
  await writeFile(join(dir, 'job.json'), JSON.stringify(job, null, 2))

  running = id
  const child = spawn(process.execPath, ['scripts/pipeline.ts', '--job', dir], { stdio: 'ignore' })
  child.on('exit', async () => {
    running = null
    // 프로세스가 결과를 쓰지 못하고 죽었으면 실패로 남긴다
    const now: Job = JSON.parse(await readFile(join(dir, 'job.json'), 'utf8'))
    if (now.state === 'running') await writeFile(join(dir, 'job.json'), JSON.stringify({ ...now, state: 'failed', error: '변환 프로세스 중간 중단.' }, null, 2))
  })
  return id
}

/** 작업 상태 + 결과 주소 (지도 화면, 파일 방식은 결과 파일, 서버 방식은 서비스 주소). origin = 이 서버의 바깥 주소 */
export async function jobInfo(id: string, origin: string) {
  const dir = jobDir(id)
  if (!existsSync(join(dir, 'job.json'))) throw createError({ statusCode: 404, statusMessage: '없거나 기간(24시간)이 지난 작업' })
  const job: Job = JSON.parse(await readFile(join(dir, 'job.json'), 'utf8'))
  const reportFile = join(dir, 'upload', 'report.json')
  const report: Report | null = existsSync(reportFile) ? await readFile(reportFile, 'utf8').then(JSON.parse).catch(() => null) : null
  const spec = uploadFormats.find(f => `${f.category}/${f.id}` === job.format)
  const recipes = spec && 'recipes' in spec.upload ? spec.upload.recipes : []
  const recipe = recipes.find(r => r.id === job.method) ?? recipes[0]
  const steps = recipe ? [...recipe.preprocess, ...recipe.convert] : []
  const done = report?.steps.length ?? 0
  const url = (o: Output) => (o.path.startsWith('/svc/') ? origin + o.path : `${origin}/api/jobs/${id}/files/${o.path}`)
  return {
    job: id,
    name: job.name,
    state: job.state,
    format: job.format,
    method: recipe ? { id: recipe.id, title: recipe.title, way: isServerRecipe(recipe) ? 'server' : 'file' } : undefined,
    srs: job.srs,
    error: job.error,
    progress: { done, total: steps.length, current: job.state === 'running' ? steps[done]?.title : undefined, ms: report?.totalMs ?? 0 },
    view: `${origin}/${job.format}/view?job=${id}`,
    /** 엔진(Unreal) 실시간 보기 가능: 3D Tiles·지형 결과 (geo_engine) */
    engine: job.state === 'done' && !!job.recipe && !!engineOutput(job.recipe),
    /** 이 시각 이후 다음 작업을 시작할 때 결과·서비스가 지워진다 (cleanOld) */
    expiresAt: new Date(Date.parse(job.createdAt) + JOB_TTL).toISOString(),
    // url = 지도·앱에서 쓰는 주소, download = 내려받기 (파일 방식만)
    outputs: (job.state === 'done' ? job.recipe?.outputs ?? [] : []).map(o => {
      const d = !o.path.startsWith('/svc/') && downloadOf(o, job.name)
      return { id: o.id, label: o.label, kind: o.kind, url: url(o), ...(d && { download: `${origin}/api/jobs/${id}/download/${encodeURIComponent(o.id)}`, zip: d.zip, file: d.name }) }
    }),
  }
}
