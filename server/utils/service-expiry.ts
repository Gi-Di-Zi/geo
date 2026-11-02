// 업로드 서버 방식이 발행한 임시 서비스(최대 48시간)의 만료: 요청마다 판정(server/middleware/service-gate.ts)과 주기 정리(server/plugins/service-sweep.ts).
// 결과 파일 보관과 별개다 → 서비스 리소스(DB 표·GeoServer 레이어·저장소·스타일·서버용 래스터)만 지우고 작업의 원본·결과 파일은 건드리지 않는다.
// 상태는 작업 폴더의 job.json에 있다 → 서버를 다시 켜도 그대로, 꺼져 있던 동안 만료된 것도 다음 정리 때 지운다. 시각(now)은 부르는 쪽이 넣는다 (시험에서 시계 주입)
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Job, ServiceRecord } from '../../shared/types.ts'

export type ServiceState = 'active' | 'expired' | 'deleting' | 'deleted' | 'failed'

export interface SweepResult { job: string; layer: string; result: 'deleted' | 'failed' | 'skipped'; error?: string }

/** 지금 상태. 만료는 시각으로 판정 → 정리 작업이 아직 안 돌았거나 서버를 다시 켜도 만료 뒤 active로 돌아가지 않는다 */
export function serviceState(s: ServiceRecord, now: number): ServiceState {
  if (s.status !== 'active') return s.status

  return s.expiresAt && now < Date.parse(s.expiresAt) ? 'active' : 'expired'
}

/** 작업 id로 만드는 서비스 레이어 이름 (scripts/pipeline.ts runJob과 같은 규칙) */
export const serviceLayer = (jobId: string) => `up_${jobId.slice(0, 8)}`

/** 정리 실패 재시도 간격: 5분부터 두 배씩, 최대 6시간 */
export const retryMs = (attempts: number) => Math.min(5 * 60_000 * 2 ** Math.max(0, attempts - 1), 6 * 3600_000)

async function readJob(file: string): Promise<Job | null> {
  return readFile(file, 'utf8').then(JSON.parse, () => null)
}

async function saveJob(file: string, job: Job) {
  await writeFile(file + '.service.tmp', JSON.stringify(job, null, 2))
  await rename(file + '.service.tmp', file)
}

/** 레이어 이름 → 그 레이어를 발행한 작업의 서비스 기록. 작업 폴더 이름이 레이어 이름의 8자로 시작한다. 없으면 null */
export async function serviceOf(jobsDir: string, layer: string): Promise<ServiceRecord | null> {
  if (!/^up_[0-9a-f]{8}$/.test(layer)) return null

  for (const name of await readdir(jobsDir).catch(() => [])) {
    if (!name.startsWith(layer.slice(3))) continue
    const job = await readJob(join(jobsDir, name, 'job.json'))

    if (job?.service?.layer === layer) return job.service
  }

  return null
}

/**
 * 만료·발행 실패 서비스 정리. 매번 디스크의 작업을 읽는다.
 * drop = 레이어 하나의 서비스 리소스를 지운다. 이미 없는 것을 지워도 성공해야 한다 (멱등: 같은 작업을 다시 돌려도 남의 것은 안 지움).
 * 이 작업 id로 만든 레이어 이름이 아니면 지우지 않고 기록만 남긴다 (stop). 실패하면 failed + 다음 시도 시각
 */
export async function sweepServices(jobsDir: string, now: number, drop: (layer: string) => Promise<void>): Promise<SweepResult[]> {
  const results: SweepResult[] = []

  for (const name of await readdir(jobsDir).catch(() => [])) {
    const file = join(jobsDir, name, 'job.json')
    const job = await readJob(file)
    const s = job?.service

    if (!job || !s || job.state === 'running') continue
    const state = serviceState(s, now)
    const retry = state === 'failed' && !s.cleanup?.stop && (!s.cleanup?.next || now >= Date.parse(s.cleanup.next))

    if (state !== 'expired' && state !== 'deleting' && !retry) continue
    const attempts = (s.cleanup?.attempts ?? 0) + 1
    const at = new Date(now).toISOString()

    if (s.layer !== serviceLayer(job.id) || job.layer !== s.layer) {
      const error = `소유 확인 불가: 작업 ${job.id}의 레이어 이름(${serviceLayer(job.id)})과 기록(${s.layer}·${job.layer ?? '없음'})이 다름 → 지우지 않음`

      job.service = { ...s, status: 'failed', cleanup: { attempts, at, error, stop: true } }
      await saveJob(file, job)
      results.push({ job: job.id, layer: s.layer, result: 'skipped', error })
      continue
    }

    job.service = { ...s, status: 'deleting', cleanup: { attempts, at } }
    await saveJob(file, job)

    try {
      await drop(s.layer)
      job.service = { ...s, status: 'deleted', cleanup: { attempts, at } }
      results.push({ job: job.id, layer: s.layer, result: 'deleted' })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)

      job.service = { ...s, status: 'failed', cleanup: { attempts, at, error, next: new Date(now + retryMs(attempts)).toISOString() } }
      results.push({ job: job.id, layer: s.layer, result: 'failed', error })
    }

    await saveJob(file, job)
  }

  return results
}
