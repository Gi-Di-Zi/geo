import { z } from 'zod'

export const linkConversionKeys = ['address', 'pnu', 'legal_region', 'administrative_region', 'location'] as const
export type LinkConversionKey = typeof linkConversionKeys[number]
export const linkOptionsSchema = z.object({
  inputType: z.enum(['auto', 'pnu', 'code', 'pnu_legal', 'administrative', 'address', 'location']).default('auto'),
  target: z.enum(['pnu', 'legal_region', 'administrative_region', 'address', 'location', 'legal_boundary', 'all']).optional(),
  sourceCrs: z.enum(['EPSG:4326', 'EPSG:3857', 'EPSG:5179', 'EPSG:5186', 'EPSG:5181']).optional(),
  outputCrs: z.enum(['EPSG:4326', 'EPSG:3857', 'EPSG:5179', 'EPSG:5186', 'EPSG:5181']).optional(),
  level: z.enum(['sido', 'sigungu', 'eupmyeondong', 'ri', 'parcel', 'pnu', 'custom']).default('pnu'),
  output: z.enum(['code', 'name', 'both', 'columns']).default('both'),
  addressStyle: z.enum(['full', 'leaf', 'columns']).default('full'),
  prefixLength: z.number().int().min(1).max(19).optional(),
  deduplicate: z.boolean().default(false),
  expandCandidates: z.boolean().default(false),
  selections: z.record(z.string(), z.string()).optional(),
  conversionSelections: z.partialRecord(z.enum(linkConversionKeys), z.record(z.string(), z.string())).optional(),
}).strict()
export type LinkOptions = z.infer<typeof linkOptionsSchema>
export const defaultOptions: LinkOptions = linkOptionsSchema.parse({})
export const inputRowSchema = z.object({ id: z.string().min(1).max(200), original: z.record(z.string(), z.string()), value: z.string().max(2000), issue: z.string().optional() }).strict()
export type InputRow = z.infer<typeof inputRowSchema>
export type RegionLevel = 'sido' | 'sigungu' | 'eupmyeondong' | 'ri'
export interface LinkRegion {
  code: string
  name: string
  fullName: string
  parentCode: string | null
  level: RegionLevel
  status: 'active' | 'retired'
  effectiveDate?: string
  retiredDate?: string
}
export interface ReferenceSnapshot {
  version: string
  available: boolean
  source: string
  sourceUrl: string
  sourceDate: string | null
  checkedAt: string | null
  activatedAt: string | null
  coverage: 'national' | 'partial' | 'fixture' | 'none'
  regions: LinkRegion[]
  warning?: string
}
export type LinkStatus = 'ok' | 'needs_selection' | 'invalid' | 'not_found' | 'unavailable'
export interface LinkError { code: string; message: string }
export interface LinkCandidate { id: string; code: string; name: string; status: 'active' | 'retired'; level: RegionLevel }
export interface LinkConversion {
  status: LinkStatus
  value: string
  errors: LinkError[]
  warnings: string[]
  candidates: LinkCandidate[]
  evidence: string[]
  code?: string
  name?: string
}
export interface PnuParts { regionCode: string; landType: '1' | '2'; mountain: boolean; main: string; sub: string; parcel: string }
export interface LinkResult {
  id: string
  inputId: string
  original: Record<string, string>
  value: string
  inputType: 'pnu' | 'code' | 'administrative' | 'address' | 'location'
  codeSystem: 'pnu' | 'legal_region' | 'administrative_region' | 'location'
  status: LinkStatus
  format: 'valid' | 'invalid' | 'not_applicable'
  code: 'active' | 'retired' | 'unknown' | 'not_checked'
  parcel: 'matched' | 'no_match_in_dataset' | 'not_checked'
  errors: LinkError[]
  warnings: string[]
  candidates: LinkCandidate[]
  candidateId?: string
  unparsed: string
  pnu: string
  regionCode: string
  address: string
  output: Record<string, string>
  evidence: string[]
  conversions?: Record<LinkConversionKey, LinkConversion>
}
export interface LinkBatch {
  schemaVersion: '1'
  ruleVersion: 'geo-link-v1'
  version: string
  reference: Omit<ReferenceSnapshot, 'regions'> & { count: number }
  options: LinkOptions
  rows: LinkResult[]
  summary: Record<LinkStatus, number> & { total: number; input: number; omittedDuplicates: number }
  errors: Record<string, number>
}
export interface RegionQuery { query?: string; parentCode?: string; descendants?: boolean; includeRetired?: boolean; limit?: number }
