import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs-community'
import { checkXlsxZip, exportBatch, parseDelimited, readInputFile, rowsFromBook, rowsFromText, safeSpreadsheetText } from '../../server/services/link/files.ts'
import { resolveRows } from '../../shared/link/core.ts'
import type { ReferenceSnapshot } from '../../shared/link/types.ts'

const fixture: ReferenceSnapshot = { version: 'file-test-fixture', available: true, source: '테스트 전용', sourceUrl: '', sourceDate: null, checkedAt: null, activatedAt: null, coverage: 'fixture', regions: [
  { code: '1100000000', name: '서울특별시', fullName: '서울특별시', parentCode: null, level: 'sido', status: 'active' },
  { code: '1111000000', name: '종로구', fullName: '서울특별시 종로구', parentCode: '1100000000', level: 'sigungu', status: 'active' },
  { code: '1111010100', name: '청운동', fullName: '서울특별시 종로구 청운동', parentCode: '1111000000', level: 'eupmyeondong', status: 'active' },
] }
const pnu = '1111010100100010000'

test('CSV 인용·쉼표·개행·빈 행·중복을 보존한다', () => {
  assert.deepEqual(parseDelimited('code,note\r\n"00123","첫줄\n둘째줄, ""인용"""\r\n,\r\n00123,x\r\n', ','), [['code', 'note'], ['00123', '첫줄\n둘째줄, "인용"'], ['', ''], ['00123', 'x']])
  assert.throws(() => parseDelimited('"닫히지 않음', ','), /따옴표/)
  assert.throws(() => parseDelimited('"a"b,c', ','), /따옴표/)
})
test('탭 붙여넣기 원본 열과 순서·ID·실패 행을 보존한다', () => {
  const rows = rowsFromText(`${pnu}\t메모\n\t\n${pnu}\t중복`)
  assert.deepEqual(rows.map(row => row.value), [pnu, '', pnu])
  assert.equal(rows[0]!.original['열2'], '메모')
  assert.deepEqual(rows.map(row => row.id), ['입력:1', '입력:2', '입력:3'])
})
test('UTF-8 BOM과 EUC-KR CSV를 읽고 명시한 잘못된 인코딩은 거절한다', async () => {
  const utf = await readInputFile('문자.csv', Buffer.from(`\uFEFFcode\n${pnu}`))
  assert.equal(rowsFromBook(utf)[0]!.value, pnu)
  const korean = Buffer.from([0x61, 0x64, 0x64, 0x72, 0x0a, 0xbc, 0xad, 0xbf, 0xef])
  const euc = await readInputFile('국내.csv', korean)
  assert.equal(euc.encoding, 'euc-kr'); assert.equal(rowsFromBook(euc)[0]!.value, '서울')
  await assert.rejects(readInputFile('국내.csv', korean, 'utf-8'), /읽을 수 없습니다/)
})
test('XLSX 시트·헤더행 선택, 19자리 문자열과 앞자리0, 손상 숫자·수식 구분', async () => {
  const workbook = new ExcelJS.Workbook(), a = workbook.addWorksheet('시트1'), b = workbook.addWorksheet('시트2')
  a.addRow(['설명']); a.addRow(['code', 'memo']); a.addRow([pnu, '정상']); a.addRow(['00123', '앞자리0']); a.addRow([1111010100100010000, '숫자셀']); a.addRow([{ formula: '1+1', result: 2 }, '수식'])
  b.addRow(['address']); b.addRow(['서울특별시 종로구 청운동 1'])
  const book = await readInputFile('입력.xlsx', Buffer.from(await workbook.xlsx.writeBuffer()))
  const rows = rowsFromBook(book, { sheet: '시트1', headerRow: 2 })
  assert.equal(rows[0]!.value, pnu); assert.equal(rows[1]!.value, '00123')
  assert.equal(rows[2]!.issue, 'IDENTIFIER_PRECISION_LOSS'); assert.equal(rows[3]!.issue, 'FORMULA_NOT_EVALUATED'); assert.equal(rows[3]!.value, '=1+1')
  assert.equal(rowsFromBook(book, { sheet: '시트2' })[0]!.value, '서울특별시 종로구 청운동 1')
  assert.throws(() => rowsFromBook(book, { sheet: '../시트' }), /시트/)
  assert.throws(() => rowsFromBook(book, { column: 999 }), /열/)
})
test('CSV 수식성 값은 안전 출력하고 내부 원본을 수정하지 않는다', async () => {
  for (const value of ['=1+1', '+SUM(A1)', '-1+2', '@x', '\t=1', '\r=1', '  =1']) assert.equal(safeSpreadsheetText(value), `'${value}`)
  const batch = resolveRows([{ id: '1', value: pnu, original: { code: pnu, note: '=HYPERLINK("https://invalid")' } }], {}, fixture)
  const csv = await exportBatch(batch, 'csv')
  assert.match(csv.data.toString(), /'=HYPERLINK/)
  assert.equal(batch.rows[0]!.original.note, '=HYPERLINK("https://invalid")')
  assert.equal(parseDelimited(csv.data.toString().replace(/^\uFEFF/, ''), ',')[1]![0], pnu)
})
test('XLSX 왕복에서 식별자는 문자형이며 수식은 실행하지 않는다', async () => {
  const batch = resolveRows([{ id: '1', value: pnu, original: { pnu, zero: '00123', formula: '=1+1' } }], {}, fixture)
  const exported = await exportBatch(batch, 'xlsx')
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(exported.data as never)
  const sheet = workbook.worksheets[0]!
  assert.equal(sheet.getCell('A2').value, pnu); assert.equal(sheet.getCell('A2').type, ExcelJS.ValueType.String); assert.equal(sheet.getCell('B2').value, '00123')
  assert.equal(sheet.getCell('C2').value, '=1+1'); assert.equal(sheet.getCell('C2').type, ExcelJS.ValueType.String)
  assert.equal(sheet.getCell('A2').numFmt, '@'); assert.equal(sheet.getCell('C2').quotePrefix, true)
  assert.ok(workbook.getWorksheet('처리정보'))
  assert.equal(batch.rows[0]!.parcel, 'not_checked')
})
test('선택 열 오류·파일 확장자·손상 ZIP·압축 크기·경로조작을 거절한다', async () => {
  const batch = resolveRows([{ id: '1', value: pnu, original: {} }], {}, fixture)
  await assert.rejects(exportBatch(batch, 'csv', ['없는열']), /존재하지/)
  await assert.rejects(readInputFile('입력.xlsm', Buffer.from('x')), /CSV·XLSX/)
  assert.throws(() => checkXlsxZip(Buffer.from('invalid')), /ZIP/)
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('입력').addRow(['x'])
  const zip = Buffer.from(await workbook.xlsx.writeBuffer()), central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  const bomb = Buffer.from(zip); bomb.writeUInt32LE(100 * 1024 ** 2, central + 24)
  assert.throws(() => checkXlsxZip(bomb), /압축 해제/)
  const traversal = Buffer.from(zip); traversal.write('../', central + 46, 'utf8')
  assert.throws(() => checkXlsxZip(traversal), /안전하지/)
})
test('후보와 기준·옵션·오류를 JSON에서 보존하고 선택 열을 적용한다', async () => {
  const batch = resolveRows([{ id: '1', value: pnu, original: {} }], {}, fixture)
  const output = await exportBatch(batch, 'json', ['input_id', 'parcel_check', 'reference_version'])
  const parsed = JSON.parse(output.data.toString())
  assert.equal(parsed.version, fixture.version); assert.equal(parsed.rows[0].parcel_check, 'not_checked'); assert.deepEqual(Object.keys(parsed.rows[0]), ['input_id', 'parcel_check', 'reference_version'])
})
test('CSV 선택 열 출력에도 입력·후보 ID와 기준·옵션·오류 요약을 유지한다', async () => {
  const batch = resolveRows([{ id: '1', value: pnu, original: {} }], {}, fixture)
  const output = await exportBatch(batch, 'csv', ['parcel_check'])
  const [headers, row] = parseDelimited(output.data.toString().replace(/^\uFEFF/, ''), ',')
  for (const key of ['input_id', 'candidate_id', 'reference_version', 'output_options', 'error_summary']) assert.ok(headers!.includes(key))
  assert.equal(row![headers!.indexOf('reference_version')], fixture.version)
  assert.equal(JSON.parse(row![headers!.indexOf('output_options')]!).inputType, 'auto')
})
