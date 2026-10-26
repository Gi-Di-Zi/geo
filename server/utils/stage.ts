// 맡긴 파일: 올린 내용·URL·(로컬 연결일 때) 이 PC의 경로를 .data/stage/<id>에 잠깐 두고 형식을 판별한다.
// 형식·방식을 고른 뒤 작업을 시작할 때 다시 올리지 않고 이 파일을 쓴다 (MCP 도구·업로드 위젯)
import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { existsSync, openAsBlob } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { sniff } from '#shared/sniff'
import type { Job } from '#shared/types'

const STAGE_DIR = resolve('.data/stage')
export interface Staged { id: string; name: string; bytes: number; ext: string; file: string }

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function cleanStage() {
  if (!existsSync(STAGE_DIR)) return
  for (const id of await readdir(STAGE_DIR)) {
    const dir = join(STAGE_DIR, id)
    if (Date.now() - (await stat(dir)).mtimeMs > JOB_TTL) await rm(dir, { recursive: true, force: true })
  }
}

/** 내용을 맡긴다. 파일 이름에서 확장자만 쓴다 */
export async function stageData(name: string, data: Uint8Array): Promise<Staged> {
  const ext = extname(name).toLowerCase()
  if (!/^\.[a-z0-9]{1,10}$/.test(ext)) throw createError({ statusCode: 400, statusMessage: `확장자를 알 수 없는 파일: ${name}` })
  if (data.length > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` })
  await cleanStage()
  const id = randomUUID()
  const dir = join(STAGE_DIR, id)
  await mkdir(dir, { recursive: true })
  const s: Staged = { id, name: basename(name).slice(0, 200), bytes: data.length, ext, file: join(dir, `input${ext}`) }
  await writeFile(s.file, data)
  await writeFile(join(dir, 'stage.json'), JSON.stringify(s))
  return s
}

/** 맡긴 파일. 이전 작업 id면 그 작업의 원본(raw/input.*, 읽기 전용) — 같은 파일을 다른 형식·방식으로 다시 변환 */
export async function readStage(id: string): Promise<Staged> {
  const safe = ID.test(id) ? id : '-'
  const file = join(STAGE_DIR, safe, 'stage.json')
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'))
  const raw = join(JOBS_DIR, safe, 'raw')
  const input = existsSync(raw) ? (await readdir(raw))[0] : undefined
  if (!input) throw createError({ statusCode: 404, statusMessage: '맡긴 파일·작업 없음 (24시간 지남 또는 잘못된 id) → 다시 올리기' })
  const job: Job = JSON.parse(await readFile(join(JOBS_DIR, safe, 'job.json'), 'utf8'))
  return { id, name: job.name, bytes: job.bytes, ext: extname(input), file: join(raw, input) }
}

// 내부망·이 PC 주소로는 받지 않는다 (서버가 대신 요청하는 기능이라 내부 서비스 노출 위험)
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^::1?$/, /^f[cd]/i, /^fe80/i, /^::ffff:/i]

/**
 * URL에서 받아 맡긴다. 리다이렉트는 매번 주소를 다시 확인하며 5번까지. 받으면서 크기 상한 확인.
 * ponytail: 확인과 요청 사이 DNS가 바뀌는 공격(DNS rebinding)은 막지 못함. 외부 공개 때 요청 단계에서 IP 고정
 */
export async function stageUrl(url: string): Promise<Staged> {
  let u: URL
  try { u = new URL(url) } catch { throw createError({ statusCode: 400, statusMessage: `URL 형식 아님: ${url}` }) }
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(u.protocol)) throw createError({ statusCode: 400, statusMessage: 'http·https 주소만' })
    const addrs = await lookup(u.hostname, { all: true }).catch(() => [])
    if (!addrs.length) throw createError({ statusCode: 400, statusMessage: `주소를 찾을 수 없음: ${u.hostname}` })
    if (addrs.some(a => PRIVATE.some(p => p.test(a.address)))) throw createError({ statusCode: 400, statusMessage: '내부망·이 PC 주소는 받지 않음' })
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(5 * 60_000) })
    const next = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && next) { u = new URL(next, u); continue }
    if (!res.ok || !res.body) throw createError({ statusCode: 400, statusMessage: `URL 응답 ${res.status} — 바로 내려받을 수 있는 링크인지 확인` })
    if (Number(res.headers.get('content-length') ?? 0) > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` })
    const chunks: Uint8Array[] = []
    let n = 0
    for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
      n += c.length
      if (n > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` })
      chunks.push(c)
    }
    // 파일 이름: Content-Disposition, 없으면 주소 마지막 부분
    const cd = res.headers.get('content-disposition') ?? ''
    const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd)
    return stageData(decodeURIComponent(m?.[1] ?? m?.[2] ?? u.pathname.split('/').pop() ?? ''), Buffer.concat(chunks))
  }
  throw createError({ statusCode: 400, statusMessage: '리다이렉트가 너무 많음' })
}

/** 이 PC의 파일을 맡긴다. 로컬 연결(이 PC에서 띄운 서버에 이 PC가 요청)에서만 허용 — 확인은 부르는 쪽(mcp.ts) */
export async function stagePath(path: string): Promise<Staged> {
  const st = await stat(path).catch(() => null)
  if (!st?.isFile()) throw createError({ statusCode: 400, statusMessage: `파일 없음: ${path}` })
  if (st.size > UPLOAD_LIMIT) throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` })
  return stageData(basename(path), await readFile(path))
}

/**
 * 조각 업로드 (업로드 위젯이 서버에 직접 못 보낼 때 도구 호출로 나눠 보낸다). upload = 첫 조각 뒤 받은 id.
 * last면 맡기고 판별까지. ponytail: 조각 순서는 위젯이 보장(순서대로 하나씩 보냄)
 */
export async function stageChunk(c: { upload?: string; name: string; data: string; last: boolean }) {
  const upload = c.upload && ID.test(c.upload) ? c.upload : randomUUID()
  const part = join(STAGE_DIR, '_parts', upload)
  await mkdir(join(STAGE_DIR, '_parts'), { recursive: true })
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
