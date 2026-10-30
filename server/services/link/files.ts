import ExcelJS from 'exceljs-community'
import { crc32, inflateRawSync } from 'node:zlib'
import type { InputRow, LinkBatch } from '../../../shared/link/types.ts'

function limit(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}
export const linkLimits = {
  bytes: limit('LINK_UPLOAD_BYTES', 20 * 1024 ** 2),
  uncompressedBytes: limit('LINK_UNCOMPRESSED_BYTES', 40 * 1024 ** 2),
  rows: limit('LINK_MAX_ROWS', 50_000),
  columns: limit('LINK_MAX_COLUMNS', 200),
  syncRows: limit('LINK_SYNC_ROWS', 200),
  ttlMs: limit('LINK_JOB_TTL_MS', 24 * 3600_000),
  timeoutMs: limit('LINK_JOB_TIMEOUT_MS', 120_000),
  concurrency: limit('LINK_JOB_CONCURRENCY', 2),
  queuedJobs: limit('LINK_MAX_QUEUED_JOBS', 20),
  resultRows: limit('LINK_MAX_RESULT_ROWS', 100_000),
  resultBytes: limit('LINK_MAX_RESULT_BYTES', 60 * 1024 ** 2),
}
export class LinkServiceError extends Error {
  code: string
  statusCode: number
  constructor(code: string, message: string, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode }
}
export interface InputSheet { name: string; rows: string[][]; issues: Record<string, string> }
export interface InputBook { sheets: InputSheet[]; encoding: string; name: string }
export interface FileSettings { sheet?: string; headerRow?: boolean | number; column?: number; encoding?: 'utf-8' | 'euc-kr' }
function validateBook(book: InputBook) {
  for (const sheet of book.sheets) for (const row of sheet.rows) {
    if (row.some(value => value.length > 10_000) || Buffer.byteLength(JSON.stringify(row)) > 64 * 1024) throw new LinkServiceError('ROW_TOO_LARGE', '입력 셀은 10,000자·행은 64KB 이내여야 합니다.', 413)
  }
  return book
}

export function parseDelimited(text: string, delimiter = text.includes('\t') ? '\t' : ','): string[][] {
  if (text.length > linkLimits.uncompressedBytes) throw new LinkServiceError('FILE_TOO_LARGE', '입력 텍스트가 한도를 넘었습니다.', 413)
  const rows: string[][] = [], row: string[] = []
  let value = '', quoted = false, afterQuote = false
  const cell = () => { row.push(value); value = ''; afterQuote = false; if (row.length > linkLimits.columns) throw new LinkServiceError('TOO_MANY_COLUMNS', '열 수 한도를 넘었습니다.') }
  const line = () => { cell(); rows.push(row.splice(0)); if (rows.length > linkLimits.rows + 1) throw new LinkServiceError('TOO_MANY_ROWS', '행 수 한도를 넘었습니다.', 413) }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i++ }
      else if (ch === '"') { quoted = false; afterQuote = true }
      else value += ch
    }
    else if (ch === delimiter) cell()
    else if (ch === '\r' || ch === '\n') { line(); if (ch === '\r' && text[i + 1] === '\n') i++ }
    else if (ch === '"' && value === '' && !afterQuote) quoted = true
    else if (afterQuote || ch === '"') throw new LinkServiceError('INVALID_CSV', 'CSV 따옴표 구문이 잘못되었습니다.')
    else value += ch
  }
  if (quoted) throw new LinkServiceError('INVALID_CSV', '닫히지 않은 CSV 따옴표입니다.')
  if (value || row.length || (text.length && !/[\r\n]$/.test(text))) line()
  return rows
}

/** 압축 해제 전에 중앙 디렉터리 크기·경로·암호화를 검사한다. */
export function checkXlsxZip(data: Buffer) {
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new LinkServiceError('INVALID_XLSX', 'XLSX ZIP 구조가 아닙니다.')
  const entries = data.readUInt16LE(end + 10), offset = data.readUInt32LE(end + 16)
  if (entries === 65535 || entries > 3000 || offset >= end) throw new LinkServiceError('INVALID_XLSX', 'ZIP64 또는 과도한 항목은 지원하지 않습니다.')
  let cursor = offset, total = 0
  const names = new Set<string>()
  for (let n = 0; n < entries; n++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw new LinkServiceError('INVALID_XLSX', 'XLSX ZIP 항목이 손상되었습니다.')
    const flags = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10), compressed = data.readUInt32LE(cursor + 20), size = data.readUInt32LE(cursor + 24), local = data.readUInt32LE(cursor + 42)
    const nameSize = data.readUInt16LE(cursor + 28), extraSize = data.readUInt16LE(cursor + 30), commentSize = data.readUInt16LE(cursor + 32)
    const name = data.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8')
    if (flags & 1 || size === 0xffffffff || compressed === 0xffffffff || /(^|[\\/])\.\.([\\/]|$)|^[/\\]|:/.test(name) || names.has(name)) throw new LinkServiceError('INVALID_XLSX', '암호화·중복 또는 안전하지 않은 XLSX 항목입니다.')
    names.add(name)
    if (/vbaProject|externalLinks\//i.test(name)) throw new LinkServiceError('UNSUPPORTED_WORKBOOK', '매크로·외부 링크가 있는 통합문서는 지원하지 않습니다.')
    total += size
    if (total > linkLimits.uncompressedBytes) throw new LinkServiceError('FILE_TOO_LARGE', '압축 해제 크기 한도를 넘었습니다.', 413)
    if (![0, 8].includes(method) || local + 30 > offset || data.readUInt32LE(local) !== 0x04034b50 || data.readUInt16LE(local + 8) !== method) throw new LinkServiceError('INVALID_XLSX', '지원하지 않는 XLSX 압축 항목입니다.')
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
    if (start + compressed > offset) throw new LinkServiceError('INVALID_XLSX', 'XLSX 압축 항목 범위가 잘못되었습니다.')
    let actual: Buffer
    try { actual = method === 8 ? inflateRawSync(data.subarray(start, start + compressed), { maxOutputLength: Math.max(1, size) }) : data.subarray(start, start + compressed) }
    catch { throw new LinkServiceError('INVALID_XLSX', 'XLSX 압축 해제 크기 또는 내용이 잘못되었습니다.') }
    if (actual.length !== size || crc32(actual) !== data.readUInt32LE(cursor + 16)) throw new LinkServiceError('INVALID_XLSX', 'XLSX 항목 크기·체크섬이 일치하지 않습니다.')
    cursor += 46 + nameSize + extraSize + commentSize
    if (cursor > end) throw new LinkServiceError('INVALID_XLSX', 'XLSX ZIP 항목 길이가 잘못되었습니다.')
  }
}

export async function readInputFile(name: string, data: Buffer, encoding?: FileSettings['encoding']): Promise<InputBook> {
  if (data.length > linkLimits.bytes) throw new LinkServiceError('FILE_TOO_LARGE', '업로드 크기 한도를 넘었습니다.', 413)
  if (/\.csv$/i.test(name)) {
    let text: string, used = encoding || 'utf-8'
    try { text = new TextDecoder(used, { fatal: true }).decode(data) }
    catch {
      if (encoding) throw new LinkServiceError('INVALID_ENCODING', `${used}로 읽을 수 없습니다.`)
      used = 'euc-kr'
      try { text = new TextDecoder(used, { fatal: true }).decode(data) }
      catch { throw new LinkServiceError('INVALID_ENCODING', 'UTF-8 또는 EUC-KR CSV가 아닙니다.') }
    }
    return validateBook({ name: name.slice(0, 200), encoding: used, sheets: [{ name: 'CSV', rows: parseDelimited(text.replace(/^\uFEFF/, ''), ','), issues: {} }] })
  }
  if (!/\.xlsx$/i.test(name)) throw new LinkServiceError('UNSUPPORTED_FILE', 'CSV·XLSX 파일만 지원합니다.')
  checkXlsxZip(data)
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(data as never) }
  catch { throw new LinkServiceError('INVALID_XLSX', 'XLSX 통합문서를 읽을 수 없습니다.') }
  let totalRows = 0
  const sheets: InputSheet[] = []
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > linkLimits.rows + 1 || sheet.columnCount > linkLimits.columns) throw new LinkServiceError('TOO_MANY_ROWS', '행·열 수 한도를 넘었습니다.', 413)
    const rows: string[][] = [], issues: Record<string, string> = {}
    for (let r = 1; r <= sheet.rowCount; r++) {
      if (++totalRows > linkLimits.rows + 1) throw new LinkServiceError('TOO_MANY_ROWS', '전체 시트 행 수 한도를 넘었습니다.', 413)
      const row: string[] = []
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = sheet.getCell(r, c), raw = cell.value
        let value = ''
        if (typeof raw === 'number') {
          value = String(raw)
          if (!Number.isSafeInteger(raw) || value.replace(/\D/g, '').length > 15) issues[`${r - 1}:${c - 1}`] = 'IDENTIFIER_PRECISION_LOSS'
        }
        else if (raw && typeof raw === 'object' && 'formula' in raw) { value = `=${raw.formula}`; issues[`${r - 1}:${c - 1}`] = 'FORMULA_NOT_EVALUATED' }
        else if (raw && typeof raw === 'object' && 'sharedFormula' in raw) { value = `=${raw.sharedFormula}`; issues[`${r - 1}:${c - 1}`] = 'FORMULA_NOT_EVALUATED' }
        else value = cell.text
        row.push(value)
      }
      rows.push(row)
    }
    sheets.push({ name: sheet.name, rows, issues })
  }
  if (!sheets.length) throw new LinkServiceError('EMPTY_WORKBOOK', '시트가 없는 파일입니다.')
  return validateBook({ name: name.slice(0, 200), encoding: 'xlsx', sheets })
}

export function selectedSheet(book: InputBook, settings: FileSettings = {}) {
  const sheet = settings.sheet ? book.sheets.find(s => s.name === settings.sheet) : book.sheets[0]
  if (!sheet) throw new LinkServiceError('INVALID_SHEET', '선택한 시트가 없습니다.')
  const width = sheet.rows.reduce((n, row) => Math.max(n, row.length), 1)
  const headerIndex = typeof settings.headerRow === 'number' ? settings.headerRow - 1 : 0
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= Math.max(1, sheet.rows.length)) throw new LinkServiceError('INVALID_HEADER_ROW', '헤더 행이 올바르지 않습니다.')
  const headers: string[] = []
  for (let i = 0; i < width; i++) {
    const base = settings.headerRow !== false ? sheet.rows[headerIndex]?.[i] || `열${i + 1}` : `열${i + 1}`
    let unique = base, n = 2
    while (headers.includes(unique)) unique = `${base}_${n++}`
    headers.push(unique)
  }
  const start = settings.headerRow !== false ? headerIndex + 1 : 0
  return { sheet, headers, start, rows: sheet.rows.slice(start) }
}
export function rowsFromBook(book: InputBook, settings: FileSettings = {}): InputRow[] {
  const selected = selectedSheet(book, settings), column = settings.column ?? 0
  if (!Number.isInteger(column) || column < 0 || column >= selected.headers.length) throw new LinkServiceError('INVALID_COLUMN', '입력 열이 올바르지 않습니다.')
  return selected.rows.map((row, i) => ({ id: `${selected.sheet.name}:${i + selected.start + 1}`, original: Object.fromEntries(selected.headers.map((key, c) => [key, row[c] || ''])), value: row[column] || '', issue: selected.sheet.issues[`${i + selected.start}:${column}`] }))
}
export function rowsFromText(text: string, settings: FileSettings = {}): InputRow[] {
  const rows = parseDelimited(text, text.includes('\t') ? '\t' : '\u0000')
  return rowsFromBook({ name: '직접 입력', encoding: 'utf-8', sheets: [{ name: '입력', rows, issues: {} }] }, { ...settings, headerRow: settings.headerRow ?? false })
}

export const safeSpreadsheetText = (value: string) => /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value
export function exportRecords(batch: LinkBatch) {
  const { selections, ...compactOptions } = batch.options
  return batch.rows.map(row => ({
    ...Object.fromEntries(Object.entries(row.original).map(([k, v]) => [`원본:${k}`, v])),
    input_id: row.inputId, candidate_id: row.candidateId || '', status: row.status, format_check: row.format, code_check: row.code, parcel_check: row.parcel,
    error_codes: row.errors.map(e => e.code).join('|'), error_messages: row.errors.map(e => e.message).join(' / '),
    warnings: row.warnings.join(' / '), unparsed: row.unparsed, reference_version: batch.version,
    candidates: JSON.stringify(row.candidates), evidence: row.evidence.join(' / '), source: batch.reference.source, source_url: batch.reference.sourceUrl,
    source_date: batch.reference.sourceDate || '', parcel_verification: 'not_checked',
    output_options: JSON.stringify(compactOptions), error_summary: JSON.stringify(batch.errors), ...row.output,
  }))
}
export async function exportBatch(batch: LinkBatch, format: string, selectedColumns?: string[]) {
  if (!['csv', 'xlsx', 'json'].includes(format)) throw new LinkServiceError('INVALID_EXPORT', 'CSV·XLSX·JSON 형식만 지원합니다.')
  const records = exportRecords(batch)
  const available = [...new Set(records.flatMap(r => Object.keys(r)))]
  if (selectedColumns?.some(c => !available.includes(c))) throw new LinkServiceError('INVALID_COLUMN', '존재하지 않는 출력 열입니다.')
  const selected = selectedColumns?.length ? [...new Set(selectedColumns)] : available
  const columns = format === 'csv' ? [...new Set([...selected, 'input_id', 'candidate_id', 'reference_version', 'output_options', 'error_summary'])] : selected
  const projected = records.map(r => Object.fromEntries(columns.map(c => [c, (r as Record<string, string>)[c] ?? ''])))
  if (format === 'json') return { data: Buffer.from(JSON.stringify({ ...batch, rows: projected }, null, 2)), mime: 'application/json; charset=utf-8', filename: 'geo-link.json' }
  if (format === 'csv') {
    const quote = (v: string) => `"${safeSpreadsheetText(v).replaceAll('"', '""')}"`
    const csv = [columns, ...projected.map(r => columns.map(c => r[c]!))].map(r => r.map(quote).join(',')).join('\r\n')
    return { data: Buffer.from('\uFEFF' + csv), mime: 'text/csv; charset=utf-8', filename: 'geo-link.csv' }
  }
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('결과')
  sheet.addRow(columns).eachCell(cell => { cell.numFmt = '@'; cell.quotePrefix = true })
  for (const record of projected) {
    const row = sheet.addRow(columns.map(c => record[c] || ''))
    row.eachCell(cell => { cell.numFmt = '@'; cell.quotePrefix = true })
  }
  const metadata = workbook.addWorksheet('처리정보')
  metadata.addRows([['기준 버전', batch.version], ['기준 자료', JSON.stringify(batch.reference)], ['출력 옵션', JSON.stringify(batch.options)], ['오류 요약', JSON.stringify(batch.errors)], ['상태별 건수', JSON.stringify(batch.summary)], ['확인 범위', '법정구역 사전 조회이며 실제 필지 존재는 확인하지 않았습니다.'], ['안전 출력', 'XLSX 모든 결과 셀은 문자형·quotePrefix입니다. CSV 수식성 값은 앞에 작은따옴표를 붙이며 내부 원본은 그대로 보존합니다.'], ['CSV 주의', 'CSV 인용만으로 숫자 자동 해석을 막지 못합니다. 식별자 보존에는 문자형 XLSX를 사용하세요.']])
  return { data: Buffer.from(await workbook.xlsx.writeBuffer()), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'geo-link.xlsx' }
}
