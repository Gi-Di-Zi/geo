// 업로드 작업: 원본 보존 → 전용 작업자 변환 → 상태·결과 주소. 업로드 API와 MCP 도구가 같이 쓴다
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { downloadOf } from '#shared/catalog/delivery'
import type { Job, Output, Report } from '#shared/types'
import { engineOutput } from '#shared/viewers'
import { MAX_UPLOAD_BYTES, publishesService } from '#shared/conversion'
import { assertUploadSpace, uploadDataRoot } from './upload-storage'

export const JOBS_DIR = resolve(process.env.GEO_JOBS_DIR || join(uploadDataRoot(), 'jobs'))

/** 올릴 수 있는 파일 크기 상한 */
export const UPLOAD_LIMIT = MAX_UPLOAD_BYTES

/** 작업 폴더. id는 서버가 만든 UUID만 받는다 (경로 조작 방지) */
export function jobDir(id: string | undefined) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw createError({ statusCode: 404, statusMessage: '없는 작업' })
  }

  return join(JOBS_DIR, id)
}

// 요청이 파일을 저장하는 동안에도 같은 작업자에서 동시 입장을 막는다.
// Linux 실제 실행은 upload-runner.py의 커널 잠금으로 웹 작업자 재시작을 넘어 한 개로 제한한다.
let running: string | null = null

async function markInterrupted(dir: string) {
  const file = join(dir, 'job.json')

  if (!existsSync(file)) return
  const job: Job = JSON.parse(await readFile(file, 'utf8'))

  if (job.state === 'running') {
    await writeFile(file + '.server.tmp', JSON.stringify({ ...job, state: 'failed', error: '변환 작업자가 중단되었습니다. 원본 파일은 보존했습니다.' }, null, 2))
    await rename(file + '.server.tmp', file)
  }
}

async function launch(dir: string) {
  const linux = process.platform === 'linux'
  const command = linux ? 'python3' : process.execPath

  const args = linux
    ? [resolve('scripts/upload-runner.py'), '--job', dir, '--node', process.execPath]
    : [resolve('scripts/pipeline.ts'), '--job', dir]

  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let fault = ''
  let output = ''
  child.stderr.on('data', chunk => { fault = (fault + chunk.toString()).slice(-2048) })

  const accepted = new Promise<void>((done, fail) => {
    let ready = !linux

    if (ready) done()
    child.stdout.on('data', chunk => {
      output = (output + chunk.toString()).slice(-128)

      if (!ready && output.includes('GEO_UPLOAD_ACCEPTED')) { ready = true; done() }
    })
    child.once('error', () => fail(createError({ statusCode: 503, statusMessage: '변환 작업자 실행 환경을 확인하세요.' })))
    child.once('close', code => {
      if (running === dir.split(/[\\/]/).at(-1)) running = null

      if (!ready) {
        const statusCode = code === 75 ? 429 : code === 64 ? 400 : code === 73 ? 507 : 503
        const rejected = /GEO_UPLOAD_REJECTED: ([^\n]+)/.exec(fault)?.[1]
        const statusMessage = code === 75 ? '다른 파일 변환 중. 끝난 뒤 다시.' : rejected || '변환 작업자를 시작하지 못했습니다. 원본 파일은 보존했습니다.'
        fail(createError({ statusCode, statusMessage }))
      }

      if (code !== 0 && ready) void markInterrupted(dir).catch(() => console.error('중단된 업로드 작업 기록을 확인하지 못했습니다.'))

      if (fault && code !== 75) console.error('업로드 작업자 종료:', fault)
    })
  })

  await accepted
}

/** 올린 원본을 보존하고 검증된 업로드 레시피만 전용 작업자에 전달한다. 자동 삭제하지 않는다. */
export async function startJob(o: { format: string; name: string; ext: string; data?: Uint8Array; file?: string; srs?: string; method?: string }) {
  if (running) throw createError({ statusCode: 429, statusMessage: '다른 파일 변환 중. 끝난 뒤 다시.' })

  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(o.format)) throw createError({ statusCode: 400, statusMessage: '형식은 유형/확장자 (예: vector-2d/shp).' })

  if (o.srs && !/^EPSG:\d{4,6}$/.test(o.srs)) throw createError({ statusCode: 400, statusMessage: '좌표계는 EPSG:번호 형식.' })

  if (o.method && !/^[a-z0-9-]{1,40}$/.test(o.method)) throw createError({ statusCode: 400, statusMessage: '방식·도구 이름 형식 아님.' })

  if (!/^\.[a-z0-9]{1,10}$/.test(o.ext)) throw createError({ statusCode: 400, statusMessage: '확장자를 알 수 없는 파일.' })
  const spec = uploadFormats.find(f => `${f.category}/${f.id}` === o.format)

  if (!spec || !('recipes' in spec.upload) || !spec.upload.accept.includes(o.ext)) throw createError({ statusCode: 400, statusMessage: '이 형식에서 받지 않는 파일입니다.' })
  const recipe = o.method ? spec.upload.recipes.find(r => r.id === o.method) : spec.upload.recipes[0]

  if (!recipe) throw createError({ statusCode: 400, statusMessage: '지원하지 않는 변환 방식입니다.' })

  if (process.env.GEO_PUBLIC_CONVERSIONS === '1' && publishesService(recipe)) throw createError({ statusCode: 400, statusMessage: '공개 업로드는 파일 방식만 지원합니다.' })

  if (!o.file && !o.data) throw createError({ statusCode: 400, statusMessage: '원본 파일이 필요합니다.' })

  const id = randomUUID()
  running = id
  const dir = join(JOBS_DIR, id)

  try {
    const incoming = o.file ? (await stat(o.file)).size : o.data?.byteLength ?? 0

    if (incoming > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: '파일 크기 한도를 넘었습니다.' })
    await assertUploadSpace(incoming)
    await mkdir(join(dir, 'raw'), { recursive: true })
    const input = join(dir, 'raw', `input${o.ext}`)

    if (o.file) await copyFile(o.file, input)
    else if (o.data) await writeFile(input, o.data)
    const bytes = (await stat(input)).size

    if (bytes > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: '파일 크기 한도를 넘었습니다.' })
    const job: Job = { id, format: o.format, name: o.name.slice(0, 200), bytes, state: 'running', createdAt: new Date().toISOString(), method: recipe.id }

    if (o.srs) job.srs = o.srs
    await writeFile(join(dir, 'job.json'), JSON.stringify(job, null, 2))
    await launch(dir)

    return id
  } catch (error) {
    if (running === id) running = null
    await markInterrupted(dir)
    throw error
  }
}

/** 작업 상태 + 결과 주소 (지도 화면, 파일 방식은 결과 파일, 서버 방식은 서비스 주소). origin = 이 서버의 바깥 주소 */
export async function jobInfo(id: string, origin: string) {
  const dir = jobDir(id)

  if (!existsSync(join(dir, 'job.json'))) throw createError({ statusCode: 404, statusMessage: '없는 작업' })
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
    view: `${origin}/viz/${job.format}/view?job=${id}`,
    /** 엔진(Unreal) 실시간 보기 가능: 3D Tiles·지형 결과 (geo_engine) */
    engine: process.env.GEO_ENGINE_ENABLED === '1' && job.state === 'done' && !!job.recipe && !!engineOutput(job.recipe),
    /** 운영자가 보관 정책을 별도로 정하기 전까지 원본·결과를 자동 삭제하지 않는다. */
    expiresAt: null,
    retained: true,
    // url = 지도·앱에서 쓰는 주소, download = 내려받기 (파일 방식만)
    outputs: (job.state === 'done' ? job.recipe?.outputs ?? [] : []).map(o => {
      const d = !o.path.startsWith('/svc/') && downloadOf(o, job.name)

      return { id: o.id, label: o.label, kind: o.kind, url: url(o), ...(d && { download: `${origin}/api/jobs/${id}/download/${encodeURIComponent(o.id)}`, zip: d.zip, file: d.name }) }
    }),
  }
}
