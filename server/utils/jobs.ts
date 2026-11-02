// 업로드 작업: 원본 보존 → 전용 작업자 변환 → 상태·결과 주소. 업로드 API와 MCP 도구가 같이 쓴다
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, openAsBlob } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { downloadOf } from '#shared/catalog/delivery'
import { recommend, SERVICE_OFF, viewerName, type Intent } from '#shared/recommend'
import { sniff } from '#shared/sniff'
import { kindCrs, kindHosting, usage } from '#shared/snippets'
import type { Job, JobIntent, Output, Report } from '#shared/types'
import { engineOutput, kindLabels, viewers } from '#shared/viewers'
import { MAX_UPLOAD_BYTES, publishesService, SERVICE_HOURS } from '#shared/conversion'
import type { BundleCheck } from './bundle-check'
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

/** 이 실행 환경이 업로드 작업의 공간 서비스 발행(48시간 임시)을 허용하는지. 공개 배포(GEO_PUBLIC_CONVERSIONS=1)는 파일만 */
export const serviceEnabled = () => process.env.GEO_PUBLIC_CONVERSIONS !== '1'

/** 서버에 저장된 원본·결과 파일의 보관 (서비스 48시간과 별개) */
export const FILE_RETENTION = '서버의 원본·결과 파일과 내려받기 URL은 운영자가 정리할 때까지 보관 (보관 기간 보장 없음). 내려받은 파일은 서버·서비스 만료와 무관하게 계속 사용 가능'

/**
 * 올린 원본을 보존하고 검증된 업로드 레시피만 전용 작업자에 전달한다. 자동 삭제하지 않는다.
 * 요청이 보낸 판별·추천은 믿지 않는다: 서버에서 다시 판별(형식 후보·좌표계·막힘)하고 추천을 계산해 방식·뷰어·결과 형식·제공 방식 조건을 확인한다.
 * method 생략 = 추천 방식
 */
export async function startJob(o: { format: string; name: string; ext: string; data?: Uint8Array; file?: string; srs?: string; method?: string; intent?: Intent }) {
  if (running) throw createError({ statusCode: 429, statusMessage: '다른 파일 변환 중. 끝난 뒤 다시.' })

  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(o.format)) throw createError({ statusCode: 400, statusMessage: '형식은 유형/확장자 (예: vector-2d/shp).' })

  if (o.srs && !/^EPSG:\d{4,6}$/.test(o.srs)) throw createError({ statusCode: 400, statusMessage: '좌표계는 EPSG:번호 형식.' })

  if (o.method && !/^[a-z0-9-]{1,40}$/.test(o.method)) throw createError({ statusCode: 400, statusMessage: '방식·도구 이름 형식 아님.' })

  if (!/^\.[a-z0-9]{1,10}$/.test(o.ext)) throw createError({ statusCode: 400, statusMessage: '확장자를 알 수 없는 파일.' })
  const spec = uploadFormats.find(f => `${f.category}/${f.id}` === o.format)

  if (!spec || !('recipes' in spec.upload) || !spec.upload.accept.includes(o.ext)) throw createError({ statusCode: 400, statusMessage: '이 형식에서 받지 않는 파일입니다.' })

  if (!o.file && !o.data) throw createError({ statusCode: 400, statusMessage: '원본 파일이 필요합니다.' })

  const id = randomUUID()
  running = id
  const dir = join(JOBS_DIR, id)

  try {
    const incoming = o.file ? (await stat(o.file)).size : o.data?.byteLength ?? 0

    if (incoming > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: '파일 크기 한도를 넘었습니다.' })
    // SAFETY: 업로드 본문(readMultipartFormData의 Buffer)은 일반 ArrayBuffer 위의 바이트다 (SharedArrayBuffer 아님) — 타입만 넓게 선언됨
    const data = o.data as Uint8Array<ArrayBuffer> | undefined
    const found = await sniff(o.file ? await openAsBlob(o.file) : new Blob(data ? [data] : []), o.name, allFormats)

    if (!found.picks.includes(spec)) throw createError({ statusCode: 400, statusMessage: `이 파일은 ${o.format} 형식으로 판별되지 않음 — ${found.note ?? `후보: ${found.picks.map(f => `${f.category}/${f.id}`).join(', ')}`}` })

    if (found.blocked) throw createError({ statusCode: 400, statusMessage: found.blocked })
    const srs = o.srs ?? found.srs?.guess

    if (found.srs && !srs) throw createError({ statusCode: 400, statusMessage: `좌표계 필요: ${found.srs.why} → srs에 EPSG:번호` })
    const intent = o.intent ?? {}
    const facts = { bytes: incoming, count: found.count, srs: found.srs ?? null, schema: found.schema ?? null }
    let plan = recommend(spec, intent, facts, serviceEnabled())
    const recipe = spec.upload.recipes.find(r => r.id === (o.method ?? plan.recommended?.method))

    if (!recipe) throw createError({ statusCode: 400, statusMessage: o.method ? '지원하지 않는 변환 방식입니다.' : `조건에 맞는 방식 없음 — ${plan.conflict ?? ''}` })
    const way = publishesService(recipe) ? 'service' : 'file'

    if (way === 'service' && !serviceEnabled()) throw createError({ statusCode: 400, statusMessage: `공개 업로드는 파일 방식만 지원합니다. ${SERVICE_OFF}` })

    if (intent.delivery && intent.delivery !== way) throw createError({ statusCode: 400, statusMessage: `요청한 제공 방식(${intent.delivery})과 고른 방식(${recipe.title} = ${way}) 다름` })

    if (plan.intent.delivery !== way) plan = recommend(spec, { ...intent, delivery: way }, facts, serviceEnabled())
    const chosen = plan.candidates.find(c => c.method === recipe.id)

    if (!chosen || chosen.fit === 'unsupported') throw createError({ statusCode: 400, statusMessage: `${recipe.title}: ${chosen?.reasons[0] ?? '조건에 맞지 않는 방식'}` })
    await assertUploadSpace(incoming)
    await mkdir(join(dir, 'raw'), { recursive: true })
    const input = join(dir, 'raw', `input${o.ext}`)

    if (o.file) await copyFile(o.file, input)
    else if (o.data) await writeFile(input, o.data)
    const bytes = (await stat(input)).size

    if (bytes > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: '파일 크기 한도를 넘었습니다.' })
    const kept: JobIntent = { priority: plan.intent.priority, reason: (plan.recommended ?? chosen).reasons.join(' · ') }

    if (plan.recommended) kept.recommended = plan.recommended.method

    if (intent.viewer) kept.viewer = intent.viewer

    if (intent.output) kept.output = intent.output

    if (chosen.primary) kept.primary = chosen.primary.id
    const job: Job = { id, format: o.format, name: o.name.slice(0, 200), bytes, state: 'running', createdAt: new Date().toISOString(), method: recipe.id, intent: kept }

    if (srs) job.srs = srs
    await writeFile(join(dir, 'job.json'), JSON.stringify(job, null, 2))
    await launch(dir)

    return id
  } catch (error) {
    if (running === id) running = null
    await markInterrupted(dir)
    throw error
  }
}

/** 결과 파일 검사는 완료 뒤 한 번 (끝난 결과는 바뀌지 않는다) */
const checks = new Map<string, Promise<BundleCheck>>()

/**
 * 작업 상태 + 결과. 파일 방식: 주력 결과물(대상 뷰어용)·내려받기·리소스 주소·적용 코드·호스팅 조건·결과 검사.
 * 서비스 방식: 서비스 주소·발행/만료 시각·남은 시간·상태 (만료 차단은 요청마다 server/middleware/service-gate.ts). origin = 이 서버의 바깥 주소
 */
export async function jobInfo(id: string, origin: string, now = Date.now()) {
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
  const intent = job.intent
  const viewer = intent?.viewer
  const use = viewer && recipe ? recipe.viewers[viewer] : undefined
  const primaryId = intent?.primary ?? (use && 'output' in use ? use.output : undefined)
  const outputs = job.state === 'done' ? job.recipe?.outputs ?? [] : []
  const s = job.service
  const state = s ? serviceState(s, now) : null
  const live = state === 'active'

  const list = await Promise.all(outputs.map(async o => {
    const d = !o.path.startsWith('/svc/') && downloadOf(o, job.name)
    const measured = report?.outputs.find(r => r.id === o.id)
    let check: BundleCheck | undefined

    if (d) {
      const key = `${id}:${o.id}`
      const pending = checks.get(key) ?? checkBundle(join(dir, 'upload'), o, d.path)

      checks.set(key, pending)
      check = await pending
    }

    return {
      id: o.id, label: o.label, kind: o.kind, kindLabel: kindLabels[o.kind], url: url(o), primary: o.id === primaryId, service: !d,
      // 서비스 주소는 만료되면 쓸 수 없다 → 화면이 복사·열기를 정상처럼 보이지 않게
      available: d ? true : live,
      crs: kindCrs[o.kind], bounds: o.bounds ?? null, layer: o.layer ?? null, features: measured?.features ?? null,
      ...(d && { download: `${origin}/api/jobs/${id}/download/${encodeURIComponent(o.id)}`, zip: d.zip, file: d.name, hosting: kindHosting[o.kind] }),
      ...(check && { check }),
    }
  }))

  list.sort((a, b) => Number(b.primary) - Number(a.primary))
  const primary = list.find(o => o.primary) ?? null
  const problems: string[] = []

  if (job.state === 'done' && primaryId && !primary) problems.push(`주력 결과물(${primaryId})이 결과에 없음`)

  if (primary?.check && !primary.check.ok) problems.push(...primary.check.problems)

  // 적용 코드: 고른 뷰어면 그 뷰어 하나, 미지정이면 이 방식이 그리는 뷰어마다. 주소는 내려받아 올린 곳 주소로 바꾸면 그대로
  const usages = job.state !== 'done' || !job.recipe ? [] : viewers.flatMap(v => {
    const u = job.recipe?.viewers[v.id]
    const pick = viewer === v.id && primaryId ? primaryId : u && 'output' in u ? u.output : undefined
    const o = outputs.find(x => x.id === pick)

    if (!o || (viewer && viewer !== v.id)) return []

    return [{ viewer: v.id, name: v.name, output: o.id, ...usage(v.id, o, url(o), job.recipe?.view) }]
  })

  // 이 결과의 손실·배치 제약: 시작할 때와 같은 조건으로 다시 계산 (목적 없는 예전 작업은 기본 조건)
  const plan = spec && recipe ? recommend(spec, { ...intent, delivery: isServerRecipe(recipe) ? 'service' : 'file' }, { bytes: job.bytes }, true) : null
  const limits = [...(plan?.candidates.find(c => c.method === recipe?.id)?.warnings ?? []), ...(plan?.notes ?? [])]

  return {
    job: id,
    name: job.name,
    state: job.state,
    format: job.format,
    method: recipe ? { id: recipe.id, title: recipe.title, way: isServerRecipe(recipe) ? 'server' : 'file' } : undefined,
    /** 제공 방식: file = 가져가 쓰는 결과 파일, service = 48시간 임시 공간 서비스 */
    delivery: recipe && isServerRecipe(recipe) ? 'service' : 'file',
    intent: intent ? { ...intent, viewerName: viewer ? viewerName(viewer) : null } : null,
    srs: job.srs,
    error: job.error,
    progress: { done, total: steps.length, current: job.state === 'running' ? steps[done]?.title : undefined, ms: report?.totalMs ?? 0 },
    view: `${origin}/viz/${job.format}/view?job=${id}${viewer ? `&viewer=${viewer}` : ''}`,
    /** 엔진(Unreal) 실시간 보기 가능: 3D Tiles·지형 결과 (geo_engine) */
    engine: process.env.GEO_ENGINE_ENABLED === '1' && job.state === 'done' && !!job.recipe && !!engineOutput(job.recipe),
    /** 결과 파일에는 자동 삭제 시각이 없다 (서비스 만료와 별개) */
    expiresAt: null,
    retained: true,
    retention: FILE_RETENTION,
    /** 서비스 방식: 발행 완료 후 48시간. 만료 뒤 서비스 주소는 410 */
    service: s ? {
      id: s.layer, layer: s.layer, status: state, hours: SERVICE_HOURS, publishedAt: s.publishedAt ?? null, expiresAt: s.expiresAt ?? null,
      remainingSec: live && s.expiresAt ? Math.max(0, Math.round((Date.parse(s.expiresAt) - now) / 1000)) : 0,
      cleanup: s.cleanup ?? null,
    } : null,
    primary,
    limits,
    outputs: list,
    usages,
    /** 끝났지만 결과가 약속과 다름 (주력 결과물 없음·검사 실패) → 완료로 안내하지 않는다 */
    problems,
  }
}
