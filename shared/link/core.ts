import { defaultOptions, linkOptionsSchema } from './types.ts'
import type { InputRow, LinkBatch, LinkCandidate, LinkOptions, LinkRegion, LinkResult, PnuParts, ReferenceSnapshot, RegionLevel, RegionQuery } from './types.ts'

const errors: Record<string, string> = {
  EMPTY_INPUT: '빈 입력입니다.', PNU_LENGTH: 'PNU는 정확히 19자리여야 합니다.',
  IDENTIFIER_CHARACTERS: '식별자는 숫자 문자열만 허용합니다.', LAND_TYPE: '일반·산 구분은 1(일반), 2(산)만 허용합니다.',
  PARCEL_NUMBER: '본번은 1~9999, 부번은 0~9999 범위입니다.', REGION_CODE_LENGTH: '법정구역 코드는 2·5·8·10자리만 지원합니다.',
  REGION_NOT_FOUND: '법정구역 사전에 등록된 코드를 찾지 못했습니다.', REGION_RETIRED: '폐지된 법정구역 코드입니다. 현재 코드로 자동 변경하지 않습니다.',
  AMBIGUOUS_REGION: '상위 지역이 부족하거나 일치하는 지역이 여러 곳입니다. 후보를 선택하세요.',
  UNPARSED_ADDRESS: '지원하는 지번주소(법정구역명 + 산 선택 + 본번-부번)로 해석하지 못했습니다.',
  UNSUPPORTED_ADDRESS: '도로명주소·건물 동호·행정동은 이번 지번 파서에서 지원하지 않습니다.',
  IDENTIFIER_PRECISION_LOSS: '숫자로 저장된 긴 식별자는 정밀도가 손상되었을 수 있습니다. 원본 문자형 코드를 다시 제공하세요.',
  FORMULA_NOT_EVALUATED: '수식 셀의 원문을 보존했습니다. 수식·저장된 계산 결과를 주소·코드로 실행하거나 사용하지 않았습니다.',
  SOURCE_UNAVAILABLE: '운영 법정구역 기준 자료가 준비되지 않았습니다. 형식 분해만 확인할 수 있습니다.',
  SELECTION_INVALID: '선택한 후보가 현재 입력·기준 버전의 후보에 없습니다.',
  MISSING_RI: '리가 필요한 읍·면입니다. 공식 하위 리를 선택하세요.',
  AMBIGUOUS_CODE_SYSTEM: '5자리 입력은 우편번호와 시군구코드가 모호합니다. 시군구코드라면 입력 유형을 PNU·법정동코드(pnu_legal)로 지정하세요.',
  OUT_OF_COVERAGE: '부분 확보한 기준 자료의 지원 범위 밖이거나 미수집 구역입니다.',
}
const error = (code: string) => ({ code, message: errors[code] ?? code })
const plainNumber = (value: string) => value.replace(/^0+(?=\d)/, '')

/** 단계 코드 표기: 시도 2·시군구 5자리, 읍면동·리는 법정동코드 10자리. 아래에 리가 있는 읍·면만 8자리 앞부분. */
export function levelCode(code: string, level: RegionLevel, hasRi: boolean) {
  return code.slice(0, { sido: 2, sigungu: 5, eupmyeondong: hasRi ? 8 : 10, ri: 10 }[level])
}

export function suggestInputType(value: string): 'pnu' | 'code' | 'address' {
  const s = value.trim()
  return /^\d+$/.test(s) ? s.length > 10 ? 'pnu' : 'code' : 'address'
}

export function parsePnu(value: string): { parts?: PnuParts; error?: { code: string; message: string } } {
  if (!/^\d+$/.test(value)) return { error: error('IDENTIFIER_CHARACTERS') }
  if (value.length !== 19) return { error: error('PNU_LENGTH') }
  const landType = value.slice(10, 11)
  if (landType !== '1' && landType !== '2') return { error: error('LAND_TYPE') }
  const main = value.slice(11, 15), sub = value.slice(15, 19)
  if (main === '0000') return { error: error('PARCEL_NUMBER') }
  return { parts: { regionCode: value.slice(0, 10), landType, mountain: landType === '2', main, sub,
    parcel: `${landType === '2' ? '산 ' : ''}${plainNumber(main)}${sub === '0000' ? '' : `-${plainNumber(sub)}`}` } }
}

export function referenceMetadata(snapshot: ReferenceSnapshot) {
  const { regions, ...info } = snapshot
  return { ...info, count: regions.length }
}

const candidate = (r: LinkRegion): LinkCandidate => ({ id: r.code, code: r.code, name: r.fullName, status: r.status, level: r.level })
const compact = (s: string) => s.replace(/\s+/g, ' ').trim()
// 시도 약칭·'OO시'·옛 시도명만 바꾸며 동명·행정동·도로명은 추측하지 않는다. 광주시는 경기도 광주시와 겹쳐 바꾸지 않는다
const SIDO_ALIASES: Record<string, string> = {
  서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시',
  경기: '경기도', 충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도',
  강원: '강원특별자치도', 제주: '제주특별자치도', 세종: '세종특별자치시',
  서울시: '서울특별시', 부산시: '부산광역시', 대구시: '대구광역시', 인천시: '인천광역시', 대전시: '대전광역시', 울산시: '울산광역시', 세종시: '세종특별자치시',
  강원도: '강원특별자치도', 전라북도: '전북특별자치도', 제주도: '제주특별자치도',
}
const OLD_SIDO = /^(강원도|전라북도|제주도)\s/
export function canonicalName(s: string) {
  return compact(s).replace(new RegExp(`^(${Object.keys(SIDO_ALIASES).join('|')})(?=\\s)`), token => SIDO_ALIASES[token] ?? token)
}

// 시도 명칭 변경으로 앞 두 자리만 바뀐 코드: 제주도 49→제주특별자치도 50(2006-07-01), 강원도 42→강원특별자치도 51(2023-06-11), 전라북도 45→전북특별자치도 52(2024-01-18).
// 아래 단계 이름이 같은 현존 코드만 잇는다. 명칭 변경 전에 이미 폐지된 코드는 후속이 없다
const RENAMED_SIDO: Record<string, string> = { 49: '50', 42: '51', 45: '52' }
function successor(region: LinkRegion, byCode: Map<string, LinkRegion>) {
  const next = RENAMED_SIDO[region.code.slice(0, 2)], found = next ? byCode.get(next + region.code.slice(2)) : undefined
  const below = (r: LinkRegion) => r.fullName.split(' ').slice(1).join(' ')

  return found?.status === 'active' && below(found) === below(region) ? found : undefined
}

/** 이름 목록 part가 all 안에 순서대로 모두 있는지 (사이 단계 생략 허용) */
function inOrder(all: string[], part: string[]) {
  let i = 0

  for (const word of all) if (word === part[i]) i++

  return i === part.length
}

function ancestry(region: LinkRegion, byCode: Map<string, LinkRegion>): LinkRegion[] {
  const path: LinkRegion[] = [], seen = new Set<string>()
  let current: LinkRegion | undefined = region
  while (current && !seen.has(current.code)) {
    seen.add(current.code); path.unshift(current)
    current = current.parentCode ? byCode.get(current.parentCode) : undefined
  }
  return path
}

const nameIndexes = new WeakMap<ReferenceSnapshot, Map<string, LinkRegion[]>>()
function addressIndex(snapshot: ReferenceSnapshot) {
  let index = nameIndexes.get(snapshot)
  if (index) return index
  index = new Map()
  for (const region of snapshot.regions) {
    const prefixLength = { sido: 2, sigungu: 5, eupmyeondong: 8, ri: 10 }[region.level]
    const prefixKey = `#${prefixLength}:${region.code.slice(0, prefixLength)}`
    index.set(prefixKey, [...(index.get(prefixKey) ?? []), region])
    if (region.level === 'ri' && region.parentCode) index.set(`@${region.parentCode}`, [...(index.get(`@${region.parentCode}`) ?? []), region])
    if (region.level !== 'eupmyeondong' && region.level !== 'ri') continue
    const words = region.fullName.split(' ')
    for (let i = 0; i < words.length; i++) {
      const key = words.slice(i).join(' ')
      const entries = index.get(key) ?? []
      entries.push(region); index.set(key, entries)
    }
  }
  nameIndexes.set(snapshot, index)
  return index
}

export function lookupRegions(query: RegionQuery | string, snapshot: ReferenceSnapshot) {
  const q = typeof query === 'string' ? { query } : query
  const byCode = new Map(snapshot.regions.map(r => [r.code, r]))
  const name = canonicalName(q.query ?? '')
  const rows = snapshot.regions.filter(r => {
    if (!q.includeRetired && r.status === 'retired') return false
    if (name && !(/^(?:\d{2}|\d{5}|\d{8}|\d{10})$/.test(name) ? r.code.startsWith(name) : r.fullName.includes(name) || r.name.includes(name))) return false
    if (!q.parentCode) return true
    return q.descendants ? ancestry(r, byCode).slice(0, -1).some(p => p.code === q.parentCode) : r.parentCode === q.parentCode
  })
  const limit = Math.max(1, Math.min(1000, q.limit ?? 100))
  return { version: snapshot.version, available: snapshot.available, rows: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit }
}

function outputOf(result: LinkResult, region: LinkRegion | undefined, parts: PnuParts | undefined, options: LinkOptions, byCode: Map<string, LinkRegion>) {
  const path = region ? ancestry(region, byCode) : []
  const levels = Object.fromEntries((['sido', 'sigungu', 'eupmyeondong', 'ri'] as RegionLevel[]).map(level => [level, path.filter(r => r.level === level)])) as Record<RegionLevel, LinkRegion[]>
  const chosen = options.level === 'ri' ? levels.ri.at(-1) ?? (region?.level === 'eupmyeondong' && !/[읍면]$/.test(region.name) ? region : undefined) : options.level === 'sigungu' ? levels.sigungu.at(-1) : options.level === 'sido' ? levels.sido.at(-1) : options.level === 'eupmyeondong' ? levels.eupmyeondong.at(-1) : region
  const length = { sido: 2, sigungu: 5, eupmyeondong: 8, ri: 10 }[options.level as RegionLevel]
  let code = length ? (chosen?.code ?? result.regionCode).slice(0, length) : options.level === 'pnu' ? result.pnu : options.level === 'parcel' ? parts?.parcel ?? '' : result.value.slice(0, options.prefixLength ?? 1)
  if (options.level === 'ri' && region && !chosen) { code = ''; result.warnings.push('리 없는 구역입니다. 리 명칭·코드를 만들지 않았습니다.') }
  const fullName = options.level === 'parcel' || options.level === 'pnu' ? result.address : options.level === 'custom' ? '' : region?.fullName ?? ''
  const leafName = options.level === 'parcel' ? parts?.parcel ?? '' : options.level === 'pnu' ? [region?.name, parts?.parcel].filter(Boolean).join(' ') : region?.name ?? ''
  const name = options.addressStyle === 'leaf' ? leafName : fullName
  const output: Record<string, string> = {}
  if (options.output === 'code' || options.output === 'both' || options.output === 'columns') output.code = code
  if (options.output === 'name' || options.output === 'both' || options.output === 'columns') output.name = name
  if (options.output === 'columns' || options.addressStyle === 'columns') {
    for (const level of ['sido', 'sigungu', 'eupmyeondong', 'ri'] as RegionLevel[]) {
      output[`${level}_name`] = levels[level].map(r => r.name).join(' ')
      const entry = levels[level].at(-1)
      output[`${level}_code`] = entry ? levelCode(entry.code, level, levels.ri.length > 0) : ''
    }
    output.land_type = parts?.landType ?? ''; output.main = parts ? plainNumber(parts.main) : ''; output.sub = parts ? plainNumber(parts.sub) : ''
  }
  output.code_kind = options.level === 'custom' ? 'custom_string_prefix' : options.level === 'pnu' ? 'pnu' : options.level === 'parcel' ? 'parcel_display' : 'region_prefix'
  output.registered_code = chosen?.code ?? ''
  if (options.level === 'custom') result.warnings.push('사용자 지정 문자열 앞부분 추출입니다. 공식 지역코드 확인이 아닙니다.')
  return output
}

function resolveOne(input: InputRow, options: LinkOptions, snapshot: ReferenceSnapshot, byCode: Map<string, LinkRegion>): LinkResult {
  const value = input.value.trim(), inputType = options.inputType === 'pnu_legal' ? value.length > 10 ? 'pnu' : 'code' : options.inputType === 'auto' ? suggestInputType(value) : options.inputType
  const result: LinkResult = { id: input.id, inputId: input.id, original: { ...input.original }, value: input.value, inputType,
    codeSystem: inputType === 'pnu' || inputType === 'address' ? 'pnu' : 'legal_region', status: 'ok', format: 'not_applicable', code: 'not_checked', parcel: 'not_checked', errors: [], warnings: [], candidates: [], unparsed: '', pnu: '', regionCode: '', address: '', output: {},
    evidence: [`규칙 geo-link-v1; 기준 ${snapshot.version}`, '필지 원천을 조회하지 않았습니다.'] }
  if (!value || input.issue) {
    result.status = 'invalid'; result.format = 'invalid'; result.errors.push(error(input.issue ?? 'EMPTY_INPUT')); return result
  }
  if (options.level === 'custom') {
    result.output = outputOf(result, undefined, undefined, options, byCode)
    result.evidence.push('사용자 지정 문자열 작업; 코드 사전·PNU 형식을 검증하지 않음')
    return result
  }
  if (/^\d+(?:\.\d+)?[eE][+-]?\d+$/.test(value) || /^\d{16,}\.0+$/.test(value)) {
    result.status = 'invalid'; result.format = 'invalid'; result.errors.push(error('IDENTIFIER_PRECISION_LOSS')); return result
  }
  if (options.inputType === 'auto' && /^\d{5}$/.test(value)) {
    result.status = 'needs_selection'; result.errors.push(error('AMBIGUOUS_CODE_SYSTEM')); return result
  }
  let region: LinkRegion | undefined, parts: PnuParts | undefined
  if (inputType === 'pnu') {
    const parsed = parsePnu(value)
    if (!parsed.parts) { result.status = 'invalid'; result.format = 'invalid'; result.errors.push(parsed.error!); return result }
    parts = parsed.parts; result.format = 'valid'; result.pnu = value; result.regionCode = parts.regionCode
    region = byCode.get(parts.regionCode)
    result.evidence.push('PNU 19자리: 법정동 10 + 일반·산 1 + 본번 4 + 부번 4 분해')
  } else if (inputType === 'code') {
    if (!/^\d+$/.test(value) || ![2, 5, 8, 10].includes(value.length)) {
      result.status = 'invalid'; result.format = 'invalid'; result.errors.push(error(/^\d+$/.test(value) ? 'REGION_CODE_LENGTH' : 'IDENTIFIER_CHARACTERS')); return result
    }
    result.format = 'valid'; result.regionCode = value
    const matching = value.length === 10 ? [byCode.get(value)].filter(Boolean) as LinkRegion[] : addressIndex(snapshot).get(`#${value.length}:${value}`) ?? []
    const active = matching.filter(r => r.status === 'active'), choices = active.length ? active : matching
    const selected = options.selections?.[input.id]
    if (selected && !choices.some(r => r.code === selected)) { result.status = 'invalid'; result.errors.push(error('SELECTION_INVALID')); return result }
    region = selected ? choices.find(r => r.code === selected) : choices.length === 1 ? choices[0] : undefined
    if (!region && choices.length) { result.status = 'needs_selection'; result.candidates = choices.map(candidate); result.errors.push(error('AMBIGUOUS_REGION')); return result }
    result.evidence.push(value.length === 10 ? '입력 10자리 전체 코드의 사전 정확 일치 조회' : `${value.length}자리 접두 코드: 대응하는 전체 코드의 실제 사전 등록 여부 별도 확인`)
    if (region) result.regionCode = region.code
  } else {
    // 숫자가 들어간 법정동명은 지역 토큰에 남긴다. 지번 뒤 문자는 지원하지 않고 원문을 보존한다.
    const match = /^(.*?)\s+(산\s*)?(\d{1,4})(?:\s*-\s*(\d{1,4}))?(?:\s*번지)?$/.exec(compact(value))
    if (!match || /\d+\s*(?:동|호)(?:\s|$)|[()]/.test(value)) {
      result.status = 'invalid'; result.format = 'invalid'; result.unparsed = value
      result.errors.push(error(/(?:로|길)\s+\d|\d+호|[()]/.test(value) ? 'UNSUPPORTED_ADDRESS' : 'UNPARSED_ADDRESS')); return result
    }
    const regionText = canonicalName(match[1]!), main = match[3]!.padStart(4, '0'), sub = (match[4] ?? '0').padStart(4, '0'), landType = match[2] ? '2' : '1'
    const parsed = parsePnu(`0000000000${landType}${main}${sub}`)
    if (!parsed.parts) { result.status = 'invalid'; result.format = 'invalid'; result.errors.push(parsed.error!); return result }
    result.format = 'valid'; parts = parsed.parts
    const matches = addressIndex(snapshot).get(regionText) ?? []
    if (!matches.length && /(?:로|길)\s+(?:산\s*)?\d/.test(value)) {
      result.status = 'invalid'; result.format = 'invalid'; result.unparsed = value; result.errors.push(error('UNSUPPORTED_ADDRESS')); return result
    }
    const active = matches.filter(r => r.status === 'active')
    // 사이 단계(일반구 등)를 뺀 이름: 최하위 이름이 같은 현존 구역 중 입력한 이름을 순서대로 모두 포함하는 곳 (예: 부천시 중동 → 부천시 원미구 중동)
    const words = regionText.split(' ')
    const loose = active.length || words.length < 2 ? [] : (addressIndex(snapshot).get(words.at(-1)!) ?? []).filter(r => r.status === 'active' && inOrder(r.fullName.split(' '), words))
    let choices = active.length ? active : loose.length ? loose : matches
    const riParents = choices.filter(r => r.level === 'eupmyeondong' && /[읍면]$/.test(r.name))
    const riChoices = riParents.flatMap(p => addressIndex(snapshot).get(`@${p.code}`) ?? []).filter(r => r.status === 'active')
    if (riChoices.length) choices = riChoices
    const selected = options.selections?.[input.id]
    if (selected && !choices.some(r => r.code === selected)) { result.status = 'invalid'; result.errors.push(error('SELECTION_INVALID')); return result }
    // 이름이 하나뿐인 현존 구역은 빠진 상위·사이 단계를 사전에서 채운다. 같은 이름이 여럿이거나 리가 필요하면 후보를 고르게 한다
    const only = choices.length === 1 && (choices[0]!.fullName === regionText || (choices[0]!.status === 'active' && !riChoices.length)) ? choices[0] : undefined
    region = selected ? choices.find(r => r.code === selected) : only
    if (!region && choices.length) {
      result.status = 'needs_selection'; result.candidates = choices.map(candidate); result.errors.push(error(riChoices.length ? 'MISSING_RI' : 'AMBIGUOUS_REGION')); result.unparsed = match[1]!
      result.evidence.push('법정구역 경로·최하위 이름의 토큰 경계 일치; 같은 이름의 여러 구역은 자동 선택하지 않음')
      return result
    }
    const old = OLD_SIDO.exec(compact(match[1]!))
    if (old) result.warnings.push(`옛 시도명 ${old[1]}을(를) 현재 명칭 ${SIDO_ALIASES[old[1]!]}(으)로 해석했습니다.`)
    if (region && !selected && region.fullName !== regionText) result.warnings.push(`입력에 없는 지역 단계를 사전에서 채웠습니다: ${region.fullName}`)
    if (region) { result.regionCode = region.code; result.pnu = `${region.code}${landType}${main}${sub}`; result.candidateId = selected }
    else result.unparsed = match[1]!
    result.evidence.push('법정구역 경로 정확 일치 + 지번 본번·부번; 필지 존재를 확인하지 않은 PNU 형식 조합')
  }
  const renamed = region?.status === 'retired' ? successor(region, byCode) : undefined
  if (region && renamed) {
    result.warnings.push(`폐지 코드 ${region.code}(${region.fullName})를 시도 명칭 변경에 따른 현재 코드 ${renamed.code}(${renamed.fullName})로 바꿨습니다.`)
    region = renamed; result.regionCode = renamed.code
    if (parts) parts = { ...parts, regionCode: renamed.code }
    if (result.pnu) result.pnu = renamed.code + result.pnu.slice(10)
  }
  if (!snapshot.available) { result.status = 'unavailable'; result.errors.push(error('SOURCE_UNAVAILABLE')) }
  else if (!region) { result.status = snapshot.coverage === 'partial' ? 'unavailable' : 'not_found'; result.code = 'unknown'; result.errors.push(error(snapshot.coverage === 'partial' ? 'OUT_OF_COVERAGE' : 'REGION_NOT_FOUND')) }
  else {
    result.code = region.status
    if (region.status === 'retired') { result.status = 'not_found'; result.errors.push(error('REGION_RETIRED')) }
    result.address = [region.fullName, parts?.parcel].filter(Boolean).join(' ')
  }
  if (snapshot.coverage === 'fixture') result.warnings.push('테스트 fixture 사전입니다. 운영 전국 사전이 아닙니다.')
  if (snapshot.warning) result.warnings.push(snapshot.warning)
  if (!parts && (options.level === 'pnu' || options.level === 'parcel')) result.warnings.push('지역코드만으로 지번·전체 PNU를 만들지 않았습니다. 지번주소 또는 PNU 입력이 필요합니다.')
  result.output = outputOf(result, region, parts, options, byCode)
  return result
}

export function resolveRows(inputs: InputRow[], provided: Partial<LinkOptions>, snapshot: ReferenceSnapshot): LinkBatch {
  const options = linkOptionsSchema.parse({ ...defaultOptions, ...provided })
  if (options.inputType === 'administrative' || options.inputType === 'location' || options.target === 'administrative_region' || options.target === 'location' || options.target === 'legal_boundary' || options.target === 'all') throw new Error('행정동·위치·경계·전체 결과는 해당 원천을 확인하는 공통 서비스로 처리해야 합니다.')
  const byCode = new Map(snapshot.regions.map(r => [r.code, r])), seen = new Set<string>()
  const rows: LinkResult[] = []
  let omittedDuplicates = 0
  for (const input of inputs) {
    if (options.deduplicate && seen.has(input.value)) { omittedDuplicates++; continue }
    seen.add(input.value)
    const row = resolveOne(input, options, snapshot, byCode)
    if (options.expandCandidates && row.candidates.length) {
      for (const item of row.candidates) {
        const selected = resolveOne(input, { ...options, selections: { ...options.selections, [input.id]: item.id } }, snapshot, byCode)
        selected.id = `${input.id}:${item.id}`; selected.candidateId = item.id; selected.warnings.push('사용자가 요청한 후보 펼치기 결과입니다. 자동 확정이 아닙니다.')
        rows.push(selected)
      }
    } else rows.push(row)
  }
  const summary: LinkBatch['summary'] = { ok: 0, needs_selection: 0, invalid: 0, not_found: 0, unavailable: 0, total: rows.length, input: inputs.length, omittedDuplicates }
  const counts: Record<string, number> = {}
  for (const row of rows) { summary[row.status]++; for (const item of row.errors) counts[item.code] = (counts[item.code] ?? 0) + 1 }
  return { schemaVersion: '1', ruleVersion: 'geo-link-v1', version: snapshot.version, reference: referenceMetadata(snapshot), options, rows, summary, errors: counts }
}
