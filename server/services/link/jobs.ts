import { createHash, randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { resolveRows, referenceMetadata } from '../../../shared/link/core.ts'
import { linkOptionsSchema } from '../../../shared/link/types.ts'
import type { InputRow, LinkBatch, LinkOptions, LinkStatus, ReferenceSnapshot } from '../../../shared/link/types.ts'
import { hashAccess, hasAccess, newAccessToken } from './access.ts'
import type { LinkAccess } from './access.ts'
import { exportBatch, LinkServiceError, linkLimits } from './files.ts'
import { inputRows, linkId } from './service.ts'
import { getReference } from './reference.ts'

export const LINK_JOBS_DIR = resolve(process.env.LINK_DATA_DIR || '.data/link', 'jobs')
const processId = randomUUID()
const active = new Set<string>()
const queue: Array<() => Promise<void>> = []
const starting = new Map<string, Promise<unknown>>()
const exporting = new Map<string, Promise<ArtifactInfo>>()
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
type JobState = 'queued' | 'running' | 'completed' | 'completed_with_issues' | 'failed'
interface StoredJob {
  id: string; ownerHash?: string; tokenHash: string; grants: string[]; processId: string
  state: JobState; createdAt: string; expiresAt: string; startedAt?: string; finishedAt?: string
  reference: ReturnType<typeof referenceMetadata>; options: LinkOptions; inputChecksum: string
  schemaVersion: string; ruleVersion: string; progress: { done: number; total: number }; error?: { code: string; message: string }
}
const directory = (id: string) => join(LINK_JOBS_DIR, linkId(id))
const save = (job: StoredJob) => writeFileSync(join(directory(job.id), 'job.json'), JSON.stringify(job))
async function readJob(id: string, access: LinkAccess): Promise<StoredJob> {
  let job: StoredJob
  try { job = JSON.parse(await readFile(join(directory(id), 'job.json'), 'utf8')) }
  catch (error) { if (error instanceof LinkServiceError) throw error; throw new LinkServiceError('NOT_FOUND', '작업을 찾을 수 없습니다.', 404) }
  if (access.owner && existsSync(join(directory(id), 'grants', hashAccess(access.owner)))) job.grants.push(hashAccess(access.owner))
  if (!hasAccess(job, access)) throw new LinkServiceError('FORBIDDEN', '작업 접근권한이 없습니다.', 403)
  if (Date.parse(job.expiresAt) <= Date.now()) throw new LinkServiceError('EXPIRED', '작업 보관 기간이 지났습니다.', 410)
  if (['queued', 'running'].includes(job.state) && job.processId !== processId) {
    job.state = 'failed'; job.finishedAt = new Date().toISOString(); job.error = { code: 'JOB_INTERRUPTED', message: '서버 재시작으로 작업이 중단되었습니다. 원본으로 다시 실행하세요.' }; save(job)
  }
  return job
}
function publicJob(job: StoredJob) {
  const { ownerHash, tokenHash, grants, processId: instance, ...result } = job
  return result
}
function drain() {
  while (active.size < linkLimits.concurrency && queue.length) {
    const task = queue.shift()!
    void task()
  }
}
async function execute(job: StoredJob, rows: InputRow[], snapshot: ReferenceSnapshot) {
  active.add(job.id)
  job.state = 'running'; job.startedAt = new Date().toISOString(); save(job)
  const started = performance.now()
  try {
    const seen = new Set<string>(), selected = rows.filter(row => {
      if (job.options.deduplicate && seen.has(row.value)) return false
      seen.add(row.value); return true
    })
    const result = resolveRows([], job.options, snapshot)
    const chunkSize = job.options.expandCandidates ? 20 : 200
    let resultBytes = 0
    for (let at = 0; at < selected.length; at += chunkSize) {
      if (performance.now() - started > linkLimits.timeoutMs) throw new LinkServiceError('JOB_TIMEOUT', '작업 실행 시간 한도를 넘었습니다. 입력을 나누어 다시 실행하세요.', 408)
      const part = resolveRows(selected.slice(at, at + chunkSize), { ...job.options, deduplicate: false }, snapshot)
      if (result.rows.length + part.rows.length > linkLimits.resultRows) throw new LinkServiceError('RESULT_TOO_LARGE', '결과 행 한도를 넘었습니다. 후보 펼치기를 끄거나 입력을 나누세요.', 413)
      for (const row of part.rows) {
        resultBytes += Buffer.byteLength(JSON.stringify(row))
        if (resultBytes > linkLimits.resultBytes) throw new LinkServiceError('RESULT_TOO_LARGE', '결과 크기 한도를 넘었습니다. 입력을 나누세요.', 413)
      }
      result.rows.push(...part.rows)
      for (const key of ['ok', 'needs_selection', 'invalid', 'not_found', 'unavailable'] as const) result.summary[key] += part.summary[key]
      for (const [code, count] of Object.entries(part.errors)) result.errors[code] = (result.errors[code] || 0) + count
      job.progress.done = Math.min(at + chunkSize, selected.length); save(job)
      await new Promise<void>(done => setImmediate(done))
    }
    result.summary.total = result.rows.length; result.summary.input = rows.length; result.summary.omittedDuplicates = rows.length - selected.length
    await writeFile(join(directory(job.id), 'result.json'), JSON.stringify(result))
    job.progress.done = rows.length
    job.state = result.summary.ok === result.summary.total ? 'completed' : 'completed_with_issues'
  } catch (error) {
    job.state = 'failed'; job.error = error instanceof LinkServiceError ? { code: error.code, message: error.message } : { code: 'JOB_FAILED', message: '작업 처리 중 오류가 발생했습니다. 원본과 옵션을 확인해 다시 실행하세요.' }
  } finally {
    job.finishedAt = new Date().toISOString(); save(job); active.delete(job.id); drain()
  }
}
async function create(raw: unknown, access: LinkAccess, idempotencyKey?: string) {
  if (!access.owner && !access.token) throw new LinkServiceError('UNAUTHORIZED', '작업 소유자 권한이 필요합니다.', 401)
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(idempotencyKey))) throw new LinkServiceError('INVALID_IDEMPOTENCY_KEY', '중복 요청 키 형식이 올바르지 않습니다.')
  const { input, rows } = await inputRows(raw, access), snapshot = await getReference(), options = linkOptionsSchema.parse(input.options || {})
  if (options.inputType === 'administrative' || options.inputType === 'location' || ['administrative_region', 'location', 'legal_boundary', 'all'].includes(options.target || '')) throw new LinkServiceError('DIRECT_INPUT_REQUIRED', '행정동·위치·경계·전체 결과 변환은 직접 입력의 즉시 변환을 사용하세요.')
  const inputChecksum = digest(JSON.stringify(rows)), fingerprint = digest(JSON.stringify({ inputChecksum, options, version: snapshot.version }))
  const scope = hashAccess(access.owner || access.token!)
  const index = idempotencyKey && join(LINK_JOBS_DIR, '_requests', digest(`${scope}:${idempotencyKey}`) + '.json')
  if (index && existsSync(index)) {
    const previous = JSON.parse(await readFile(index, 'utf8'))
    if (previous.fingerprint !== fingerprint) throw new LinkServiceError('IDEMPOTENCY_CONFLICT', '같은 중복 요청 키에 다른 입력·옵션·기준 버전을 사용할 수 없습니다.', 409)
    const job = await readJob(previous.id, access)
    return { ...publicJob(job), reused: true }
  }
  if (queue.length >= linkLimits.queuedJobs) throw new LinkServiceError('JOB_QUEUE_FULL', '대기 중인 작업이 많습니다. 잠시 뒤 다시 실행하세요.', 429)
  const id = randomUUID(), accessToken = newAccessToken(), createdAt = new Date().toISOString()
  const job: StoredJob = { id, ownerHash: access.owner ? hashAccess(access.owner) : undefined, tokenHash: hashAccess(accessToken), grants: [], processId,
    state: 'queued', createdAt, expiresAt: new Date(Date.now() + linkLimits.ttlMs).toISOString(), reference: referenceMetadata(snapshot), options, inputChecksum,
    schemaVersion: '1', ruleVersion: 'geo-link-v1', progress: { done: 0, total: rows.length } }
  await mkdir(directory(id), { recursive: true })
  await writeFile(join(directory(id), 'input.json'), JSON.stringify({ rows, options }))
  save(job)
  if (index) { await mkdir(join(LINK_JOBS_DIR, '_requests'), { recursive: true }); await writeFile(index, JSON.stringify({ id, fingerprint })) }
  queue.push(() => execute(job, rows, snapshot)); setImmediate(drain)
  return { ...publicJob(job), accessToken, reused: false }
}
export async function startLinkJob(raw: unknown, access: LinkAccess, idempotencyKey?: string) {
  const key = digest(`${access.owner || access.token}:${idempotencyKey || randomUUID()}`)
  const pending = starting.get(key)
  if (pending) { await pending; return create(raw, access, idempotencyKey) }
  const operation = create(raw, access, idempotencyKey)
  starting.set(key, operation)
  try { return await operation } finally { starting.delete(key) }
}
export async function getLinkJob(id: string, access: LinkAccess, offset = 0, limit = 50, status?: LinkStatus) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new LinkServiceError('INVALID_PAGE', '페이지 범위가 올바르지 않습니다.')
  const job = await readJob(id, access)
  let result: LinkBatch | undefined
  if (job.state === 'completed' || job.state === 'completed_with_issues') result = JSON.parse(await readFile(join(directory(id), 'result.json'), 'utf8'))
  const rows = result?.rows.filter(row => !status || row.status === status) || [], total = rows.length
  return { ...publicJob(job), result: result && { ...result, rows: rows.slice(offset, offset + limit) }, offset, total, returned: Math.min(limit, Math.max(0, total - offset)), nextOffset: offset + limit < total ? offset + limit : null, truncated: offset + limit < total, view: `/link#job=${id}` }
}
export async function rerunLinkJob(id: string, access: LinkAccess, options: unknown) {
  await readJob(id, access)
  const input = JSON.parse(await readFile(join(directory(id), 'input.json'), 'utf8'))
  return startLinkJob({ rows: input.rows, options: options === undefined ? input.options : linkOptionsSchema.parse(options) }, access)
}
export async function claimLinkJob(id: string, token: string, owner: string) {
  const job = await readJob(id, { token })
  const ownerHash = hashAccess(owner)
  if (!job.grants.includes(ownerHash) && job.ownerHash !== ownerHash) {
    const folder = join(directory(id), 'grants')
    await mkdir(folder, { recursive: true })
    if ((await readdir(folder)).length >= 20 && !existsSync(join(folder, ownerHash))) throw new LinkServiceError('TOO_MANY_GRANTS', '작업 접근권한 수 한도를 넘었습니다.', 429)
    try { await writeFile(join(folder, ownerHash), '', { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  return { id: job.id, claimed: true }
}
export async function exportLinkJob(id: string, access: LinkAccess, format: string, columns?: string[]) {
  const job = await readJob(id, access)
  if (!['completed', 'completed_with_issues'].includes(job.state)) throw new LinkServiceError('JOB_NOT_READY', '작업 완료 후 파일을 출력할 수 있습니다.', 409)
  const batch: LinkBatch = JSON.parse(await readFile(join(directory(id), 'result.json'), 'utf8'))
  return exportBatch(batch, format, columns)
}
interface ArtifactInfo { artifactId: string; url: string; filename: string; mime: string; bytes: number }
export async function createLinkExport(id: string, access: LinkAccess, format: string, columns?: string[]): Promise<ArtifactInfo> {
  await readJob(id, access)
  const key = `${id}:${digest(JSON.stringify({ format, columns }))}`
  const pending = exporting.get(key)
  if (pending) return pending
  const operation = generateExport(id, access, format, columns, key.split(':')[1]!)
  exporting.set(key, operation)
  try { return await operation } finally { exporting.delete(key) }
}
async function generateExport(id: string, access: LinkAccess, format: string, columns: string[] | undefined, fingerprint: string): Promise<ArtifactInfo> {
  const folder = join(directory(id), 'artifacts')
  const index = join(folder, `${fingerprint}.request.json`)
  if (existsSync(index)) return JSON.parse(await readFile(index, 'utf8'))
  const exported = await exportLinkJob(id, access, format, columns), artifactId = randomUUID()
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, artifactId + '.bin'), exported.data)
  const info = { artifactId, url: `/api/link/jobs/${id}/artifacts/${artifactId}`, filename: exported.filename, mime: exported.mime, bytes: exported.data.length }
  await writeFile(join(folder, artifactId + '.json'), JSON.stringify(info))
  await writeFile(index, JSON.stringify(info))
  return info
}
export async function readLinkArtifact(id: string, artifactId: string, access: LinkAccess) {
  await readJob(id, access)
  const folder = join(directory(id), 'artifacts'), safe = linkId(artifactId)
  try {
    const info = JSON.parse(await readFile(join(folder, safe + '.json'), 'utf8'))
    return { data: await readFile(join(folder, safe + '.bin')), mime: String(info.mime), filename: String(info.filename) }
  } catch { throw new LinkServiceError('NOT_FOUND', '출력 파일을 찾을 수 없습니다.', 404) }
}
/** 삭제 없이 보관 현황만 확인한다. 기준 사전은 이 경로에 없다. */
export async function linkRetentionInventory() {
  const jobs: Array<{ id: string; expiresAt: string; expired: boolean; state: string }> = []
  for (const id of await readdir(LINK_JOBS_DIR).catch(() => [])) {
    if (!/^[0-9a-f-]{36}$/.test(id)) continue
    try { const job: StoredJob = JSON.parse(await readFile(join(directory(id), 'job.json'), 'utf8')); jobs.push({ id, expiresAt: job.expiresAt, expired: Date.parse(job.expiresAt) <= Date.now(), state: job.state }) } catch {}
  }
  return { checkedAt: new Date().toISOString(), jobs, physicalDeletion: false, note: '삭제 금지 작업 합의로 물리 정리를 실행하지 않습니다. 만료 자료는 읽기 API가 차단합니다.' }
}
