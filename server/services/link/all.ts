import { canonicalName, levelCode, parsePnu, resolveRows, referenceMetadata } from '../../../shared/link/core.ts'
import { formatLocation, LocationError, parseLocation, toWgs84, transformLocation } from '../../../shared/link/location.ts'
import { linkConversionKeys, linkOptionsSchema } from '../../../shared/link/types.ts'
import type { InputRow, LinkBatch, LinkConversion, LinkConversionKey, LinkOptions, LinkRegion, LinkResult, ReferenceSnapshot } from '../../../shared/link/types.ts'
import type { AdministrativeSnapshot } from '../../../shared/link/administrative.ts'
import { resolveAdministrativeRows } from './administrative.ts'
import { resolveLocationRows } from './location-resolve.ts'
import { buildingsOn, forwardLocation, landOf, parcelAt, parcelByPnu, reverseLocation, searchRoad } from './location.ts'
import type { BuildingInfo, LandInfo, ParcelInfo, RoadMatch } from './location.ts'
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
const ROAD = /(?:로|길)\s*\d/
// 괄호(동·건물명)를 빼고 시도 약칭을 바꾼 뒤, 도로명과 건물번호 사이를 한 칸으로 (뒤 일치는 띄어쓰기 경계에서만: 중앙로 ≠ 동중앙로)
const plainRoad = (value: string) => canonicalName(value.replace(/\s*\([^)]*\)\s*$/, '')).replace(/(로|길)\s*(\d)/g, '$1 $2')

/** 도로명주소 → 건물의 대표지번 PNU. 같은 도로명주소인 건물만 쓰고, 시도·시군구를 뺀 입력은 뒤가 일치하는 건물이 한 필지일 때만 */
async function roadOf(value: string, search: (address: string) => Promise<RoadMatch[]>) {
  const want = plainRoad(value), items = await search(value)
  const same = items.filter(item => plainRoad(item.road) === want)
  const tail = same.length ? same : items.filter(item => plainRoad(item.road).endsWith(' ' + want))

  return new Set(tail.map(item => item.pnu)).size === 1 ? { ...tail[0]!, filled: !same.length } : undefined
}

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

/** 외부 원천. 필지 단위 함수(parcelAt 등)가 없으면 그 결과를 만들지 않는다 (시험·외부 조회 끔) */
interface Provider {
  forwardLocation: typeof forwardLocation
  reverseLocation: typeof reverseLocation
  searchRoad?: typeof searchRoad
  parcelAt?: typeof parcelAt
  parcelByPnu?: typeof parcelByPnu
  buildingsOn?: typeof buildingsOn
  landOf?: typeof landOf
}

const detail = (status: LinkConversion['status'], value: string, extra: Partial<LinkConversion> = {}): LinkConversion => ({ status, value, errors: [], warnings: [], candidates: [], evidence: [], ...extra })
// 키·도메인·한도 문제는 원천의 사유 그대로, 그 밖은 어느 항목인지 알 수 있게
const failed = (reason: unknown, code: string, label: string): LinkConversion => detail('unavailable', '', { errors: [{ code, message: reason instanceof LocationError && /AUTH|LIMIT|BUSY|SETUP/.test(reason.code) ? reason.message : `${label} 원천을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.` }] })
const skipped = (code: string) => detail('not_found', '', { errors: [{ code, message: '연속지적도에 없는 지번이라 확인하지 않았습니다.' }] })
const settled = <T>(result: PromiseSettledResult<T>) => (result.status === 'fulfilled' ? { value: result.value } : { error: result.reason as unknown })

/**
 * PNU가 정해진 줄의 필지 단위 결과 (같은 PNU는 한 번만): 필지 실재·경계(연속지적도), 필지에 등록된 건물의 유무·도로명주소(도로명주소 건물),
 * 토지 속성(토지특성). 원천 장애는 그 항목에만 남기고 다른 결과는 지우지 않는다
 */
async function addDetails(rows: LinkResult[], provider: Provider) {
  const pnus = [...new Set(rows.flatMap(row => (row.conversions?.pnu.status === 'ok' && /^\d{19}$/.test(row.output.pnu) ? [row.output.pnu] : [])))]
  const found = new Map(await Promise.all(pnus.map(async pnu => {
    // 필지가 지적에 없으면 건물·토지 속성은 묻지 않는다 (없는 지번에 '건물 없음'으로 답하지 않게, 원천 호출도 아낌)
    const [parcel] = await Promise.allSettled([provider.parcelByPnu?.(pnu)])
    const absent = parcel.status === 'fulfilled' && !parcel.value
    const [buildings, land] = await Promise.allSettled([absent ? undefined : provider.buildingsOn?.(pnu) ?? [], absent ? undefined : provider.landOf?.(pnu)])

    return [pnu, { absent, parcel: settled<ParcelInfo | undefined>(parcel), buildings: settled<BuildingInfo[] | undefined>(buildings), land: settled<LandInfo | undefined>(land) }] as const
  })))

  for (const row of rows) {
    const d = found.get(row.output.pnu)
    if (!d || !row.conversions) continue
    const { absent, parcel, buildings, land } = d
    const out = row.output

    if ('error' in parcel) row.conversions.parcel = failed(parcel.error, 'PARCEL_UNAVAILABLE', '연속지적도')
    else if (!parcel.value) {
      row.parcel = 'no_match_in_dataset'; out.parcel_exists = '없음'
      row.conversions.parcel = detail('not_found', '', { errors: [{ code: 'PARCEL_NOT_IN_CADASTRE', message: '연속지적도에 없는 지번입니다. 분할·합병으로 없어졌거나 잘못된 지번일 수 있습니다.' }] })
    } else {
      const p = parcel.value
      row.parcel = 'matched'; out.parcel_exists = '있음'; out.jimok = p.jimok
      row.conversions.parcel = detail('ok', ['있음', p.jimok && `지목 ${p.jimok}`].filter(Boolean).join(' · '), { code: p.pnu, ...(p.geometry && { geometry: p.geometry }), details: { 지번: p.jibun, ...(p.jimok && { 지목: p.jimok }) },
        warnings: ['연속지적도는 지적도를 이어 붙인 참고 도면입니다. 법적 경계·면적은 지적공부로 확인하세요.'], evidence: ['VWorld 연속지적도(LP_PA_CBND_BUBUN); 조회 시각 ' + p.checkedAt] })
    }

    if (absent) { row.conversions.building = skipped('PARCEL_NOT_IN_CADASTRE'); row.conversions.road_address = skipped('PARCEL_NOT_IN_CADASTRE'); row.conversions.land = skipped('PARCEL_NOT_IN_CADASTRE'); continue }

    if ('error' in buildings) {
      row.conversions.building = failed(buildings.error, 'BUILDING_UNAVAILABLE', '도로명주소 건물'); row.conversions.road_address = failed(buildings.error, 'BUILDING_UNAVAILABLE', '도로명주소 건물')
    } else {
      const list = buildings.value ?? []
      const roads = [...new Set(list.map(b => b.road).filter(Boolean))]
      out.building = list.length ? '있음' : '없음'; out.building_count = String(list.length)
      out.building_names = list.map(b => [b.name, b.part].filter(Boolean).join(' ')).filter(Boolean).join(', ')
      out.road_address = roads.join(' / ')
      const note = ['도로명주소가 부여된 건물 기준입니다. 미등록 건물은 없음으로 나올 수 있습니다.']
      const evidence = ['VWorld 도로명주소 건물(LT_C_SPBD, 건물관리번호 앞 19자리 = PNU)']
      row.conversions.building = detail('ok', list.length ? `있음 ${list.length}동: ${list.map(b => [b.name || '이름 없음', b.part].filter(Boolean).join(' ') + (b.floors ? ` ${b.floors}층` : '')).join(', ')}` : '없음', { code: String(list.length), warnings: note, evidence })
      row.conversions.road_address = roads.length
        ? detail('ok', roads.join(' / '), { code: roads[0], warnings: roads.length > 1 ? ['한 필지에 건물이 여럿이라 도로명주소도 여럿입니다.'] : [], evidence })
        : detail('not_found', '', { errors: [{ code: 'NO_BUILDING_ROAD', message: '이 필지에 등록된 건물이 없어 도로명주소가 없습니다.' }], evidence })
    }

    if ('error' in land) row.conversions.land = failed(land.error, 'LAND_UNAVAILABLE', '토지특성')
    else if (!land.value) row.conversions.land = detail('not_found', '', { errors: [{ code: 'LAND_NOT_FOUND', message: '토지특성 자료가 없는 필지입니다.' }] })
    else {
      const v = land.value.values
      Object.assign(out, { land_year: land.value.year, land_area: v.면적 ?? '', land_zone: v.용도지역 ?? '', land_use: v.이용상황 ?? '', land_price: v.공시지가 ?? '' })
      if (v.지목) out.jimok = v.지목
      row.conversions.land = detail('ok', [v.용도지역, v.이용상황, v.면적].filter(Boolean).join(' · '), { details: { 기준연도: land.value.year, ...v }, evidence: ['VWorld 국가중점데이터 토지특성; 조회 시각 ' + land.value.checkedAt] })
    }
  }
}

/** 각 변환의 확인·실패를 보존하고 SHP 원천은 다운로드를 요청할 때만 조회한다. 자동 입력은 행마다 유형을 정해 같은 유형끼리 조회한다. */
export async function resolveAllRows(inputs: InputRow[], provided: Partial<LinkOptions>, legal: ReferenceSnapshot, administrative: AdministrativeSnapshot,
  given: Provider = { forwardLocation, reverseLocation, searchRoad, parcelAt, parcelByPnu, buildingsOn, landOf }): Promise<LinkBatch> {
  const options = linkOptionsSchema.parse({ ...provided, target: 'all' })
  // 외부 조회 끔(lookups=false): 위치·우편번호·도로명주소·행정동 역조회 없이 사전만 → 한 번에 200줄 (위치 원천을 부르면 '꺼짐'으로 표시)
  const off = () => Promise.reject(new LocationError('LOOKUP_OFF', '외부 조회(위치·우편번호·도로명주소)를 끈 변환입니다.', 'unavailable'))
  const provider: Provider = options.lookups ? given : { forwardLocation: off, reverseLocation: off }
  if (inputs.length > (options.lookups ? 20 : 200)) throw new LinkServiceError('ALL_ROW_LIMIT', options.lookups ? '위치까지 받는 전체 결과는 위치 조회 한도에 따라 한 번에 20개까지 가능합니다. 외부 조회를 끄면(lookups=false) 200개까지.' : '전체 결과는 한 번에 200개까지 가능합니다.', 413)
  if (options.deduplicate || options.expandCandidates) throw new LinkServiceError('ALL_ROW_OPTIONS_UNSUPPORTED', '전체 결과는 원본 행을 유지하며 후보를 선택합니다. 중복 제거·후보 펼침은 지원하지 않습니다.')
  const forward = new Map<string, ReturnType<typeof forwardLocation>>(), reverse = new Map<string, ReturnType<typeof reverseLocation>>()
  const cached = {
    forwardLocation: (address: string, kind?: 'parcel' | 'road' | 'region', regionCode?: string) => {
      const key = JSON.stringify([address, kind, regionCode])
      if (!forward.has(key)) forward.set(key, provider.forwardLocation(address, kind, regionCode))
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
  // 도로명주소는 원천의 대표지번 PNU로 바꿔 PNU처럼 처리한다. 찾지 못하면 기존처럼 위치만 조회
  const search = provider.searchRoad
  const roads = await Promise.all(inputs.map((input, index) => search && types[index] === 'address' && ROAD.test(input.value) ? roadOf(input.value, search).catch(() => undefined) : undefined))
  roads.forEach((road, index) => { if (road) types[index] = 'pnu_legal' })
  // 좌표 → 그 좌표가 들어 있는 필지(연속지적도): 찾으면 PNU처럼 처리하고 위치는 입력 좌표 그대로. 도로·하천처럼 필지가 없으면 기존 역조회
  const at = provider.parcelAt
  const spots = await Promise.all(inputs.map(async (input, index) => {
    if (!at || types[index] !== 'location') return undefined
    try {
      const point = toWgs84(parseLocation(input.value, options.sourceCrs || 'EPSG:4326'))
      const parcel = await at({ lon: point.lon, lat: point.lat })

      return parcel && { parcel, lon: point.lon, lat: point.lat }
    } catch { return undefined }
  }))
  spots.forEach((spot, index) => { if (spot) types[index] = 'pnu_legal' })
  const effective = inputs.map((input, index) => roads[index] ? { ...input, value: roads[index]!.pnu } : spots[index] ? { ...input, value: spots[index]!.parcel.pnu } : input)
  const byRow: Partial<Record<LinkConversionKey, LinkResult>>[] = inputs.map(() => ({}))
  await Promise.all([...new Set(types)].map(async inputType => {
    const indexes = types.flatMap((type, index) => type === inputType ? [index] : []), group = indexes.map(index => effective[index]!)
    if (inputType === 'postcode') { indexes.forEach((index, n) => { for (const key of linkConversionKeys) byRow[index]![key] = postcodeInput(group[n]!) }); return }
    await Promise.all(linkConversionKeys.map(async key => {
      const current: Partial<LinkOptions> = { ...options, inputType, target: key, level: key === 'legal_region' ? 'ri' : 'pnu', output: key === 'legal_region' ? 'columns' : 'both', addressStyle: 'full', selections: { ...sharedSelections, ...options.conversionSelections?.[key] }, conversionSelections: undefined }
      const batch = !options.lookups && key === 'location' && inputType !== 'location'
        ? { rows: group.map(input => ({ ...postcodeInput(input), codeSystem: 'location' as const, errors: [{ code: 'LOOKUP_OFF', message: '외부 조회(위치·우편번호·도로명주소)를 끈 변환입니다.' }] })) }
        : inputType === 'location' || key === 'location'
        ? await resolveLocationRows(group, current, legal, administrative, cached)
        : inputType === 'administrative' || key === 'administrative_region'
          ? resolveAdministrativeRows(group, current, legal, administrative)
          : resolveRows(group, current, legal)
      batch.rows.forEach((row, n) => { byRow[indexes[n]!]![key] = row })
    }))
  }))
  // 위치: 도로명주소는 필지 대표점 대신 원천의 건물 좌표, 좌표 입력은 입력 좌표 그대로. 우편번호는 도로명주소 DB 값
  inputs.forEach((_, index) => {
    const location = byRow[index]!.location, road = roads[index], spot = spots[index]
    const fixed = road ? { lon: road.lon, lat: road.lat, method: 'building_point', note: '도로명주소 DB의 건물 위치입니다. 필지 중심점이 아닙니다.', evidence: 'VWorld 검색 API (도로명주소); 조회 시각 ' + road.checkedAt }
      : spot ? { lon: spot.lon, lat: spot.lat, method: 'input_point', note: '입력 좌표입니다. 이 좌표가 들어 있는 필지를 연속지적도에서 찾았습니다.', evidence: 'VWorld 연속지적도 (좌표가 들어 있는 필지); 조회 시각 ' + spot.parcel.checkedAt } : undefined
    if (!fixed || !location) return
    const point = transformLocation({ x: fixed.lon, y: fixed.lat, crs: 'EPSG:4326' }, options.outputCrs || 'EPSG:4326')
    byRow[index]!.location = { ...location, status: 'ok', format: 'valid', errors: [], candidates: [], warnings: [fixed.note], evidence: [fixed.evidence],
      output: { code: formatLocation(point), x: String(point.x), y: String(point.y), crs: point.crs, longitude: String(fixed.lon), latitude: String(fixed.lat), code_kind: 'location', location_method: fixed.method } }
  })
  const postcodes = await Promise.all(inputs.map((input, index): Promise<LinkConversion> | LinkConversion => {
    const road = roads[index]
    if (road?.postcode) return { status: 'ok', value: road.postcode, code: road.postcode, errors: [], warnings: ['도로명주소 DB의 우편번호(기초구역번호)입니다.'], candidates: [], evidence: ['VWorld 검색 API (도로명주소); 조회 시각 ' + road.checkedAt] }
    return postcodeOf(input, types[index]!, byRow[index] as Record<LinkConversionKey, LinkResult>, options.sourceCrs || 'EPSG:4326', cached.reverseLocation)
  }))
  // 법정동에 행정동이 여럿이면 필지·건물 위치를 역조회한 행정동으로 정한다 (우편번호 확인과 같은 역조회를 공유)
  const placed = await Promise.all(inputs.map(async (_, index) => {
    const part = byRow[index]!.administrative_region, location = byRow[index]!.location
    if (part?.status !== 'needs_selection' || location?.status !== 'ok' || !byRow[index]!.pnu?.pnu) return undefined
    const found = await cached.reverseLocation({ x: Number(location.output.longitude), y: Number(location.output.latitude), crs: 'EPSG:4326' }).catch(() => undefined)
    const chosen = found && part.candidates.find(item => item.code === found.administrativeCode)
    return chosen ? { status: 'ok', value: `${chosen.code} · ${chosen.name}`, code: chosen.code, name: chosen.name, errors: [], warnings: ['필지·건물 위치를 역조회한 행정동입니다. 경계 부근은 다를 수 있습니다.'], candidates: [], evidence: [found.source + '; 조회 시각 ' + found.checkedAt] } satisfies LinkConversion : undefined
  }))
  const rows = inputs.map((input, index): LinkResult => {
    const parts = byRow[index] as Record<LinkConversionKey, LinkResult>
    const conversions = { ...Object.fromEntries(linkConversionKeys.map(key => [key, conversion(key, parts[key])])), postcode: postcodes[index]!, ...placed[index] && { administrative_region: placed[index] } } as Record<LinkConversionKey, LinkConversion>
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
    const road = roads[index]
    const roadNotes = road ? [`도로명주소 ${road.road}의 건물 대표지번으로 PNU를 정했습니다. 여러 필지에 걸친 건물은 관련지번이 더 있을 수 있습니다.`, ...(road.filled ? ['입력에 없는 시도·시군구를 도로명주소 검색 결과에서 채웠습니다.'] : [])]
      : spots[index] ? ['좌표가 들어 있는 필지(연속지적도)로 PNU를 정했습니다.'] : []
    return { ...parts.address, id: input.id, inputId: input.id, original: { ...input.original }, value: input.value, ...road && { inputType: 'address' as const }, ...spots[index] && { inputType: 'location' as const }, status, format: Object.values(parts).some(part => part.format === 'valid') ? 'valid' : parts.address.format, pnu: output.pnu, regionCode: output.legal_code, address: output.address, parcel: 'not_checked', output, conversions, candidates: [], errors,
      warnings: [...new Set([...roadNotes, ...values.flatMap(value => value.warnings)])], evidence: [...new Set(values.flatMap(value => value.evidence))] }
  })
  if (options.details && provider.parcelByPnu) await addDetails(rows, provider)
  const summary: LinkBatch['summary'] = { ok: 0, needs_selection: 0, invalid: 0, not_found: 0, unavailable: 0, total: rows.length, input: inputs.length, omittedDuplicates: 0 }, errors: Record<string, number> = {}
  for (const row of rows) { summary[row.status]++; for (const error of row.errors) errors[error.code] = (errors[error.code] || 0) + 1 }
  const version = legal.version + '+' + administrative.version + '+vworld-geocoder-2'
  return { schemaVersion: '1', ruleVersion: 'geo-link-v1', version, options, rows, summary, errors, reference: { ...referenceMetadata(legal), version, warning: options.lookups && options.details ? '전체 행 상태와 각 결과의 확인 상태는 별개입니다. 필지 존재는 연속지적도(참고 도면)로 확인했습니다.' : '전체 행 상태와 각 결과의 확인 상태는 별개입니다. 실제 필지 존재는 확인하지 않았습니다.' } }
}
