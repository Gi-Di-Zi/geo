import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseInterview } from '../../shared/interview.ts'

const doc = parseInterview(readFileSync(new URL('../../app/assets/interview.txt', import.meta.url), 'utf8'))
const items = doc.sections.flatMap(s => s.items)

test('면접 100문항: 문항·구역·학습 순서·출처를 빠짐없이 읽는다', () => {
  assert.equal(items.length, 100)
  assert.deepEqual(doc.sections.map(s => s.from), ['Q001', 'Q011', 'Q021', 'Q031', 'Q041', 'Q051', 'Q061', 'Q071', 'Q081', 'Q091'])
  assert.deepEqual(items.flatMap(i => (i.kind === '실제질문' ? [i.no] : [])), ['Q001', 'Q013', 'Q031', 'Q041', 'Q051', 'Q071'])
  assert.equal(doc.steps.length, 6)
  assert.equal(doc.sources.size, 51)
  assert.equal(doc.checked, '2026-11-17')
  assert.equal(doc.sections[0]?.text, '타원체·투영·축·단위를 구분한다.')
  assert.equal(doc.checklist.length, 13)
})

test('문항 한 개를 줄 종류대로 나눈다', () => {
  const q = items.find(i => i.no === 'Q001')

  assert.equal(q?.title, '투영 좌표계와 타원 좌표계의 차이는?')
  assert.match(q?.answer ?? '', /^‘타원 좌표계’는 .+동시에 보존할 수는 없다\.$/)
  assert.match(q?.check ?? '', /^원문 표현을 유지했다/)
  assert.deepEqual(q?.refs, ['S01', 'S02'])
  assert.deepEqual(q?.related, ['Q002', 'Q003', 'Q005', 'Q007', 'Q011'])
  assert.equal(items.find(i => i.no === 'Q100')?.refNote, '작성자 제안 / 본인 경험으로 작성')
  assert.equal(doc.sources.get('S51')?.url, 'https://cesium.com/learn/cesiumjs/ref-doc/Cartographic.html')
})

test('형식이 어긋나면 조용히 빠뜨리지 않고 오류', () => {
  const one = (body: string) => () => parseInterview(`--구역 (Q001–Q001)\n설명\nQ001 [실제질문]\n${body}`)

  assert.throws(one('Q. 질문'), /Q001: "Q\." 질문 줄이나 답이 없음/)
  assert.throws(one('Q. 질문\n답\n근거: S99'), /출처 S99/)
})

test('지운 문항을 가리키는 연결 문항은 오류 없이 빠진다 (문항을 블록째 지워 거르는 문서)', () => {
  const doc = parseInterview('--구역 (Q001–Q002)\n설명\nQ001 [실제질문]\nQ. 질문\n답\n연결 문항: Q002, Q003\n\nQ002 [꼬리질문]\nQ. 꼬리\n답\n연결 문항: Q001')

  assert.deepEqual(doc.sections[0]?.items.map(i => i.related), [['Q002'], ['Q001']])
})
