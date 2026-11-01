// 업로드한 파일을 보존하고 내용을 판별한다. URL 가져오기와 서버 로컬 경로 입력은 제공하지 않는다.
// 형식·방식을 고른 뒤 작업을 시작할 때 다시 올리지 않고 이 파일을 쓴다 (MCP 도구·업로드 위젯)
import { randomUUID } from 'node:crypto'
import { existsSync, openAsBlob } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { sniff } from '#shared/sniff'
import type { Job } from '#shared/types'

const stageRoot = () => join(uploadDataRoot(), 'stage')

export interface Staged { id: string; name: string; bytes: number; ext: string; file: string }

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 내용을 맡긴다. 파일 이름에서 확장자만 쓴다 */
export async function stageData(name: string, data: Uint8Array): Promise<Staged> {
  const ext = extname(name).toLowerCase()

  if (!/^\.[a-z0-9]{1,10}$/.test(ext)) throw createError({ statusCode: 400, statusMessage: `확장자를 알 수 없는 파일: ${name}` })

  if (data.length > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` })
  await assertUploadSpace(data.length)
  const id = randomUUID()
  const dir = join(stageRoot(), id)
  await mkdir(dir, { recursive: true })
  const s: Staged = { id, name: basename(name).slice(0, 200), bytes: data.length, ext, file: join(dir, `input${ext}`) }
  await writeFile(s.file, data)
  await writeFile(join(dir, 'stage.json'), JSON.stringify(s))

  return s
}

/** 맡긴 파일. 이전 작업 id면 그 작업의 원본(raw/input.*, 읽기 전용) — 같은 파일을 다른 형식·방식으로 다시 변환 */
export async function readStage(id: string): Promise<Staged> {
  const safe = ID.test(id) ? id : '-'
  const file = join(stageRoot(), safe, 'stage.json')

  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'))
  const raw = join(JOBS_DIR, safe, 'raw')
  const input = existsSync(raw) ? (await readdir(raw))[0] : undefined

  if (!input) throw createError({ statusCode: 404, statusMessage: '맡긴 파일·작업 없음 → 파일을 다시 올려 주세요' })
  const job: Job = JSON.parse(await readFile(join(JOBS_DIR, safe, 'job.json'), 'utf8'))

  return { id, name: job.name, bytes: job.bytes, ext: extname(input), file: join(raw, input) }
}

/**
 * 조각 업로드 (업로드 위젯이 서버에 직접 못 보낼 때 도구 호출로 나눠 보낸다). upload = 첫 조각 뒤 받은 id.
 * last면 맡기고 판별까지. ponytail: 조각 순서는 위젯이 보장(순서대로 하나씩 보냄)
 */
export async function stageChunk(c: { upload?: string; name: string; data: string; last: boolean }) {
  if (c.upload && !ID.test(c.upload)) throw createError({ statusCode: 400, statusMessage: '올바른 업로드 id가 필요합니다.' })

  if (c.data.length > 1024 ** 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(c.data)) throw createError({ statusCode: 400, statusMessage: '올바른 크기의 Base64 조각이 필요합니다.' })
  await assertUploadSpace(Buffer.byteLength(c.data, 'base64'))
  const upload = c.upload || randomUUID()
  const part = join(stageRoot(), '_parts', upload)
  await mkdir(join(stageRoot(), '_parts'), { recursive: true })
  await appendFile(part, Buffer.from(c.data, 'base64'))

  if ((await stat(part)).size > UPLOAD_LIMIT) { await rm(part, { force: true }); throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` }) }

  if (!c.last) return { upload }
  const s = await stageData(c.name, await readFile(part))
  await rm(part, { force: true })

  return { upload, staged: s }
}

/** 판별: 맡긴 파일의 형식 후보(가능성 순) + 근거·주의·좌표계 필요 여부 + 후보마다 고를 수 있는 방식·도구 */
export async function identify(s: Staged) {
  const r = await sniff(await openAsBlob(s.file), s.name, allFormats)

  return {
    stage: s.id,
    name: s.name,
    bytes: s.bytes,
    facts: r.facts,
    warns: r.warns,
    srs: r.srs ?? null,
    note: r.note ?? null,
    formats: r.picks.map((f, i) => ({ ...describeFormat(f), best: i === 0 })),
  }
}
