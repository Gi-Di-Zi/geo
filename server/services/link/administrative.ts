import { administrativeForLegal, legalForAdministrative } from '../../../shared/link/administrative.ts'
import type { AdministrativeSnapshot } from '../../../shared/link/administrative.ts'
import { resolveRows } from '../../../shared/link/core.ts'
import { linkOptionsSchema } from '../../../shared/link/types.ts'
import type { InputRow, LinkBatch, LinkOptions, LinkResult, ReferenceSnapshot } from '../../../shared/link/types.ts'

function issue(row: LinkResult, code: string, message: string, status: LinkResult['status'] = 'unavailable') {
  row.status = status; row.errors.push({ code, message }); return row
}
function empty(input: InputRow): LinkResult {
  return { id: input.id, inputId: input.id, original: { ...input.original }, value: input.value, inputType: 'administrative', codeSystem: 'administrative_region',
    status: 'ok', format: 'valid', code: 'not_checked', parcel: 'not_checked', errors: [], warnings: [], candidates: [], unparsed: '', pnu: '', regionCode: '', address: '', output: {}, evidence: ['행정동코드는 주민센터 관할 기준입니다. 법정동코드·필지 존재와 구분합니다.'] }
}
function administrativeOutput(row: LinkResult, code: string, name: string, options: LinkOptions) {
  row.output = { code_kind: 'administrative_region', registered_code: code }
  if (options.output !== 'name') row.output.code = code
  if (options.output !== 'code') row.output.name = name
}

/** 공식 법정동·행정동 관계만 사용한다. PNU의 지번으로 관할 행정동을 추측하지 않는다. */
export function resolveAdministrativeRows(inputs: InputRow[], provided: Partial<LinkOptions>, legal: ReferenceSnapshot, admin: AdministrativeSnapshot): LinkBatch {
  const options = linkOptionsSchema.parse(provided)
  const version = legal.version + '+' + admin.version
  const adminByCode = new Map(admin.regions.map(region => [region.code, region]))
  const legalByCode = new Map(legal.regions.map(region => [region.code, region]))
  const relationMissing = (row: LinkResult) => issue(row, 'RELATION_NOT_AVAILABLE', '확보한 공식 자료에 검증된 법정동·행정동 관계가 없습니다. 다른 코드를 추측하지 않습니다.')
  function fromAdministrative(input: InputRow, current: LinkOptions) {
    const row = empty(input), value = input.value.trim()
    if (!value || input.issue) {
      row.format = 'invalid'
      return issue(row, input.issue || 'EMPTY_INPUT', !value ? '빈 입력입니다.' : '숫자 정밀도 또는 수식 셀을 확인하세요. 원문을 임의로 복구하지 않습니다.', 'invalid')
    }
    if (!/^\d{10}$/.test(value)) {
      row.format = 'invalid'
      return issue(row, /^\d+$/.test(value) ? 'ADMINISTRATIVE_CODE_LENGTH' : 'IDENTIFIER_CHARACTERS', '행정안전부 행정동코드는 10자리 숫자 문자열입니다. 기관코드·통계청 코드를 자동 변환하지 않습니다.', 'invalid')
    }
    row.regionCode = value
    if (!admin.available) return issue(row, 'ADMINISTRATIVE_SOURCE_NOT_READY', '행정동 기준 자료가 준비되지 않았습니다.')
    const region = adminByCode.get(value)
    if (!region) { row.code = 'unknown'; return issue(row, 'ADMINISTRATIVE_CODE_UNKNOWN', '행정동 사전에 등록되지 않은 코드입니다.', 'not_found') }
    row.code = region.status; row.address = region.fullName
    if (region.status === 'retired') return issue(row, 'ADMINISTRATIVE_CODE_RETIRED', '말소된 행정동코드입니다. 현재 코드로 자동 변경하지 않습니다.', 'not_found')
    const target = current.target || 'address'
    if (target === 'address' || target === 'administrative_region') {
      administrativeOutput(row, region.code, current.addressStyle === 'leaf' ? region.name : region.fullName, current)
      return row
    }
    if (target === 'pnu' || current.level === 'pnu' || current.level === 'parcel') return issue(row, 'PARCEL_REQUIRED', '행정동코드만으로 토지의 지번과 전체 PNU를 만들 수 없습니다. 주소 또는 PNU를 입력하세요.')
    if (!legal.available) return issue(row, 'SOURCE_UNAVAILABLE', '법정구역 기준 자료가 준비되지 않았습니다.')
    const relations = legalForAdministrative(region.code, admin)
    if (!relations.length) return relationMissing(row)
    const length = { sido: 2, sigungu: 5, eupmyeondong: 8, ri: 10 }[current.level as 'sido' | 'sigungu' | 'eupmyeondong' | 'ri']
    if (!length) return issue(row, 'UNSUPPORTED_PROJECTION', '행정동의 법정동 연결은 시도·시군구·읍면동·동리 단위를 선택하세요.', 'invalid')
    const choices = [...new Map(relations.map(relation => [relation.legalCode.slice(0, length), relation])).values()]
    const selected = current.selections?.[input.id]
    if (selected && !relations.some(relation => relation.legalCode === selected)) return issue(row, 'SELECTION_INVALID', '선택한 법정동이 해당 행정동의 공식 관계에 없습니다.', 'invalid')
    const relation = selected ? relations.find(item => item.legalCode === selected) : choices.length === 1 ? choices[0] : undefined
    if (!relation) {
      row.candidates = choices.map(item => ({ id: item.legalCode, code: item.legalCode.slice(0, length), name: item.legalName, status: 'active', level: length === 2 ? 'sido' : length === 5 ? 'sigungu' : length === 8 ? 'eupmyeondong' : 'ri' }))
      return issue(row, 'AMBIGUOUS_LEGAL_REGION', '행정동에 여러 법정구역이 연결됩니다. 필요한 법정구역을 선택하세요.', 'needs_selection')
    }
    const entry = legalByCode.get(relation.legalCode)
    if (!entry || entry.status !== 'active') return issue(row, 'REFERENCE_VERSION_MISMATCH', '행정동 관계와 현재 법정동 사전의 기준 버전이 달라 이 법정동의 현재 상태를 확인하지 못했습니다.')
    const linked = resolveRows([{ ...input, value: relation.legalCode }], { ...current, inputType: 'code', target: 'legal_region', selections: undefined, expandCandidates: false }, legal).rows[0]!
    linked.value = input.value; linked.original = { ...input.original }; linked.inputType = 'administrative'; linked.codeSystem = 'administrative_region'; linked.pnu = ''
    linked.candidateId = selected; linked.address = region.fullName
    linked.regionCode = linked.output.registered_code || relation.legalCode
    linked.evidence.push('공식 행정동·법정동 관계를 요청한 단위로 투영했습니다. 같은 접두 결과는 하나로 묶었습니다.')
    return linked
  }
  function fromLegal(input: InputRow, current: LinkOptions) {
    const selected = current.selections?.[input.id], pair = selected?.includes('|') ? selected.split('|') : undefined
    const baseSelections = { ...current.selections }
    if (pair && pair.length > 1) baseSelections[input.id] = pair[0]!
    const row = resolveRows([input], { ...current, target: undefined, selections: baseSelections, expandCandidates: false }, legal).rows[0]!
    if (row.status !== 'ok') return row
    if (selected && !pair && selected !== row.regionCode) return issue(row, 'SELECTION_INVALID', '선택한 법정동이 입력의 법정동코드와 다릅니다.', 'invalid')
    // 법정코드 형식 검증 뒤에도 해당 필지의 개별 행정동은 확정하지 않는다.
    row.output = {}; row.candidates = []
    if (!admin.available) return issue(row, 'ADMINISTRATIVE_SOURCE_NOT_READY', '행정동 기준 자료가 준비되지 않았습니다.')
    const choices = administrativeForLegal(row.regionCode, admin)
    if (!choices.length) return relationMissing(row)
    if (pair && (pair.length !== 2 || pair[0] !== row.regionCode || !choices.some(choice => choice.code === pair[1]))) return issue(row, 'SELECTION_INVALID', '선택한 행정동이 해당 법정동의 공식 관계에 없습니다.', 'invalid')
    const region = pair ? choices.find(choice => choice.code === pair[1]) : choices.length === 1 ? choices[0] : undefined
    if (!region) {
      row.candidates = choices.map(choice => ({ id: row.regionCode + '|' + choice.code, code: choice.code, name: choice.fullName, status: choice.status, level: choice.level }))
      return issue(row, 'AMBIGUOUS_ADMINISTRATIVE_REGION', '법정동에 여러 행정동이 연결됩니다. 개별 필지의 관할을 확정하지 않고 후보로 표시합니다.', 'needs_selection')
    }
    row.code = region.status; row.candidateId = selected
    administrativeOutput(row, region.code, current.addressStyle === 'leaf' ? region.name : region.fullName, current)
    row.evidence.push('공식 법정동·행정동 관계의 정확한 코드 일치 조회; 필지별 관할 확인 아님')
    return row
  }
  function one(input: InputRow, current: LinkOptions) {
    const row = current.inputType === 'administrative' ? fromAdministrative(input, current) : fromLegal(input, current)
    row.evidence.push('법정동 기준 ' + legal.version, '행정동·관계 기준 ' + admin.version)
    if (admin.warning) row.warnings.push(admin.warning)
    row.parcel = 'not_checked'
    return row
  }
  const rows: LinkResult[] = [], seen = new Set<string>()
  let omittedDuplicates = 0
  for (const input of inputs) {
    if (options.deduplicate && seen.has(input.value)) { omittedDuplicates++; continue }
    seen.add(input.value)
    const row = one(input, options)
    if (options.expandCandidates && row.candidates.length) {
      for (const candidate of row.candidates) {
        const expanded = one(input, { ...options, selections: { ...options.selections, [input.id]: candidate.id }, expandCandidates: false })
        expanded.id = input.id + ':' + candidate.id; expanded.candidateId = candidate.id
        expanded.warnings.push('사용자가 요청한 후보 펼침이며 개별 필지 관할의 자동 확정이 아닙니다.')
        rows.push(expanded)
      }
    } else rows.push(row)
  }
  const summary: LinkBatch['summary'] = { ok: 0, needs_selection: 0, invalid: 0, not_found: 0, unavailable: 0, total: rows.length, input: inputs.length, omittedDuplicates }
  const errors: Record<string, number> = {}
  for (const row of rows) { summary[row.status]++; for (const item of row.errors) errors[item.code] = (errors[item.code] || 0) + 1 }
  return { schemaVersion: '1', ruleVersion: 'geo-link-v1', version, options, rows, summary, errors,
    reference: { version, available: admin.available, source: admin.source + ' / ' + legal.source, sourceUrl: admin.sourceUrl, sourceDate: admin.sourceDate, checkedAt: admin.checkedAt, activatedAt: null, coverage: admin.coverage, count: admin.regions.length, warning: '행정동·관할 관계와 법정동 사전은 서로 다른 기준 버전을 함께 사용합니다.' } }
}
