/**
 * 공간정보 면접 100문항(app/assets/interview.txt)을 읽는다. 글은 받은 형식 그대로 두고, 정리노트(/notes)가 여기서 문항·출처·학습 순서를 꺼낸다.
 * 문서를 새 판으로 바꾸면 화면도 바뀐다. 형식이 어긋나면(질문·답 없는 문항, 없는 출처) 조용히 빠뜨리지 않고 오류 → npm run test:notes
 * 문항 하나를 빼려면 그 블록("Q0xx [..]"부터 "연결 문항:" 줄까지)만 지운다. 그 문항을 가리키던 연결 문항은 알아서 빠진다
 *
 * 형식: "--제목 (Q001–Q010)" 구역 → 다음 줄 구역 설명 → "Q001 [종류]" / "Q. 질문" / 답(여러 줄) / "확인:" / "근거: S01, S02" / "연결 문항: Q002, …"
 * 그 밖의 구역: "--먼저 읽을 …"(학습 순서 "1. 제목 / Q001–Q012"), "--… 확인표"(줄 목록), "--출처 …"("[S01] 기관 | 제목" + 설명 줄 + 주소)
 */
export interface InterviewSource { id: string; title: string; meta: string; text: string; url: string }

export interface InterviewItem {
  /** Q001 */
  no: string
  /** 실제질문 · 연결개념 · 꼬리질문 · 적용질문 · 포트폴리오 점검 */
  kind: string
  title: string
  answer: string
  check: string
  /** 출처 id (S01 …) */
  refs: string[]
  /** 출처 id 대신 적힌 근거 글 (예: "본인 경험으로 작성") */
  refNote: string
  /** 문항 번호 (Q002 …) */
  related: string[]
}

export interface InterviewSection { title: string; text: string; from: string; items: InterviewItem[] }

export interface InterviewStep { title: string; range: string; text: string; refs: string[]; caution: string }

export interface Interview {
  title: string
  /** 자료 확인일 */
  checked: string
  intro: string[]
  steps: InterviewStep[]
  sections: InterviewSection[]
  checklist: string[]
  sources: Map<string, InterviewSource>
}

const SECTION = /^--(.+) \((Q\d{3})–Q\d{3}\)$/
const ITEM = /^(Q\d{3}) \[(.+)\]$/
const STEP = /^\d+\. (.+) \/ (Q\d{3}–Q\d{3})$/
const STEP_REF = /^(S\d{2}) /
const SOURCE = /^\[(S\d{2})\] (.+)$/
const after = (line: string, head: string) => line.slice(head.length).trim()

export function parseInterview(text: string): Interview {
  const doc: Interview = { title: '', checked: '', intro: [], steps: [], sections: [], checklist: [], sources: new Map() }
  let mode: 'intro' | 'guide' | 'items' | 'checklist' | 'sources' = 'intro'
  let section: InterviewSection | undefined
  let item: InterviewItem | undefined
  let step: InterviewStep | undefined
  let source: InterviewSource | undefined

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()

    if (!line || line.startsWith('====')) continue

    if (line.startsWith('--')) {
      const [, title = '', from = ''] = SECTION.exec(line) ?? []

      item = undefined

      if (title) {
        mode = 'items'
        section = { title, text: '', from, items: [] }
        doc.sections.push(section)
      } else if (line.includes('먼저 읽을')) mode = 'guide'
      else if (line.includes('확인표')) mode = 'checklist'
      else if (line.includes('출처')) mode = 'sources'

      continue
    }

    if (mode === 'intro') {
      if (line.startsWith('자료 확인일:')) doc.checked = after(line, '자료 확인일:')
      else if (!doc.title) doc.title = line
      else doc.intro.push(line)
    } else if (mode === 'guide') {
      const [, title = '', range = ''] = STEP.exec(line) ?? []
      const [, ref = ''] = STEP_REF.exec(line) ?? []

      if (title) {
        step = { title, range, text: '', refs: [], caution: '' }
        doc.steps.push(step)
      } else if (!step || line.startsWith('http')) continue
      else if (ref) step.refs.push(ref)
      else if (line.startsWith('주의:')) step.caution = after(line, '주의:')
      else step.text = step.text ? `${step.text} ${line}` : line
    } else if (mode === 'items' && section) {
      const [, no = '', kind = ''] = ITEM.exec(line) ?? []

      if (no) {
        item = { no, kind, title: '', answer: '', check: '', refs: [], refNote: '', related: [] }
        section.items.push(item)
      } else if (!item) section.text = section.text ? `${section.text} ${line}` : line
      else if (line.startsWith('Q.')) item.title = after(line, 'Q.')
      else if (line.startsWith('확인:')) item.check = after(line, '확인:')
      else if (line.startsWith('근거:')) {
        item.refs = line.match(/S\d{2}/g) ?? []

        if (!item.refs.length) item.refNote = after(line, '근거:')
      } else if (line.startsWith('연결 문항:')) item.related = line.match(/Q\d{3}/g) ?? []
      else item.answer = item.answer ? `${item.answer} ${line}` : line
    } else if (mode === 'checklist') doc.checklist.push(line)
    else if (mode === 'sources') {
      const [, id = '', title = ''] = SOURCE.exec(line) ?? []

      if (id) {
        source = { id, title, meta: '', text: '', url: '' }
        doc.sources.set(id, source)
      } else if (!source) continue
      else if (/^https?:\/\//.test(line)) source.url = line
      else if (!source.meta) source.meta = line
      else source.text = source.text ? `${source.text} ${line}` : line
    }
  }

  check(doc)

  return doc
}

function check(doc: Interview) {
  const items = doc.sections.flatMap(s => s.items)
  const nos = new Set(items.map(i => i.no))

  const refs = (where: string, ids: string[]) => {
    for (const id of ids) if (!doc.sources.get(id)?.url) throw new Error(`면접 문서 ${where}: 출처 ${id}가 목록에 없거나 주소가 없음`)
  }

  if (nos.size !== items.length) throw new Error('면접 문서: 같은 문항 번호가 두 번 나옴')

  for (const i of items) {
    if (!i.title || !i.answer) throw new Error(`면접 문서 ${i.no}: "Q." 질문 줄이나 답이 없음`)
    refs(i.no, i.refs)

    // 문항을 지워서 걸러 내는 문서라, 지운 문항을 가리키는 연결은 오류 대신 뺀다
    i.related = i.related.filter(q => nos.has(q))
  }

  for (const s of doc.steps) refs(`학습 순서 "${s.title}"`, s.refs)
}
