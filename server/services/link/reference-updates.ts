import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { referenceInfo, refreshReference } from './reference.ts'
import { administrativeInfo, refreshAdministrativeReference } from './administrative-reference.ts'

const COOLDOWN_MS = 5 * 60_000
const LEASE_MS = 5 * 60_000
export const referenceDay = (value: number | string) => new Date(new Date(value).getTime() + 9 * 3600_000).toISOString().slice(0, 10)

const stateSchema = z.enum(['ready', 'checking', 'done', 'failed'])
const resultSchema = z.object({ state: stateSchema, checkedAt: z.string(), message: z.string().optional() })

const attemptSchema = z.object({
  day: z.string(), attempt: z.number().int().positive().max(9999), state: z.enum(['checking', 'complete']),
  startedAt: z.string(), finishedAt: z.string().optional(), pid: z.number().int().nonnegative(),
  leaseUntil: z.number().finite(), results: z.record(z.string(), resultSchema),
})

const historySchema = z.object({
  state: z.string().optional(), checkedAt: z.string().optional(), message: z.string().optional(),
  pid: z.number().int().nonnegative().optional(),
  leaseUntil: z.union([z.number().finite(), z.iso.datetime().transform(value => Date.parse(value))]).optional(),
})

const refreshSchema = z.object({ state: z.string().optional(), message: z.string().optional() })

type State = z.infer<typeof stateSchema>

type Attempt = z.infer<typeof attemptSchema>

type SourceHistory = z.input<typeof historySchema>

type RefreshResult = z.infer<typeof refreshSchema>

export interface ReferenceUpdateInfo {
  available: boolean; version: string; source: string; sourceUrl: string; count: number
  sourceDate?: string | null; publishedAt?: string | null; checkedAt?: string | null; activatedAt?: string | null; ingestedAt?: string | null; warning?: string
}

export interface ReferenceUpdateSource {
  id: string; label: string
  info: () => Promise<ReferenceUpdateInfo>
  refresh: (force?: boolean) => Promise<RefreshResult>
  history?: (day: string) => Promise<SourceHistory | null>
}

interface SourceStatus extends ReferenceUpdateInfo {
  id: string; label: string; state: State; message: string; retryAt?: string
}

interface ReferenceUpdateStatus {
  day: string; timeZone: 'Asia/Seoul'; state: State; canUpdate: boolean; retryAt?: string; message: string; sources: SourceStatus[]
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)

    return true
  } catch { return false }
}

async function readHistory(file: string) {
  try {
    const parsed = historySchema.safeParse(JSON.parse(await readFile(file, 'utf8')))

    return parsed.success ? parsed.data : null
  } catch { return null }
}

const successful = (state?: string) => ['updated', 'no_change', 'already_checked', 'done'].includes(state || '')

/** 일자·시도 번호를 독점 생성하므로 다른 사용자·서버 요청도 같은 실행을 공유한다. */
export function createReferenceUpdater(config: { directory: string; sources: ReferenceUpdateSource[]; now?: () => number }) {
  const now = config.now || Date.now
  let pending: Promise<ReferenceUpdateStatus> | undefined

  async function latest(day: string): Promise<Attempt | undefined> {
    const folder = join(config.directory, day)
    const names = (await readdir(folder).catch(() => [])).filter(name => /^\d{4}\.json$/.test(name)).sort()
    const name = names.at(-1)

    if (!name) return

    const parsed = await readFile(join(folder, name), 'utf8').then(text => {
      try { return attemptSchema.safeParse(JSON.parse(text)) } catch { return null }
    }, () => null)

    if (parsed?.success && parsed.data.day === day) return parsed.data
    const modified = await stat(join(folder, name))

    return { day, attempt: Number(name.slice(0, 4)), state: 'complete', startedAt: modified.mtime.toISOString(), finishedAt: modified.mtime.toISOString(), pid: 0, leaseUntil: 0,
      results: Object.fromEntries(config.sources.map(source => [source.id, { state: 'failed', checkedAt: modified.mtime.toISOString(), message: '이전 업데이트 기록이 중단되었습니다. 잠시 뒤 다시 시도하세요.' }])) }
  }

  async function observe() {
    const stamp = now(), day = referenceDay(stamp), attempt = await latest(day)
    const active = attempt?.state === 'checking' && attempt.leaseUntil > stamp && alive(attempt.pid)

    const sources: SourceStatus[] = await Promise.all(config.sources.map(async source => {
      const info = await source.info()
      const parsedHistory = historySchema.safeParse(await source.history?.(day))
      const history = parsedHistory.success ? parsedHistory.data : null
      const previous = attempt?.results[source.id]
      const checkedToday = info.available && [info.checkedAt, info.activatedAt].some(value => value && referenceDay(value) === day)
      let state: State = 'ready', message = '', failedAt = 0

      if (checkedToday || successful(history?.state) || previous?.state === 'done') { state = 'done'; message = '오늘 확인한 기준자료입니다. 다시 적용하지 않습니다.' }
      else if (active) { state = 'checking'; message = '다른 사용자와 같은 업데이트를 진행하고 있습니다.' }
      else if (history?.state === 'checking' && Number(history.leaseUntil) > stamp && alive(Number(history.pid))) { state = 'checking'; message = '공식 기준자료를 확인하고 있습니다.' }
      else if (previous?.state === 'checking' && attempt && attempt.leaseUntil > stamp) { state = 'checking'; message = '공식 기준자료의 기존 확인이 끝나기를 기다리고 있습니다.' }
      else if (attempt?.state === 'checking' || history?.state === 'failed' || history?.state === 'checking' || previous?.state === 'failed' || previous?.state === 'checking') {
        state = 'failed'
        failedAt = Date.parse(String(previous?.checkedAt || history?.checkedAt || attempt?.startedAt))

        if (!Number.isFinite(failedAt)) failedAt = stamp
        message = String(previous?.message || history?.message || '이전 확인이 중단되었습니다. 이전 정상 자료는 유지합니다.')
      }

      const retryAt = state === 'failed' ? new Date(failedAt + COOLDOWN_MS).toISOString() : undefined

      return { id: source.id, label: source.label, ...info, state, message, ...(retryAt && { retryAt }) }
    }))

    const checking = sources.some(source => source.state === 'checking')
    const done = sources.every(source => source.state === 'done')
    const failed = sources.some(source => source.state === 'failed')
    const retryTime = Math.max(0, ...sources.flatMap(source => source.state === 'failed' && source.retryAt ? [Date.parse(source.retryAt)] : []))
    const canUpdate = !checking && !done && stamp >= retryTime
    const state: State = checking ? 'checking' : done ? 'done' : failed ? 'failed' : 'ready'

    const snapshot: ReferenceUpdateStatus = { day, timeZone: 'Asia/Seoul', state, canUpdate, ...(retryTime > stamp && { retryAt: new Date(retryTime).toISOString() }),
      message: checking ? '기준자료를 확인하고 있습니다. 중복 요청은 같은 실행을 공유합니다.' : done ? '오늘 기준자료 확인을 마쳤습니다. 같은 자료는 다시 적용하지 않습니다.' : retryTime > stamp ? '업데이트에 실패했습니다. 5분 뒤 다시 시도할 수 있습니다.' : failed ? '이전 정상 자료를 유지하고 있습니다. 업데이트를 다시 시도할 수 있습니다.' : '공식 제공처의 새 자료를 확인할 수 있습니다.', sources }

    return { snapshot, attempt }
  }

  async function status() { return (await observe()).snapshot }

  async function run() {
    const observed = await observe()
    const before = observed.snapshot

    if (!before.canUpdate) return before
    // 상태를 판단한 시도의 다음 번호만 예약한다. 다른 manager가 그 사이 예약했다면 wx 충돌로 같은 실행을 공유한다.
    const day = before.day, number = (observed.attempt?.attempt || 0) + 1

    if (number > 9999) return { ...before, canUpdate: false, message: '오늘 업데이트 시도 한도를 넘었습니다.' }
    const folder = join(config.directory, day), file = join(folder, String(number).padStart(4, '0') + '.json')
    mkdirSync(folder, { recursive: true })
    const startedAt = new Date(now()).toISOString(), record: Attempt = { day, attempt: number, state: 'checking', startedAt, pid: process.pid, leaseUntil: now() + LEASE_MS, results: {} }

    try { writeFileSync(file, JSON.stringify(record), { flag: 'wx', encoding: 'utf8' }) }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return status(); throw error }

    await Promise.all(config.sources.map(async source => {
      const previousSource = before.sources.find(item => item.id === source.id)!

      if (previousSource.state === 'done') {
        record.results[source.id] = { state: 'done', checkedAt: previousSource.checkedAt || startedAt }

        return
      }

      try {
        const raw = await source.refresh(previousSource.state === 'failed')
        const state: State = successful(raw?.state) ? 'done' : raw?.state === 'checking' ? 'checking' : 'failed'
        record.results[source.id] = { state, checkedAt: new Date(now()).toISOString(), ...(state === 'failed' && { message: raw?.message || '자료를 확인하지 못했습니다. 이전 정상 자료를 유지합니다.' }) }
      } catch { record.results[source.id] = { state: 'failed', checkedAt: new Date(now()).toISOString(), message: '공식 자료 확인에 실패했습니다. 이전 정상 자료를 유지합니다.' } }

      writeFileSync(file, JSON.stringify(record), 'utf8')
    }))
    record.state = 'complete'; record.finishedAt = new Date(now()).toISOString()
    writeFileSync(file, JSON.stringify(record), 'utf8')

    return status()
  }

  return { status, update: () => pending ||= run().finally(() => { pending = undefined }) }
}

const updater = createReferenceUpdater({ directory: resolve(process.env.LINK_REFERENCE_UPDATE_DIR || '.data/reference/link/updates'), sources: [
  { id: 'legal', label: '법정동 코드', info: referenceInfo, refresh: async force => {
    const parsed = refreshSchema.safeParse(await refreshReference(force))

    return parsed.success ? parsed.data : { state: 'failed' }
  }, history: day => readHistory(join(resolve(process.env.LINK_REFERENCE_DIR || '.data/reference/link'), 'checks', day + '.json')) },
  { id: 'administrative', label: '행정동·법정동 관할 관계', info: administrativeInfo, refresh: async force => {
    const parsed = refreshSchema.safeParse(await refreshAdministrativeReference(force))

    return parsed.success ? parsed.data : { state: 'failed' }
  }, history: day => readHistory(join(resolve(process.env.LINK_ADMINISTRATIVE_DIR || '.data/reference/link/administrative'), 'checks', day + '.json')) },
] })

export const referenceUpdateStatus = () => updater.status()
export const updateReferences = () => updater.update()
