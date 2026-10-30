import type { InputRow, LinkBatch, LinkOptions, LinkResult, ReferenceSnapshot } from '../../../shared/link/types.ts'
import type { AdministrativeSnapshot } from '../../../shared/link/administrative.ts'
import { linkOptionsSchema } from '../../../shared/link/types.ts'
import { resolveRows, referenceMetadata } from '../../../shared/link/core.ts'
import { formatLocation, LocationError, parseLocation, transformLocation } from '../../../shared/link/location.ts'
import { forwardLocation, reverseLocation, LOCATION_SOURCE } from './location.ts'
import { resolveAdministrativeRows } from './administrative.ts'
import { LinkServiceError } from './files.ts'

/** 위치 원천은 별도 조회하며 구역 대표점을 필지 좌표로 승격하지 않는다. */
export async function resolveLocationRows(inputs: InputRow[], provided: Partial<LinkOptions>, legal: ReferenceSnapshot, administrative: AdministrativeSnapshot,
  provider = { forwardLocation, reverseLocation }): Promise<LinkBatch> {
  if (inputs.length > 20) throw new LinkServiceError('LOCATION_ROW_LIMIT', '위치 조회는 한 번에 20개까지 가능합니다.', 413)
  const options = linkOptionsSchema.parse(provided), { target, ...coreOptions } = options
  const rows: LinkResult[] = []
  for (const input of inputs) {
    let row: LinkResult = { id: input.id, inputId: input.id, original: { ...input.original }, value: input.value, inputType: options.inputType === 'location' ? 'location' : 'address', codeSystem: options.inputType === 'location' ? 'location' : 'pnu', status: 'ok', format: 'valid', code: 'not_checked', parcel: 'not_checked', errors: [], warnings: [], candidates: [], unparsed: '', pnu: '', regionCode: '', address: '', output: {}, evidence: [] }
    try {
      if (input.issue) throw new LocationError(input.issue, '손상된 입력은 위치로 해석하지 않습니다.')
      if (options.inputType === 'location') {
        const point = parseLocation(input.value, options.sourceCrs || 'EPSG:4326')
        if (target === 'location') {
          const result = transformLocation(point, options.outputCrs || 'EPSG:4326')
          row.output = { code: formatLocation(result), x: String(result.x), y: String(result.y), crs: result.crs, code_kind: 'location', location_method: 'input_point' }
          row.evidence.push('사용자 입력 좌표의 좌표계 변환. 주소·관할 원천을 조회하지 않았습니다.')
        } else {
          const found = await provider.reverseLocation(point)
          if (target === 'address') {
            row.address = found.address; row.regionCode = found.legalCode || ''
            row.output = { name: found.address, code_kind: 'reverse_geocoded_address' }
          } else if (target === 'administrative_region') {
            if (found.administrativeCode) {
              row = resolveAdministrativeRows([{ ...input, value: found.administrativeCode }], { ...options, inputType: 'administrative', target }, legal, administrative).rows[0]!
              if (row.status === 'not_found') { row.status = 'unavailable'; row.output = {}; row.errors = [{ code: 'REFERENCE_VERSION_MISMATCH', message: '위치 원천의 행정동코드를 현재 사전에서 확인하지 못했습니다.' }] }
            } else if (found.legalCode) row = resolveAdministrativeRows([{ ...input, value: found.legalCode }], { ...options, inputType: 'code', target }, legal, administrative).rows[0]!
            else throw new LocationError('GEOCODER_CODE_UNAVAILABLE', '위치 원천에서 행정동·법정동코드를 확인하지 못했습니다.', 'unavailable')
          } else if (target === 'pnu') {
            if (!found.parcelAddress) throw new LocationError('PARCEL_ADDRESS_UNAVAILABLE', '위치 원천이 확정된 지번주소를 제공하지 않아 PNU를 만들 수 없습니다.', 'unavailable')
            row = resolveRows([{ ...input, value: found.parcelAddress }], { ...coreOptions, inputType: 'address', target: 'pnu' }, legal).rows[0]!
          } else {
            if (!found.legalCode) throw new LocationError('GEOCODER_CODE_UNAVAILABLE', '위치 원천에서 법정동코드를 확인하지 못했습니다. 도로명코드를 대신 사용하지 않습니다.', 'unavailable')
            row = resolveRows([{ ...input, value: found.legalCode }], { ...coreOptions, inputType: 'code', target: 'legal_region' }, legal).rows[0]!
            if (row.status === 'not_found') { row.status = 'unavailable'; row.output = {}; row.errors = [{ code: 'REFERENCE_VERSION_MISMATCH', message: '위치 원천의 법정동코드를 현재 사전에서 확인하지 못했습니다.' }] }
          }
          row.inputType = 'location'; row.codeSystem = 'location'; row.value = input.value; row.original = { ...input.original }
          row.evidence.push(found.source + '; 조회 시각 ' + found.checkedAt); row.warnings.push(found.warning)
        }
      } else {
        if (options.inputType === 'administrative') row = resolveAdministrativeRows([input], { ...options, target: 'address', output: 'name' }, legal, administrative).rows[0]!
        else row = resolveRows([input], { ...coreOptions, target: 'address', level: 'pnu', output: 'name' }, legal).rows[0]!
        let address = row.address, kind: 'parcel' | 'road' | 'region' = row.pnu ? 'parcel' : 'region'
        // 도로명은 원천의 도로명 주소 조회로만 처리한다.
        if (row.status === 'invalid' && options.inputType === 'address' && /(?:로|길)\s+\d/.test(input.value)) { address = input.value; kind = 'road'; row.status = 'ok'; row.errors = []; row.format = 'valid' }
        if (row.status === 'ok') {
          const found = await provider.forwardLocation(address, kind), result = transformLocation(found, options.outputCrs || 'EPSG:4326')
          row.output = { code: formatLocation(result), x: String(result.x), y: String(result.y), crs: result.crs, longitude: String(found.lon), latitude: String(found.lat), code_kind: 'location', location_method: found.method }
          row.evidence.push(found.source + '; 조회 시각 ' + found.checkedAt); row.warnings.push(found.warning)
        } else row.output = {}
      }
    } catch (error) {
      row.output = {}; row.status = error instanceof LocationError ? error.status : 'unavailable'
      row.format = row.status === 'invalid' ? 'invalid' : row.format
      row.errors = [{ code: error instanceof LocationError ? error.code : 'LOCATION_UNAVAILABLE', message: error instanceof LocationError ? error.message : '위치 원천을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.' }]
    }
    row.parcel = 'not_checked'; rows.push(row)
  }
  const summary: LinkBatch['summary'] = { ok: 0, needs_selection: 0, invalid: 0, not_found: 0, unavailable: 0, total: rows.length, input: inputs.length, omittedDuplicates: 0 }, errors: Record<string, number> = {}
  for (const row of rows) { summary[row.status]++; for (const error of row.errors) errors[error.code] = (errors[error.code] || 0) + 1 }
  const projectionOnly = options.inputType === 'location' && target === 'location'
  return { schemaVersion: '1', ruleVersion: 'geo-link-v1', version: projectionOnly ? 'proj4-2.22.0' : legal.version + '+' + administrative.version + '+vworld-geocoder-2', options, rows, summary, errors,
    reference: projectionOnly ? { version: 'proj4-2.22.0', available: true, source: 'Proj4js · EPSG 좌표계 정의', sourceUrl: 'https://github.com/proj4js/proj4js', sourceDate: null, checkedAt: null, activatedAt: null, coverage: 'none', count: 0 }
      : { ...referenceMetadata(legal), source: legal.source + ' / ' + LOCATION_SOURCE, warning: '좌표계 변환과 주소·관할 조회는 별개입니다. 위치 원천이 제공한 주소·대표점의 의미를 확인하세요.' } }
}
