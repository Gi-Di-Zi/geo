import { levelCode, parsePnu, resolveRows, referenceMetadata } from '../../../shared/link/core.ts'
import { LocationError, parseLocation } from '../../../shared/link/location.ts'
import { linkConversionKeys, linkOptionsSchema } from '../../../shared/link/types.ts'
import type { InputRow, LinkBatch, LinkConversion, LinkConversionKey, LinkOptions, LinkRegion, LinkResult, ReferenceSnapshot } from '../../../shared/link/types.ts'
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

/** 숫자만이면 PNU·법정동코드. 다만 현재 법정동이 아닌 10자리가 행정동 사전에 있으면 행정동코드, 시군구로 없는 5자리는 우편번호로 본다. 나머지는 주소. */
export function detectInputType(value: string, legal: Map<string, LinkRegion>, administrative: Set<string>): 'pnu_legal' | 'administrative' | 'address' | 'postcode' {
  const s = value.trim()
  if (!/^\d+$/.test(s)) return 'address'
  if (s.length === 5 && !legal.has(s + '00000')) return 'postcode'
  return s.length === 10 && legal.get(s)?.status !== 'active' && administrative.has(s) ? 'administrative' : 'pnu_legal'
}

// 우편번호로 주소 목록을 찾는 자료는 아직 없어 주소 검색(웹의 카카오 우편번호 서비스)에서 고르게 한다.
const postcodeInput = (input: InputRow): LinkResult => ({ id: input.id, inputId: input.id, original: { ...input.original }, value: input.value, inputType: 'postcode', codeSystem: 'postcode', status: 'unavailable', format: 'valid', code: 'not_checked', parcel: 'not_checked',
  errors: [{ code: 'POSTCODE_SEARCH_REQUIRED', message: '우편번호는 주소 검색에서 해당 주소를 골라 주세요. 우편번호로 주소 목록을 찾는 자료는 아직 없습니다.' }], warnings: [], candidates: [], unparsed: '', pnu: '', regionCode: '', address: '', output: {}, evidence: [] })
const compact = (value = '') => value.replace(/\s+/g, '')

/** 우편번호는 위치 결과를 역조회해 정한다. 필지는 같은 필지, 도로명주소는 같은 도로명주소일 때만 쓰고 구역은 우편번호가 여러 개라 정하지 않는다. */
async function postcodeOf(input: InputRow, inputType: string, parts: Record<LinkConversionKey, LinkResult>, sourceCrs: string, reverse: (point: Parameters<typeof reverseLocation>[0]) => ReturnType<typeof reverseLocation>): Promise<LinkConversion> {
  const location = parts.location
  if (inputType === 'postcode' || location.status !== 'ok') return conversion('postcode', inputType === 'postcode' ? parts.address : location)
  const unavailable = (code: string, message: string): LinkConversion => ({ status: 'unavailable', value: '', errors: [{ code, message }], warnings: [], candidates: [], evidence: [] })
  const parcel = inputType !== 'location' && parts.pnu.status === 'ok' && parts.pnu.pnu ? parsePnu(parts.pnu.pnu).parts : undefined
  // 주소 입력에 지번이 없는데 위치가 나왔다면 도로명주소로 조회한 경우다.
  const road = inputType === 'address' && !parcel
  if (inputType !== 'location' && !parcel && !road) return unavailable('POSTCODE_REGION', '구역에는 우편번호가 여러 개 있어 하나로 정하지 않습니다. 지번이나 주소를 넣어 주세요.')
  try {
    const found = await reverse(inputType === 'location' ? parseLocation(input.value, sourceCrs) : { x: Number(location.output.longitude), y: Number(location.output.latitude), crs: 'EPSG:4326' })
    if (parcel ? found.legalCode !== parcel.regionCode || compact(found.parcelNumber) !== compact(parcel.parcel) : road && compact(found.roadAddress.replace(/\([^)]*\)$/, '')) !== compact(input.value))
      return unavailable('POSTCODE_ADDRESS_MISMATCH', '대표점을 역조회한 주소가 입력과 달라 우편번호를 정하지 않았습니다.')
    if (!found.postcode) return unavailable('POSTCODE_UNAVAILABLE', '위치 원천이 이 주소의 우편번호를 제공하지 않았습니다.')
    return { status: 'ok', value: found.postcode, code: found.postcode, errors: [], warnings: ['위치 원천의 역지오코딩으로 확인한 우편번호(기초구역번호)입니다.'], candidates: [], evidence: [found.source + '; 조회 시각 ' + found.checkedAt] }
  } catch (error) {
    return unavailable(error instanceof LocationError ? error.code : 'LOCATION_UNAVAILABLE', error instanceof LocationError ? error.message : '위치 원천을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.')
  }
}

/** 각 변환의 확인·실패를 보존하고 SHP 원천은 다운로드를 요청할 때만 조회한다. 자동 입력은 행마다 유형을 정해 같은 유형끼리 조회한다. */
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
  const administrativeCodes = new Set(administrative.regions.map(region => region.code))
  const types = inputs.map(input => options.inputType === 'auto' ? detectInputType(input.value, byCode, administrativeCodes) : options.inputType)
  const byRow: Partial<Record<LinkConversionKey, LinkResult>>[] = inputs.map(() => ({}))
  await Promise.all([...new Set(types)].map(async inputType => {
    const indexes = types.flatMap((type, index) => type === inputType ? [index] : []), group = indexes.map(index => inputs[index]!)
    if (inputType === 'postcode') { indexes.forEach((index, n) => { for (const key of linkConversionKeys) byRow[index]![key] = postcodeInput(group[n]!) }); return }
    await Promise.all(linkConversionKeys.map(async key => {
      const current: Partial<LinkOptions> = { ...options, inputType, target: key, level: key === 'legal_region' ? 'ri' : 'pnu', output: key === 'legal_region' ? 'columns' : 'both', addressStyle: 'full', selections: { ...sharedSelections, ...options.conversionSelections?.[key] }, conversionSelections: undefined }
      const batch = inputType === 'location' || key === 'location'
        ? await resolveLocationRows(group, current, legal, administrative, cached)
        : inputType === 'administrative' || key === 'administrative_region'
          ? resolveAdministrativeRows(group, current, legal, administrative)
          : resolveRows(group, current, legal)
      batch.rows.forEach((row, n) => { byRow[indexes[n]!]![key] = row })
    }))
  }))
  const postcodes = await Promise.all(inputs.map((input, index) => postcodeOf(input, types[index]!, byRow[index] as Record<LinkConversionKey, LinkResult>, options.sourceCrs || 'EPSG:4326', cached.reverseLocation)))
  const rows = inputs.map((input, index): LinkResult => {
    const parts = byRow[index] as Record<LinkConversionKey, LinkResult>
    const conversions = { ...Object.fromEntries(linkConversionKeys.map(key => [key, conversion(key, parts[key])])), postcode: postcodes[index]! } as Record<LinkConversionKey, LinkConversion>
    const values = Object.values(conversions)
    const status = values.some(value => value.status === 'needs_selection') ? 'needs_selection' : values.some(value => value.status === 'ok') ? 'ok' : parts.address.status
    const output: Record<string, string> = { address: conversions.address.value, pnu: conversions.pnu.value, legal_code: conversions.legal_region.code || '', legal_name: conversions.legal_region.name || '', administrative_code: conversions.administrative_region.code || '', administrative_name: conversions.administrative_region.name || '', location: conversions.location.value, postcode: conversions.postcode.value, x: parts.location.output.x || '', y: parts.location.output.y || '', crs: parts.location.output.crs || '', location_method: parts.location.output.location_method || '' }
    const region = conversions.legal_region.status === 'ok' ? byCode.get(output.legal_code) : undefined
    const path: LinkRegion[] = []; let current = region
    while (current && !path.some(item => item.code === current!.code)) { path.unshift(current); current = current.parentCode ? byCode.get(current.parentCode) : undefined }
    const hasRi = path.some(item => item.level === 'ri')
    for (const level of ['sido', 'sigungu', 'eupmyeondong', 'ri'] as const) {
      const entry = path.filter(item => item.level === level).at(-1)
      output[level + '_code'] = entry ? levelCode(entry.code, level, hasRi) : ''; output[level + '_name'] = entry?.name || ''
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
