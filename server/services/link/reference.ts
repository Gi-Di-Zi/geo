import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import type { LinkRegion, ReferenceSnapshot, RegionLevel } from '../../../shared/link/types.ts'
import { referenceMetadata } from '../../../shared/link/core.ts'

export const REFERENCE_SOURCE_URL = 'https://www.code.go.kr/stdcode/regCodeL.do'
const DOWNLOAD_URL = 'https://www.code.go.kr/etc/codeFullDown.do'
const MAX_BYTES = 10 * 1024 ** 2
const rootDir = () => resolve(process.env.LINK_REFERENCE_DIR || '.data/reference/link')
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const unavailable = (warning = '법정구역 사전 미설정. npm run link:reference -- --check로 공식 자료를 수집하세요.'): ReferenceSnapshot => ({
  version: 'unavailable', available: false, source: '행정안전부 행정표준코드관리시스템', sourceUrl: REFERENCE_SOURCE_URL,
  sourceDate: null, checkedAt: null, activatedAt: null, coverage: 'none', regions: [], warning,
})

/** 다운로드 파일의 전체명 경로를 부모 관계로 읽는다. 코드 접두어만으로 시·일반구 관계를 만들지 않는다. */
export function parseReferenceText(text: string): LinkRegion[] {
  const lines = text.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/)
  if (lines.shift() !== '법정동코드\t법정동명\t폐지여부') throw new Error('법정동 원문 필수 열이 다릅니다.')
  const codes = new Set<string>(), names = new Map<string, LinkRegion[]>()
  const regions = lines.map((line, i): LinkRegion => {
    const fields = line.split('\t'), code = fields[0] ?? '', fullName = (fields[1] ?? '').replace(/\s+/g, ' ').trim(), state = fields[2]
    if (fields.length !== 3 || !/^\d{10}$/.test(code) || !fullName || !['존재', '폐지'].includes(state ?? '') || codes.has(code)) throw new Error(`법정동 원문 ${i + 2}행 형식·중복 오류`)
    codes.add(code)
    const words = fullName.split(' '), name = words.at(-1)!
    const level: RegionLevel = words.length === 1 ? 'sido' : code.slice(5) === '00000' ? 'sigungu' : code.slice(8) === '00' ? 'eupmyeondong' : 'ri'
    const region: LinkRegion = { code, name, fullName, parentCode: null, level, status: state === '존재' ? 'active' : 'retired' }
    const sameName = names.get(fullName) ?? []; sameName.push(region); names.set(fullName, sameName)
    return region
  })
  const commonPrefix = (a: string, b: string) => { let n = 0; while (n < a.length && a[n] === b[n]) n++; return n }
  for (const region of regions) {
    const words = region.fullName.split(' ')
    if (words.length === 1) continue
    const possible = names.get(words.slice(0, -1).join(' ')) ?? []
    const sameState = possible.filter(r => r.status === region.status)
    const parent = (sameState.length ? sameState : possible).sort((a, b) => commonPrefix(region.code, b.code) - commonPrefix(region.code, a.code) || a.code.localeCompare(b.code))[0]
    if (!parent) throw new Error(`등록된 상위 지역이 없습니다: ${region.code}`)
    region.parentCode = parent.code
  }
  validateRegions(regions)
  return regions
}

export function validateRegions(regions: LinkRegion[]) {
  const byCode = new Map(regions.map(r => [r.code, r]))
  if (byCode.size !== regions.length || !regions.length) throw new Error('비어 있거나 중복된 기준 자료입니다.')
  for (const region of regions) {
    if (!/^\d{10}$/.test(region.code) || !region.name || !region.fullName || !['sido', 'sigungu', 'eupmyeondong', 'ri'].includes(region.level) || !['active', 'retired'].includes(region.status)) throw new Error('정규화 기준 자료의 필드가 잘못되었습니다.')
    const seen = new Set<string>([region.code])
    let next = region.parentCode
    while (next) {
      if (seen.has(next) || !byCode.has(next)) throw new Error(`상위 관계가 없거나 순환합니다: ${region.code}`)
      seen.add(next); next = byCode.get(next)!.parentCode
    }
    if (region.level !== 'sido' && !region.parentCode) throw new Error(`하위 지역에 부모가 없습니다: ${region.code}`)
  }
}

/** 공식 단일 TXT ZIP만 메모리에서 읽는다. 경로에 파일을 풀지 않는다. */
export function decodeOfficialZip(data: Buffer) {
  if (data.length < 30 || data.length > MAX_BYTES || data.readUInt32LE(0) !== 0x04034b50) throw new Error('공식 다운로드 ZIP 형식·크기 오류')
  const flags = data.readUInt16LE(6), method = data.readUInt16LE(8), compressed = data.readUInt32LE(18), size = data.readUInt32LE(22)
  const nameLength = data.readUInt16LE(26), extraLength = data.readUInt16LE(28), start = 30 + nameLength + extraLength
  if (flags & 9 || method !== 8 || size > MAX_BYTES || !size || start + compressed > data.length) throw new Error('지원하지 않는 공식 ZIP 구조입니다.')
  const raw = inflateRawSync(data.subarray(start, start + compressed), { maxOutputLength: MAX_BYTES })
  if (raw.length !== size || crc32(raw) !== data.readUInt32LE(14)) throw new Error('공식 다운로드 압축·체크섬 검증 실패')
  const dosDate = data.readUInt16LE(12)
  const fileDate = `${1980 + (dosDate >> 9)}-${String((dosDate >> 5) & 15).padStart(2, '0')}-${String(dosDate & 31).padStart(2, '0')}`
  return { text: new TextDecoder('euc-kr', { fatal: true }).decode(raw), fileDate }
}

let cached: { root: string; version: string; snapshot: ReferenceSnapshot } | undefined
export async function getReference(): Promise<ReferenceSnapshot> {
  const root = rootDir()
  const activations: string[] = []
  const checkedByVersion = new Map<string, string>()
  try {
    const current = JSON.parse(await readFile(join(root, 'active.json'), 'utf8'))
    if (/^code-go-kr-[a-f0-9]{16}$/.test(current.version)) {
      const lastCheckedAt = typeof current.checkedAt === 'string' ? current.checkedAt : undefined
      if (lastCheckedAt) checkedByVersion.set(current.version, lastCheckedAt)
      if (cached?.root === root && cached.version === current.version) {
        if (lastCheckedAt && cached.snapshot.checkedAt !== lastCheckedAt) cached = { ...cached, snapshot: { ...cached.snapshot, checkedAt: lastCheckedAt } }
        return cached.snapshot
      }
      activations.push(current.version)
    }
  } catch {}
  // shortcut: 이동·리네임 금지 합의로 포인터 갱신 중단 시 append-only 활성화 이력에서 마지막 정상본을 복구한다.
  try {
    const entries = (await readdir(join(root, 'activations'))).filter(n => /^\d+-[a-f0-9-]+\.json$/.test(n)).sort().reverse()
    for (const entry of entries) { try {
      const value = JSON.parse(await readFile(join(root, 'activations', entry), 'utf8'))
      if (/^code-go-kr-[a-f0-9]{16}$/.test(value.version)) {
        activations.push(value.version)
        if (!checkedByVersion.has(value.version) && typeof value.checkedAt === 'string') checkedByVersion.set(value.version, value.checkedAt)
      }
    } catch {} }
  } catch {}
  for (const version of new Set(activations)) {
    if (cached?.root === root && cached.version === version) {
      const checkedAt = checkedByVersion.get(version)
      if (checkedAt && checkedAt !== cached.snapshot.checkedAt) cached = { ...cached, snapshot: { ...cached.snapshot, checkedAt } }
      return cached.snapshot
    }
    try {
      const snapshot: ReferenceSnapshot = JSON.parse(await readFile(join(root, 'versions', version, 'snapshot.json'), 'utf8'))
      const manifest = JSON.parse(await readFile(join(root, 'versions', version, 'manifest.json'), 'utf8'))
      if (snapshot.version !== version || manifest.normalizedSha256 !== sha(JSON.stringify(snapshot)) || !snapshot.available || snapshot.coverage !== 'national') continue
      validateRegions(snapshot.regions)
      const checkedAt = checkedByVersion.get(version)
      const currentSnapshot = checkedAt ? { ...snapshot, checkedAt } : snapshot
      cached = { root, version, snapshot: currentSnapshot }; return currentSnapshot
    } catch {}
  }
  return unavailable()
}
export async function referenceInfo() { const info = referenceMetadata(await getReference()); return { ...info, ingestedAt: info.activatedAt } }

export async function activateReference(text: string, metadata: { checkedAt?: string; sourceFileDate?: string; rawZip?: Buffer } = {}) {
  const root = rootDir(), regions = parseReferenceText(text), active = regions.filter(r => r.status === 'active')
  if (regions.length < 10_000 || active.length < 10_000 || new Set(active.filter(r => r.level === 'sido').map(r => r.code.slice(0, 2))).size < 10) throw new Error('전국 사전으로 활성화할 수 없는 불완전 자료입니다.')
  const previous = await getReference()
  if (previous.available && active.length < previous.regions.filter(r => r.status === 'active').length * 0.9) throw new Error('현존 코드가 10% 이상 감소하여 자동 활성화를 중단했습니다.')
  const checksum = sha(text), version = `code-go-kr-${checksum.slice(0, 16)}`, checkedAt = metadata.checkedAt ?? new Date().toISOString()
  const dir = join(root, 'versions', version)
  await mkdir(dir, { recursive: true }); await mkdir(join(root, 'activations'), { recursive: true })
  let snapshot: ReferenceSnapshot = { version, available: true, source: '행정안전부 행정표준코드관리시스템 법정동 전체자료', sourceUrl: REFERENCE_SOURCE_URL,
    sourceDate: null, checkedAt, activatedAt: new Date().toISOString(), coverage: 'national', regions,
    warning: `개별 코드 유효일·자료 기준일은 원천 파일에 없습니다. ZIP 파일 수정일: ${metadata.sourceFileDate ?? '미제공'} (유효일 아님). 명칭 경로로 상위 관계를 구성했습니다. 필지 존재는 확인하지 않습니다.`,
  }
  let committed: { checksum: string; normalizedSha256: string } | undefined, partialManifest = false
  try { committed = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      const entries = await readdir(join(root, 'activations')).catch(() => [])
      for (const entry of entries) {
        const value = await readFile(join(root, 'activations', entry), 'utf8').then(s => { try { return JSON.parse(s) } catch { return null } }).catch(() => null)
        if (value?.version === version) throw new Error('기존 버전 manifest 검증 실패')
      }
      partialManifest = true
    }
  }
  if (committed) {
    snapshot = JSON.parse(await readFile(join(dir, 'snapshot.json'), 'utf8'))
    if (committed.checksum !== checksum || committed.normalizedSha256 !== sha(JSON.stringify(snapshot)) || snapshot.version !== version) throw new Error('기존 동일 버전 파일 검증 실패')
    validateRegions(snapshot.regions)
    const history = await readdir(join(root, 'activations'))
    let published = previous.version === version
    for (const entry of history) {
      try { if (JSON.parse(await readFile(join(root, 'activations', entry), 'utf8')).version === version) published = true } catch {}
    }
    if (published && previous.available) {
      // 같은 원문을 다시 반영하거나 과거 버전으로 되돌리지 않는다. 확인 시각만 갱신한다.
      const current = { ...previous, checkedAt }
      await writeFile(join(root, 'active.json'), JSON.stringify({ version: current.version, checkedAt, activatedAt: current.activatedAt }))
      cached = { root, version: current.version, snapshot: current }
      return { state: 'no_change', ...referenceMetadata(current), checkedAt, comparedVersion: version }
    }
  } else {
    // manifest가 없는 미공개 쓰기 중단본만 재작성한다. 검증·공개된 버전은 덮어쓰지 않는다.
    await writeFile(join(dir, 'snapshot.json'), JSON.stringify(snapshot))
    await writeFile(join(dir, 'source.txt'), text)
    if (metadata.rawZip) await writeFile(join(dir, 'source.zip'), metadata.rawZip)
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ sourceId: 'code-go-kr-legal', version, sourceUrl: REFERENCE_SOURCE_URL, downloadUrl: DOWNLOAD_URL,
      auth: '전체자료 공개 다운로드는 키 없음; data.go.kr API는 별도 활용신청·서비스키 필요', license: '공공데이터포털 연결 카탈로그: 이용허락범위 제한 없음. 제공처 표기.', licenseUrl: 'https://www.data.go.kr/catalog/15077871/openapi.json',
      sourceAsOf: null, sourceFileDate: metadata.sourceFileDate ?? null, checkedAt, ingestedAt: snapshot.activatedAt, effectiveFrom: null,
      rows: regions.length, active: active.length, retired: regions.length - active.length, checksum, normalizedSha256: sha(JSON.stringify(snapshot)),
      parentMethod: '원문 전체명 경로의 등록 상위 구역; 동일명은 상태·코드 공통부분으로 대응', validated: ['필수열', '전체코드문자열', '중복', '부모등록', '순환', '전국범위', '현존코드감소량'],
    }, null, 2), { flag: partialManifest ? 'w' : 'wx' })
  }
  const activation = { version, checkedAt, activatedAt: snapshot.activatedAt }
  await writeFile(join(root, 'activations', `${Date.now()}-${randomUUID()}.json`), JSON.stringify(activation), { flag: 'wx' })
  await writeFile(join(root, 'active.json'), JSON.stringify(activation))
  cached = { root, version, snapshot }
  return { state: previous.version === version ? 'no_change' : 'updated', ...referenceMetadata(snapshot), checkedAt }
}

let refreshing: Promise<unknown> | undefined
export function refreshReference(force = false): Promise<unknown> {
  if (refreshing) return refreshing
  refreshing = refresh(force).finally(() => { refreshing = undefined })
  return refreshing
}
async function refresh(force: boolean) {
  const root = rootDir(), checkedAt = new Date().toISOString(), date = new Date(Date.parse(checkedAt) + 9 * 3600_000).toISOString().slice(0, 10)
  await mkdir(join(root, 'checks'), { recursive: true })
  const history = join(root, 'checks', `${date}${force ? `-${Date.now()}-${randomUUID()}` : ''}.json`)
  try { await writeFile(history, JSON.stringify({ state: 'checking', checkedAt, pid: process.pid, leaseUntil: new Date(Date.now() + 5 * 60_000).toISOString() }), { flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const prior = await readFile(history, 'utf8').then(text => { try { return JSON.parse(text) } catch { return { state: 'checking' } } })
    if (prior.state === 'checking') {
      let alive = false
      if (Number.isSafeInteger(prior.pid) && prior.pid > 0) { try { process.kill(prior.pid, 0); alive = true } catch (error) { alive = (error as NodeJS.ErrnoException).code === 'EPERM' } }
      if (alive && Date.parse(prior.leaseUntil) > Date.now()) return { state: 'checking', checkedAt: prior.checkedAt, reference: await referenceInfo() }
      const interrupted = { state: 'failed', checkedAt: prior.checkedAt || checkedAt, finishedAt: checkedAt, code: 'CHECK_INTERRUPTED', message: '이전 기준자료 확인이 중단되었습니다. 잠시 후 다시 확인하세요.', previousVersion: (await getReference()).version }
      await writeFile(history, JSON.stringify(interrupted)); return interrupted
    }
    return { state: prior.state === 'failed' ? 'failed' : 'already_checked', checkedAt: prior.checkedAt || checkedAt, ...(prior.state === 'failed' && { code: prior.code, message: prior.message }), reference: await referenceInfo() }
  }
  const current = await referenceInfo()
  if (!force && current.available && current.activatedAt && new Date(Date.parse(current.activatedAt) + 9 * 3600_000).toISOString().slice(0, 10) === date) {
    const result = { state: 'already_checked', checkedAt, reference: current }
    await writeFile(history, JSON.stringify(result)); return result
  }
  try {
    const res = await fetch(DOWNLOAD_URL, { method: 'POST', body: new URLSearchParams({ codeseId: '법정동코드' }), redirect: 'error', signal: AbortSignal.timeout(60_000) })
    if (!res.ok || !res.body) throw new Error(`공식 다운로드 HTTP ${res.status}`)
    if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) { await res.body.cancel(); throw new Error('공식 다운로드 크기 제한 초과') }
    const parts: Uint8Array[] = []; let bytes = 0
    for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) { bytes += part.length; if (bytes > MAX_BYTES) throw new Error('공식 다운로드 크기 제한 초과'); parts.push(part) }
    const data = Buffer.concat(parts), decoded = decodeOfficialZip(data)
    const result = await activateReference(decoded.text, { checkedAt, sourceFileDate: decoded.fileDate, rawZip: data })
    await writeFile(history, JSON.stringify(result, null, 2)); return result
  } catch (error) {
    const result = { state: 'failed', checkedAt, message: (error as Error).message, previousVersion: (await getReference()).version }
    await writeFile(history, JSON.stringify(result, null, 2)); throw new Error(`기준자료 확인 실패(이전 정상본 유지): ${result.message}`)
  }
}
