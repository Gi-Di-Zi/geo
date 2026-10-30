import type { RegionQuery } from './types.ts'

export interface AdministrativeRegion {
  code: string
  name: string
  fullName: string
  parentCode: string | null
  level: 'sido' | 'sigungu' | 'eupmyeondong'
  status: 'active' | 'retired'
  createdAt: string | null
  retiredAt: string | null
}
export interface AdministrativeRelation {
  legalCode: string
  administrativeCode: string
  legalName: string
  verified: boolean
  createdAt: string | null
  retiredAt: string | null
}
export interface AdministrativeSnapshot {
  version: string
  available: boolean
  source: string
  sourceUrl: string
  sourceDate: string | null
  publishedAt: string | null
  checkedAt: string | null
  coverage: 'national' | 'fixture' | 'none'
  codeSystem: 'mois_administrative_region'
  codeLength: 10
  regions: AdministrativeRegion[]
  relations: AdministrativeRelation[]
  warning?: string
}
function descendants(code: string, parent: string, regions: Map<string, AdministrativeRegion>) {
  const seen = new Set<string>()
  let region = regions.get(code)
  while (region?.parentCode && !seen.has(region.code)) {
    if (region.parentCode === parent) return true
    seen.add(region.code); region = regions.get(region.parentCode)
  }
  return false
}
export function lookupAdministrative(query: RegionQuery | string, snapshot: AdministrativeSnapshot) {
  const q = typeof query === 'string' ? { query } : query, name = (q.query || '').trim()
  const byCode = new Map(snapshot.regions.map(region => [region.code, region]))
  const rows = snapshot.regions.filter(region => (!q.includeRetired ? region.status === 'active' : true)
    && (!name || region.code === name || region.fullName.includes(name))
    && (!q.parentCode || (q.descendants ? descendants(region.code, q.parentCode, byCode) : region.parentCode === q.parentCode)))
  const limit = Math.max(1, Math.min(1000, q.limit || 100))
  return { version: snapshot.version, available: snapshot.available, rows: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit }
}
const indexes = new WeakMap<AdministrativeSnapshot, { legal: Map<string, AdministrativeRegion[]>; administrative: Map<string, AdministrativeRelation[]> }>()
function relationIndexes(snapshot: AdministrativeSnapshot) {
  let index = indexes.get(snapshot)
  if (index) return index
  index = { legal: new Map(), administrative: new Map() }
  const regions = new Map(snapshot.regions.map(region => [region.code, region]))
  for (const relation of snapshot.relations) {
    if (relation.retiredAt || !relation.verified) continue
    const region = regions.get(relation.administrativeCode)
    if (!region || region.status !== 'active') continue
    const legal = index.legal.get(relation.legalCode) || []
    if (!legal.some(item => item.code === region.code)) legal.push(region)
    index.legal.set(relation.legalCode, legal)
    const administrative = index.administrative.get(region.code) || []
    administrative.push(relation); index.administrative.set(region.code, administrative)
  }
  indexes.set(snapshot, index)
  return index
}
/** 기관코드·통계청 코드·법정코드의 동일 접두어를 관계로 추정하지 않는다. */
export function administrativeForLegal(legalCode: string, snapshot: AdministrativeSnapshot): AdministrativeRegion[] {
  return relationIndexes(snapshot).legal.get(legalCode) || []
}
export function legalForAdministrative(administrativeCode: string, snapshot: AdministrativeSnapshot): AdministrativeRelation[] {
  return relationIndexes(snapshot).administrative.get(administrativeCode) || []
}
