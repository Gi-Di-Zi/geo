import { createHash, randomUUID } from 'node:crypto'
import { linkData } from './data-dir.ts'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import ExcelJS from 'exceljs-community'
import type { AdministrativeRegion, AdministrativeRelation, AdministrativeSnapshot } from '../../../shared/link/administrative.ts'
import { checkXlsxZip } from './files.ts'

const BASE = 'https://www.mois.go.kr'
export const ADMINISTRATIVE_LIST_URL = BASE + '/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000052&searchCnd=0&searchWrd=' + encodeURIComponent('행정기관')
const MAX_BYTES = 10 * 1024 ** 2, MAX_EXPANDED = 40 * 1024 ** 2
const rootDir = () => resolve(process.env.LINK_ADMINISTRATIVE_DIR || linkData('reference/link/administrative'))
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const unavailable = (): AdministrativeSnapshot => ({ version: 'administrative-unavailable', available: false, source: '행정안전부 주민등록 행정기관 및 관할구역 현황', sourceUrl: ADMINISTRATIVE_LIST_URL,
  sourceDate: null, publishedAt: null, checkedAt: null, coverage: 'none', codeSystem: 'mois_administrative_region', codeLength: 10, regions: [], relations: [], warning: '행정동 기준 자료가 준비되지 않았습니다. npm run link:administrative로 수집하세요.' })
const versionPattern = /^mois-admin-\d{8}-[a-f0-9]{16}$/

/** 공식 ZIP의 필요한 XLSX만 메모리로 읽으며 경로에 압축을 풀지 않는다. */
export function administrativeZipEntries(data: Buffer) {
  if (data.length < 22 || data.length > MAX_BYTES) throw new Error('행정동 ZIP 크기 오류')
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (data.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('행정동 ZIP 구조 오류')
  const count = data.readUInt16LE(end + 10)
  if (!count || count > 50) throw new Error('행정동 ZIP 항목 수 오류')
  let offset = data.readUInt32LE(end + 16), total = 0
  const result = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) throw new Error('행정동 ZIP 디렉터리 오류')
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10), compressed = data.readUInt32LE(offset + 20), expanded = data.readUInt32LE(offset + 24)
    const nameSize = data.readUInt16LE(offset + 28), extraSize = data.readUInt16LE(offset + 30), commentSize = data.readUInt16LE(offset + 32), local = data.readUInt32LE(offset + 42)
    const name = new TextDecoder('euc-kr', { fatal: true }).decode(data.subarray(offset + 46, offset + 46 + nameSize))
    if (flags & 1 || ![0, 8].includes(method) || /(^|[\\/])\.\.([\\/]|$)|^[\\/]/.test(name) || local + 30 > offset || data.readUInt32LE(local) !== 0x04034b50) throw new Error('지원하지 않는 행정동 ZIP 항목')
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
    if (data.readUInt16LE(local + 8) !== method || !data.subarray(local + 30, local + 30 + data.readUInt16LE(local + 26)).equals(data.subarray(offset + 46, offset + 46 + nameSize))) throw new Error('행정동 ZIP 로컬 항목 불일치')
    if (start + compressed > offset || (total += expanded) > MAX_EXPANDED || expanded === 0xffffffff) throw new Error('행정동 ZIP 압축 크기 오류')
    if (/\/(?:KIKcd_[BH]|KIKmix)\.\d{8}\.xlsx$/i.test(name)) {
      const input = data.subarray(start, start + compressed), output = method === 8 ? inflateRawSync(input, { maxOutputLength: MAX_EXPANDED }) : input
      if (output.length !== expanded || crc32(output) !== data.readUInt32LE(offset + 16)) throw new Error('행정동 ZIP 체크섬 오류')
      if (result.has(name)) throw new Error('행정동 ZIP 중복 파일')
      result.set(name, output)
    }
    offset += 46 + nameSize + extraSize + commentSize
  }
  if (result.size !== 3) throw new Error('행정동·법정동·관할관계 XLSX가 모두 필요합니다.')
  return result
}
async function records(data: Buffer, headers: string[]) {
  checkXlsxZip(data)
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(data as never)
  const sheet = workbook.worksheets[0]
  if (!sheet || workbook.worksheets.length !== 1 || sheet.rowCount > 50_000 || sheet.columnCount !== headers.length || headers.some((header, i) => sheet.getCell(1, i + 1).text !== header)) throw new Error('행정동 원문 필수 열·행 수 오류')
  const result: string[][] = []
  for (let r = 2; r <= sheet.rowCount; r++) {
    const values: string[] = []
    for (let c = 1; c <= headers.length; c++) {
      const value = sheet.getCell(r, c).value
      if (value !== null && typeof value !== 'string') throw new Error('행정동 원문은 문자형 셀만 허용합니다.')
      values.push((value || '').trim())
    }
    result.push(values)
  }
  return result
}
const date = (value: string) => { if (value && !/^\d{8}$/.test(value)) throw new Error('행정동 원문 날짜 오류'); return value ? value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6) : null }
const code = (value: string) => { if (!/^\d{10}$/.test(value)) throw new Error('행안부 행정동·법정동 코드는 10자리 문자형이어야 합니다.'); return value }
export async function parseAdministrativeZip(data: Buffer) {
  const entries = administrativeZipEntries(data), find = (kind: string) => [...entries].find(([name]) => name.toLowerCase().includes('/' + kind.toLowerCase() + '.'))!
  const h = find('KIKcd_H'), b = find('KIKcd_B'), mix = find('KIKmix')
  const sourceDate = /\.(\d{8})\.xlsx$/i.exec(h[0])![1]!
  if (![b, mix].every(([name]) => name.endsWith('.' + sourceDate + '.xlsx'))) throw new Error('서로 다른 기준일의 행정동 원문입니다.')
  const hRows = await records(h[1], ['행정동코드', '시도명', '시군구명', '읍면동명', '생성일자', '말소일자'])
  const bRows = await records(b[1], ['법정동코드', '시도명', '시군구명', '읍면동명', '동리명', '생성일자', '말소일자'])
  const mixRows = await records(mix[1], ['행정동코드', '시도명', '시군구명', '읍면동명', '법정동코드', '동리명', '생성일자', '말소일자'])
  const legalNames = new Map(bRows.map(row => [code(row[0]!), row.slice(1, 5).filter(Boolean).join(' ')]))
  const regions: AdministrativeRegion[] = hRows.map(row => ({ code: code(row[0]!), fullName: row.slice(1, 4).filter(Boolean).join(' '), name: row.slice(1, 4).filter(Boolean).at(-1)!,
    parentCode: null, level: row[0]!.slice(2) === '00000000' ? 'sido' : row[0]!.slice(5) === '00000' ? 'sigungu' : 'eupmyeondong', status: row[5] ? 'retired' : 'active', createdAt: date(row[4]!), retiredAt: date(row[5]!) }))
  const byCode = new Map(regions.map(region => [region.code, region])), byName = new Map<string, AdministrativeRegion[]>()
  for (const region of regions) byName.set(region.fullName, [...(byName.get(region.fullName) || []), region])
  for (const region of regions) {
    if (region.level === 'sido') continue
    const parentName = region.fullName.split(' ').slice(0, -1).join(' '), expected = region.level === 'sigungu' ? region.code.slice(0, 2) + '00000000' : region.code.slice(0, 5) + '00000'
    const named = (byName.get(parentName) || []).filter(parent => parent.code !== region.code)
    const parent = named.find(parent => parent.code === expected) || named[0] || byCode.get(expected)
    if (!parent) throw new Error('행정동 상위 지역이 없습니다.')
    region.parentCode = parent.code
  }
  const relations: AdministrativeRelation[] = mixRows.map(row => {
    const legalName = legalNames.get(row[4]!) || ''
    if (!legalName && (row[0] !== row[4] || row[5])) throw new Error('행정동 관할 관계의 법정 코드가 등록되지 않았습니다.')
    return { administrativeCode: code(row[0]!), legalCode: code(row[4]!), legalName, verified: !!legalName, createdAt: date(row[6]!), retiredAt: date(row[7]!) }
  })
  validateAdministrative(regions, relations)
  return { regions, relations, sourceDate: date(sourceDate)! }
}
export function validateAdministrative(regions: AdministrativeRegion[], relations: AdministrativeRelation[]) {
  const byCode = new Map(regions.map(region => [region.code, region])), pairs = new Set<string>()
  if (!regions.length || byCode.size !== regions.length || !relations.length) throw new Error('행정동 자료가 비었거나 코드가 중복됩니다.')
  for (const region of regions) {
    code(region.code); if (!region.name || !region.fullName) throw new Error('행정동 명칭이 없습니다.')
    const seen = new Set<string>([region.code]); let parent = region.parentCode
    while (parent) { if (seen.has(parent) || !byCode.has(parent)) throw new Error('행정동 상위 관계가 없거나 순환합니다.'); seen.add(parent); parent = byCode.get(parent)!.parentCode }
  }
  for (const relation of relations) {
    const pair = code(relation.administrativeCode) + ':' + code(relation.legalCode)
    if (pairs.has(pair) || !byCode.has(relation.administrativeCode) || (relation.verified && !relation.legalName) || (!relation.verified && (relation.legalCode !== relation.administrativeCode || relation.legalName))) throw new Error('행정동 관할 관계의 중복·미등록 코드 오류')
    pairs.add(pair)
  }
}
let cached: { root: string; snapshot: AdministrativeSnapshot } | undefined
export async function getAdministrativeReference(): Promise<AdministrativeSnapshot> {
  const root = rootDir(), versions: string[] = []
  const checked = new Map<string, string>()
  try { const pointer = JSON.parse(await readFile(join(root, 'active.json'), 'utf8')); if (versionPattern.test(pointer.version)) { versions.push(pointer.version); if (typeof pointer.checkedAt === 'string') checked.set(pointer.version, pointer.checkedAt) } } catch {}
  const history = (await readdir(join(root, 'activations')).catch(() => [])).sort().reverse()
  for (const entry of history) { try { const pointer = JSON.parse(await readFile(join(root, 'activations', entry), 'utf8')); if (versionPattern.test(pointer.version)) { versions.push(pointer.version); if (!checked.has(pointer.version) && typeof pointer.checkedAt === 'string') checked.set(pointer.version, pointer.checkedAt) } } catch {} }
  for (const version of new Set(versions)) {
    if (cached?.root === root && cached.snapshot.version === version) {
      if (checked.has(version) && cached.snapshot.checkedAt !== checked.get(version)) cached = { root, snapshot: { ...cached.snapshot, checkedAt: checked.get(version)! } }
      return cached.snapshot
    }
    try {
      const snapshot: AdministrativeSnapshot = JSON.parse(await readFile(join(root, 'versions', version, 'snapshot.json'), 'utf8'))
      const manifest = JSON.parse(await readFile(join(root, 'versions', version, 'manifest.json'), 'utf8'))
      if (snapshot.version !== version || manifest.normalizedSha256 !== hash(JSON.stringify(snapshot)) || !snapshot.available || snapshot.codeSystem !== 'mois_administrative_region') continue
      validateAdministrative(snapshot.regions, snapshot.relations); const current = checked.has(version) ? { ...snapshot, checkedAt: checked.get(version)! } : snapshot; cached = { root, snapshot: current }; return current
    } catch {}
  }
  return unavailable()
}
export async function administrativeInfo() {
  const { regions, relations, ...info } = await getAdministrativeReference(), root = rootDir()
  let activatedAt: string | null = null, ingestedAt: string | null = null
  if (info.available) {
    try {
      const manifest = JSON.parse(await readFile(join(root, 'versions', info.version, 'manifest.json'), 'utf8'))
      ingestedAt = manifest.ingestedAt || null; activatedAt = manifest.activatedAt || ingestedAt
    } catch {}
    if (!activatedAt) for (const entry of (await readdir(join(root, 'activations')).catch(() => [])).sort()) {
      try {
        const pointer = JSON.parse(await readFile(join(root, 'activations', entry), 'utf8'))
        if (pointer.version !== info.version) continue
        const stamp = Number(entry.split('-')[0]); activatedAt = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp).toISOString() : pointer.checkedAt || null
        break
      } catch {}
    }
  }
  return { ...info, activatedAt, ingestedAt, count: regions.length, relationCount: relations.length }
}
export async function activateAdministrativeReference(data: Buffer, meta: { sourceUrl: string; publishedAt?: string | null; checkedAt?: string } ) {
  const root = rootDir(), parsed = await parseAdministrativeZip(data), previous = await getAdministrativeReference()
  if (parsed.regions.length < 2500 || parsed.relations.length < 15_000 || (previous.available && parsed.regions.length < previous.regions.length * .9)) throw new Error('전국 행정동 자료가 불완전하거나 코드 수가 급감했습니다.')
  const checksum = hash(data), version = 'mois-admin-' + parsed.sourceDate.replaceAll('-', '') + '-' + hash('administrative-normalization-2:' + checksum).slice(0, 16), folder = join(root, 'versions', version)
  let snapshot: AdministrativeSnapshot = { version, available: true, source: '행정안전부 주민등록 행정기관 및 관할구역 현황', sourceUrl: meta.sourceUrl, sourceDate: parsed.sourceDate, publishedAt: meta.publishedAt || null,
    checkedAt: meta.checkedAt || new Date().toISOString(), coverage: 'national', codeSystem: 'mois_administrative_region', codeLength: 10, ...parsed,
    warning: '행안부 주민등록용 10자리 행정동코드입니다. 기관코드·통계청 코드는 별개입니다. 관할 관계만으로 개별 필지의 행정동을 확정하지 않습니다. 법정 사전에 없는 원문 자기참조 관계 ' + parsed.relations.filter(relation => !relation.verified).length + '개는 보존하되 변환에 사용하지 않습니다.' }
  await mkdir(folder, { recursive: true }); await mkdir(join(root, 'activations'), { recursive: true })
  const manifestPath = join(folder, 'manifest.json')
  const committed = await readFile(manifestPath, 'utf8').then(text => JSON.parse(text)).catch(() => null)
  if (committed) {
    snapshot = JSON.parse(await readFile(join(folder, 'snapshot.json'), 'utf8'))
    if (committed.checksum !== checksum || committed.normalizedSha256 !== hash(JSON.stringify(snapshot))) throw new Error('기존 행정동 버전의 체크섬 오류')
    let published = previous.version === version
    for (const entry of await readdir(join(root, 'activations'))) {
      try { if (JSON.parse(await readFile(join(root, 'activations', entry), 'utf8')).version === version) published = true } catch {}
    }
    if (published && previous.available) {
      const checkedAt = meta.checkedAt || new Date().toISOString()
      await writeFile(join(root, 'active.json'), JSON.stringify({ version: previous.version, checkedAt }))
      cached = { root, snapshot: { ...previous, checkedAt } }
      return { state: 'no_change', ...await administrativeInfo(), comparedVersion: version }
    }
  } else {
    for (const entry of await readdir(join(root, 'activations'))) { const old = JSON.parse(await readFile(join(root, 'activations', entry), 'utf8')); if (old.version === version) throw new Error('공개된 행정동 버전 손상. 기존 정상 버전을 유지합니다.') }
    await writeFile(join(folder, 'source.zip'), data); await writeFile(join(folder, 'snapshot.json'), JSON.stringify(snapshot))
    const ingestedAt = new Date().toISOString()
    await writeFile(manifestPath, JSON.stringify({ version, checksum, normalizedSha256: hash(JSON.stringify(snapshot)), sourceUrl: meta.sourceUrl, sourceDate: snapshot.sourceDate, publishedAt: snapshot.publishedAt, ingestedAt, activatedAt: ingestedAt,
      checkedAt: snapshot.checkedAt, license: '행정안전부 공개 게시물의 첨부자료. 제공처·기준일 표기. 기관의 공개 이용조건 확인 필요.', regions: snapshot.regions.length, relations: snapshot.relations.length,
      ruleVersion: 'administrative-normalization-2', method: 'KiKcd_H와KiKmix의10자리문자열정확관계.법정명칭은동일배포KiKcd_B.부모는전체명경로우선,중복명·출장소는등록상위코드검증.' }, null, 2))
  }
  const pointer = { version, checkedAt: meta.checkedAt || new Date().toISOString() }
  await writeFile(join(root, 'activations', Date.now() + '-' + randomUUID() + '.json'), JSON.stringify(pointer), { flag: 'wx' })
  await writeFile(join(root, 'active.json'), JSON.stringify(pointer)); cached = { root, snapshot: { ...snapshot, checkedAt: pointer.checkedAt } }
  return { state: previous.version === version ? 'no_change' : 'updated', ...await administrativeInfo() }
}
async function getLimited(url: string) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
  if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('행정동 공식 자료 응답 오류')
  const chunks: Uint8Array[] = []; let bytes = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { bytes += chunk.length; if (bytes > MAX_BYTES) throw new Error('행정동 공식 자료 크기 초과'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
let pending: Promise<unknown> | undefined
export function refreshAdministrativeReference(force = false): Promise<unknown> {
  return pending ||= refresh(force).finally(() => { pending = undefined })
}
async function refresh(force: boolean) {
  const root = rootDir(), checkedAt = new Date().toISOString(), day = new Date(Date.parse(checkedAt) + 9 * 3600_000).toISOString().slice(0, 10)
  await mkdir(join(root, 'checks'), { recursive: true })
  const history = join(root, 'checks', day + (force ? '-' + randomUUID() : '') + '.json')
  try { await writeFile(history, JSON.stringify({ state: 'checking', checkedAt, pid: process.pid, leaseUntil: new Date(Date.now() + 5 * 60_000).toISOString() }), { flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const prior = await readFile(history, 'utf8').then(text => { try { return JSON.parse(text) } catch { return { state: 'checking' } } })
    if (prior.state === 'checking') {
      let alive = false
      if (Number.isSafeInteger(prior.pid) && prior.pid > 0) { try { process.kill(prior.pid, 0); alive = true } catch (error) { alive = (error as NodeJS.ErrnoException).code === 'EPERM' } }
      if (alive && Date.parse(prior.leaseUntil) > Date.now()) return { state: 'checking', checkedAt: prior.checkedAt, ...await administrativeInfo() }
      const interrupted = { state: 'failed', checkedAt: prior.checkedAt || checkedAt, finishedAt: checkedAt, code: 'CHECK_INTERRUPTED', message: '이전 행정동 자료 확인이 중단되었습니다. 잠시 후 다시 확인하세요.', previousVersion: (await getAdministrativeReference()).version }
      await writeFile(history, JSON.stringify(interrupted)); return interrupted
    }
    return { state: prior.state === 'failed' ? 'failed' : 'already_checked', ...(prior.state === 'failed' && { code: prior.code, message: prior.message }), ...await administrativeInfo() }
  }
  const current = await administrativeInfo()
  if (!force && current.available && current.activatedAt && new Date(Date.parse(current.activatedAt) + 9 * 3600_000).toISOString().slice(0, 10) === day) {
    const result = { state: 'already_checked', ...current }; await writeFile(history, JSON.stringify(result)); return result
  }
  try {
    const listing = (await getLimited(ADMINISTRATIVE_LIST_URL)).toString('utf8')
    const items = [...listing.matchAll(/nttId=(\d+)[^>]*>([^<]*행정기관[^<]*)/g)].map(match => ({ id: match[1]!, title: match[2]! }))
    const item = items.map(value => ({ ...value, date: /\((\d{4})\.(\d{1,2})\.(\d{1,2})\./.exec(value.title) })).filter(value => value.date && [value.date[1], value.date[2]!.padStart(2, '0'), value.date[3]!.padStart(2, '0')].join('-') <= checkedAt.slice(0, 10))[0]
    if (!item) throw new Error('최신 행정동 배포 게시물을 찾지 못했습니다.')
    const sourceUrl = BASE + '/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000052&nttId=' + item.id, page = (await getLimited(sourceUrl)).toString('utf8')
    const links = [...page.matchAll(/href="(\/cmm\/fms\/FileDown.do\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    const selected = links.find(match => /jscode\d{8}\.zip/i.test(match[2]!))
    if (!selected) throw new Error('공식 행정동 전국 ZIP 링크를 찾지 못했습니다.')
    const url = new URL(selected[1]!.replaceAll('&amp;', '&'), BASE)
    if (url.origin !== BASE || url.pathname !== '/cmm/fms/FileDown.do') throw new Error('공식 행정동 다운로드 경로가 아닙니다.')
    const publication = /등록일\s*:\s*(\d{4})\.(\d{2})\.(\d{2})/.exec(page.replace(/<[^>]*>/g, ''))
    const result = await activateAdministrativeReference(await getLimited(url.href), { sourceUrl, checkedAt, publishedAt: publication ? publication.slice(1, 4).join('-') : null })
    await writeFile(history, JSON.stringify({ ...result, checkedAt })); return result
  } catch (error) {
    const result = { state: 'failed', checkedAt, message: (error as Error).message, previousVersion: (await getAdministrativeReference()).version }
    await writeFile(history, JSON.stringify(result)); throw error
  }
}
