import { resolveRows, referenceMetadata } from '../../../shared/link/core.ts'
import { linkConversionKeys, linkOptionsSchema } from '../../../shared/link/types.ts'
import type { InputRow, LinkBatch, LinkConversion, LinkConversionKey, LinkOptions, LinkRegion, LinkResult, ReferenceSnapshot, RegionLevel } from '../../../shared/link/types.ts'
import type { AdministrativeSnapshot } from '../../../shared/link/administrative.ts'
import { resolveAdministrativeRows } from './administrative.ts'
import { resolveLocationRows } from './location-resolve.ts'
import { forwardLocation, reverseLocation } from './location.ts'
import { LinkServiceError } from './files.ts'

function conversion(key: LinkConversionKey, row: LinkResult): LinkConversion {
  const result: LinkConversion = { status: row.status, value: '', errors: [...row.errors], warnings: [...row.warnings], candidates: [...row.candidates], evidence: [...row.evidence] }
  if (row.status !== 'ok') return result
  if (key === 'pnu' && !row.pnu) return { ...result, status: 'unavailable', errors: [{ code: 'PARCEL_REQUIRED', message: '지역코드만으로 토지의 지번과 전체 PNU를 만들 수 없습니다.' }] }
  if (key === 'address') result.value = result.name = row.output.name || row.address
  else if (key === 'pnu') result.value = result.code = row.pnu
  else if (key === 'location') result.value = result.code = row.output.code || ''
  else {
    result.code = key === 'legal_region' ? row.output.registered_code || row.regionCode : row.output.code || row.output.registered_code
    result.name = row.output.name || (key === 'legal_region' ? row.address : '')
    result.value = [result.code, result.name].filter(Boolean).join(' · ')
  }
  return result
}

/** 각 변환의 확인·실패를 보존하고 SHP 원천은 다운로드를 요청할 때만 조회한다. */
export async function resolveAllRows(inputs: InputRow[], provided: Partial<LinkOptions>, legal: ReferenceSnapshot, administrative: AdministrativeSnapshot,
  provider = { forwardLocation, reverseLocation }): Promise<LinkBatch> {
  if (inputs.length > 20) throw new LinkServiceError('ALL_ROW_LIMIT', '전체 결과 변환은 위치 조회 한도에 따라 한 번에 20개까지 가능합니다.', 413)
  const options = linkOptionsSchema.parse({ ...provided, target: 'all' })
  if (options.deduplicate || options.expandCandidates) throw new LinkServiceError('ALL_ROW_OPTIONS_UNSUPPORTED', '전체 결과는 원본 행을 유지하며 후보를 선택합니다. 중복 제거·후보 펼침은 지원하지 않습니다.')
  const forward = new Map<string, ReturnType<typeof forwardLocation>>(), reverse = new Map<string, ReturnType<typeof reverseLocation>>()
  const cached = {
    forwardLocation: (address: string, kind?: 'parcel' | 'road' | 'region') => {
      const key = JSON.stringify([address, kind])
      if (!forward.has(key)) forward.set(key, provider.forwardLocation(address, kind))
      return forward.get(key)!
    },
    reverseLocation: (point: Parameters<typeof reverseLocation>[0]) => {
      const key = JSON.stringify(point)
      if (!reverse.has(key)) reverse.set(key, provider.reverseLocation(point))
      return reverse.get(key)!
    },
  }
  const byCode = new Map(legal.regions.map(region => [region.code, region]))
  const sharedSelections = { ...options.selections }
  for (const key of linkConversionKeys) for (const [id, choice] of Object.entries(options.conversionSelections?.[key] || {})) if (byCode.has(choice)) sharedSelections[id] = choice
  const batches = await Promise.all(linkConversionKeys.map(async key => {
    const current: Partial<LinkOptions> = { ...options, target: key, level: key === 'legal_region' ? 'ri' : 'pnu', output: key === 'legal_region' ? 'columns' : 'both', addressStyle: 'full', selections: { ...sharedSelections, ...options.conversionSelections?.[key] }, conversionSelections: undefined }
    const batch = options.inputType === 'location' || key === 'location'
      ? await resolveLocationRows(inputs, current, legal, administrative, cached)
      : options.inputType === 'administrative' || key === 'administrative_region'
        ? resolveAdministrativeRows(inputs, current, legal, administrative)
        : resolveRows(inputs, current, legal)
    return [key, batch.rows] as const
  }))
  const rows = inputs.map((input, index): LinkResult => {
    const parts = Object.fromEntries(batches.map(([key, values]) => [key, values[index]!])) as Record<LinkConversionKey, LinkResult>
    const conversions = Object.fromEntries(linkConversionKeys.map(key => [key, conversion(key, parts[key])])) as Record<LinkConversionKey, LinkConversion>
    const values = Object.values(conversions)
    const status = values.some(value => value.status === 'needs_selection') ? 'needs_selection' : values.some(value => value.status === 'ok') ? 'ok' : parts.address.status
    const output: Record<string, string> = { address: conversions.address.value, pnu: conversions.pnu.value, legal_code: conversions.legal_region.code || '', legal_name: conversions.legal_region.name || '', administrative_code: conversions.administrative_region.code || '', administrative_name: conversions.administrative_region.name || '', location: conversions.location.value, x: parts.location.output.x || '', y: parts.location.output.y || '', crs: parts.location.output.crs || '', location_method: parts.location.output.location_method || '' }
    const region = conversions.legal_region.status === 'ok' ? byCode.get(output.legal_code) : undefined
    const path: LinkRegion[] = []; let current = region
    while (current && !path.some(item => item.code === current!.code)) { path.unshift(current); current = current.parentCode ? byCode.get(current.parentCode) : undefined }
    for (const [level, length] of Object.entries({ sido: 2, sigungu: 5, eupmyeondong: 8, ri: 10 })) {
      const entry = path.filter(item => item.level === level as RegionLevel).at(-1)
      output[level + '_code'] = entry ? entry.code.slice(0, length) : ''; output[level + '_name'] = entry?.name || ''
    }
    const errors = [...new Map(values.flatMap(value => value.errors).map(error => [error.code + ':' + error.message, error])).values()]
    return { ...parts.address, id: input.id, inputId: input.id, original: { ...input.original }, value: input.value, status, format: Object.values(parts).some(part => part.format === 'valid') ? 'valid' : parts.address.format, pnu: output.pnu, regionCode: output.legal_code, address: output.address, parcel: 'not_checked', output, conversions, candidates: [], errors,
      warnings: [...new Set(values.flatMap(value => value.warnings))], evidence: [...new Set(values.flatMap(value => value.evidence))] }
  })
  const summary: LinkBatch['summary'] = { ok: 0, needs_selection: 0, invalid: 0, not_found: 0, unavailable: 0, total: rows.length, input: inputs.length, omittedDuplicates: 0 }, errors: Record<string, number> = {}
  for (const row of rows) { summary[row.status]++; for (const error of row.errors) errors[error.code] = (errors[error.code] || 0) + 1 }
  const version = legal.version + '+' + administrative.version + '+vworld-geocoder-2'
  return { schemaVersion: '1', ruleVersion: 'geo-link-v1', version, options, rows, summary, errors, reference: { ...referenceMetadata(legal), version, warning: '전체 행 상태와 각 결과의 확인 상태는 별개입니다. 실제 필지 존재는 확인하지 않았습니다.' } }
}
