<script setup lang="ts">
// 개념 정리노트: 주제 하나 = 줄 하나, 묶음(공통·벡터…) → 유형별. 펼치면(<details>) 1 무엇인가(+차원별) → 2 종류 → 3 차이 → 4 이어지는 질문(그 안에 또 <details>)
// 줄 표식: ★중요(면접에 나온 주제) · 차원(2D·2.5D·3D, 유형에서)
// 그림은 app/note-figs/<fig 또는 노트 id>.vue. 펼칠 때 처음 불러오고, 펼칠 때마다 처음부터 재생 (key를 바꿔 새로 그림)
// 주소 #id = 그 노트를 펼친 채로, 이어지는 질문은 #노트id-번호 (공유·다른 화면에서 연결)
import type { Component } from 'vue'
import type { Note } from '~/utils/notes'
import type { FollowUp } from '~/utils/note-topics'

useHead({ title: '개념 정리노트' })

const figFiles = new Map(Object.entries(import.meta.glob<Component>('~/note-figs/*.vue', { import: 'default' }))
  .map(([path, load]) => [path.slice(path.lastIndexOf('/') + 1, -'.vue'.length), defineAsyncComponent(load)]))

const figOf = (n: Note) => figFiles.get(n.fig ?? n.id)

// 고르기: 유형('all' | 묶음 id | 유형 id)과 노트 종류(kind). 찾기: 띄어쓴 낱말이 모두 들어 있는 노트 (이어지는 질문 내용도)
const pick = ref('all')
const kind = ref('all')
const query = ref('')
const groupOf = new Map<string, string>(noteCats.map(c => [c.id, c.group]))
const groupName = new Map(noteGroups.map(g => [g.id, g.name]))
const dimOf = new Map(noteCats.map(c => [c.id, c.dim]))
const rows = noteGroups.map(g => ({ ...g, cats: noteCats.filter(c => c.group === g.id) }))
const kinds = [...new Set(notes.map(n => n.kind))]
const byId = new Map(notes.map(n => [n.id, n]))
const topicCount = notes.filter(n => n.kindsQ).length
const figCount = notes.filter(n => figOf(n)).length
const mineCount = notes.filter(n => n.kind === '정리').length
const textOf = (parts: (string | undefined)[]) => parts.join(' ').toLowerCase()
const followText = (f: FollowUp) => textOf([f.q, f.a, f.kind, f.src.title])

const indexed = notes.map(n => ({
  n,
  text: textOf([
    n.kind, n.title, n.answer, n.kindsQ, n.diffQ, ...n.points, n.code, n.here, ...(n.tags ?? []), n.important && `중요 ${n.important}`,
    ...(n.answerFacts ?? []), ...(n.dims ?? []).flatMap(x => [x.d, x.text]),
    ...(n.terms ?? []).flatMap(t => [t.name, t.sub, t.dim, t.def, ...t.facts, ...(t.subs ?? []).flatMap(x => [x.name, x.code, x.text])]),
    ...(n.table?.cols ?? []), ...(n.table?.rows.flatMap(r => r.cells) ?? []),
    ...(n.follow ?? []).map(followText),
  ]),
}))

const words = computed(() => query.value.toLowerCase().split(/\s+/).filter(Boolean))
const hit = (text: string) => words.value.every(w => text.includes(w))

// 찾기가 맞는 것(종류 숫자) → 종류도 맞는 것(유형 칩 숫자) → 유형도 맞는 것(목록)
const matched = computed(() => indexed.filter(x => hit(x.text)).map(x => x.n))
const found = computed(() => matched.value.filter(n => kind.value === 'all' || n.kind === kind.value))
const kindCount = (k: string) => matched.value.filter(n => k === 'all' || n.kind === k).length

const within = (n: Note, id: string) => id === 'all' || n.cat === id || groupOf.get(n.cat) === id
const count = (id: string) => found.value.filter(n => within(n, id)).length

// 묶음이 바뀌는 첫 유형 앞에 묶음 제목 (group)
const sections = computed(() => noteCats.flatMap(cat => {
  const items = found.value.filter(n => n.cat === cat.id && within(n, pick.value))

  return items.length ? [{ cat, items }] : []
}).map((s, i, all) => ({ ...s, group: all[i - 1]?.cat.group === s.cat.group ? undefined : groupName.get(s.cat.group) })))

// 이어지는 질문: 번호는 주제 안 순서(1부터)를 그대로 두고, 찾는 중엔 맞는 것만
const followOf = (n: Note) => (n.follow ?? []).flatMap((f, i) => (!words.value.length || hit(followText(f)) ? [{ ...f, no: i + 1, id: `${n.id}-${i + 1}` }] : []))

function followSummary(n: Note) {
  const counts = new Map<string, number>()

  for (const f of n.follow ?? []) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1)

  return [...counts].map(([k, c]) => `${k} ${c}`).join(' · ')
}

const choose = (id: string) => { pick.value = pick.value === id ? 'all' : id }

function reset() {
  pick.value = 'all'
  kind.value = 'all'
  query.value = ''
}

// 펼침 상태는 여기서 들고 있다 → 고르기로 줄이 사라졌다 다시 생겨도 펼친 채로 (노트·이어지는 질문 같이)
const opened = reactive(new Set<string>())
const runs = reactive(new Map<string, number>())
const replay = (id: string) => runs.set(id, (runs.get(id) ?? 0) + 1)

function toggle(id: string, e: Event) {
  if (!(e.target instanceof HTMLDetailsElement)) return
  const hash = `#${id}`

  if (e.target.open) {
    opened.add(id)
    replay(id)
    history.replaceState(history.state, '', hash)
  } else {
    opened.delete(id)

    if (location.hash === hash) history.replaceState(history.state, '', location.pathname + location.search)
  }
}

// 주소의 #id: 처음 열 때와, 노트 안 링크로 옮길 때. 이어지는 질문(#노트id-번호)이면 그 노트도 펼친다. 고르기·찾기로 숨어 있으면 조건을 지운다
async function openHash(hash: string) {
  const id = decodeURIComponent(hash.slice(1))
  const top = byId.get(id) ?? byId.get(id.replace(/-\d+$/, ''))

  if (!top) return

  if (!sections.value.some(s => s.items.includes(top)) || (top.id !== id && words.value.length)) reset()
  opened.add(top.id)
  opened.add(id)
  await nextTick()
  document.getElementById(id)?.scrollIntoView()
}

const route = useRoute()

onMounted(() => openHash(location.hash))

watch(() => route.hash, openHash)
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <header class="head">
        <p class="eyebrow">{{ notesProject.name }} · 주제 {{ topicCount }} (★중요 {{ importantCount }}) · 이어지는 질문 {{ followCount }} · 비교 정리 {{ mineCount }} · 그림 {{ figCount }}</p>
        <h1>공간 데이터 개념 정리</h1>
        <p class="lead">좌표계·웹 지도 라이브러리와 데이터 유형별로 "무엇인가 → 종류 → 차이 → 이어지는 질문" 순서. 벡터는 공통·2D·2.5D·3D로 나누고 줄마다 차원을 표시, 면접에 나온 주제는 ★중요. 정의는 공식 문서·표준, 이어지는 질문은 면접 후기·실무 Q&amp;A에서 가져와 항목마다 출처를 붙였다.</p>
      </header>

      <div class="tools">
        <label class="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 20-4.5-4.5M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z" /></svg>
          <input v-model="query" type="search" placeholder="질문·답·출처에서 찾기 (예: DSM, Range, 축 순서)" aria-label="노트 찾기">
        </label>
        <p v-if="query || pick !== 'all' || kind !== 'all'" class="small muted" aria-live="polite">
          {{ sections.reduce((k, s) => k + s.items.length, 0) }}개 보임 · <button type="button" class="link" @click="reset">조건 지우기</button>
        </p>
      </div>

      <div class="seg kinds" role="group" aria-label="노트 종류로 고르기">
        <button type="button" :aria-pressed="kind === 'all'" @click="kind = 'all'">모든 종류<span class="n">{{ kindCount('all') }}</span></button>
        <button v-for="k in kinds" :key="k" type="button" :aria-pressed="kind === k" @click="kind = kind === k ? 'all' : k">{{ k }}<span class="n">{{ kindCount(k) }}</span></button>
      </div>

      <nav class="filter" aria-label="유형으로 고르기">
        <div class="f-row">
          <button type="button" class="f-group" :aria-pressed="pick === 'all'" @click="pick = 'all'">전체<span class="n">{{ count('all') }}</span></button>
        </div>
        <div v-for="g in rows" :key="g.id" class="f-row">
          <button type="button" class="f-group" :aria-pressed="pick === g.id" @click="choose(g.id)">{{ g.name }}<span class="n">{{ count(g.id) }}</span></button>
          <button
            v-for="c in g.cats" :key="c.id" type="button" class="chip f-cat" :style="{ '--c': c.color }" :title="c.text"
            :aria-pressed="pick === c.id" :disabled="!count(c.id) && pick !== c.id" @click="choose(c.id)"
          >
            <span class="chip-dot" />{{ c.name }}<span class="n">{{ count(c.id) }}</span>
          </button>
        </div>
      </nav>

      <details class="guide">
        <summary>참고 자료 — 학습 순서 {{ interview.steps.length }}단계 · 자료 확인일 {{ interview.checked }}</summary>
        <div class="guide-body">
          <p v-for="p in interview.intro" :key="p">{{ p }}</p>
          <ol class="steps">
            <li v-for="s in interview.steps" :key="s.title">
              <p><b>{{ s.title }}</b></p>
              <p class="muted">{{ s.text }}</p>
              <ul class="srcs">
                <li v-for="r in s.refs" :key="r"><a :href="interview.sources.get(r)?.url" target="_blank" rel="noopener" :title="interview.sources.get(r)?.text">{{ r }} {{ interview.sources.get(r)?.title }}</a></li>
              </ul>
              <p v-if="s.caution" class="caution">주의: {{ s.caution }}</p>
            </li>
          </ol>
        </div>
      </details>

      <template v-for="s in sections" :key="s.cat.id">
        <h2 v-if="s.group" class="grp">{{ s.group }}</h2>
        <section class="sec" :style="{ '--c': s.cat.color }" :aria-labelledby="`cat-${s.cat.id}`">
        <h3 :id="`cat-${s.cat.id}`" class="cat"><span class="chip-dot" />{{ s.cat.name }}<span v-if="s.cat.dim" class="dim">{{ s.cat.dim }}</span><span class="n">{{ s.items.length }}</span><small>{{ s.cat.text }}</small></h3>
        <div class="list">
          <details v-for="(n, i) in s.items" :id="n.id" :key="n.id" class="note" :open="opened.has(n.id)" @toggle="toggle(n.id, $event)">
            <summary>
              <span class="no">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="q">{{ n.title }}</span>
              <span class="marks">
                <span v-if="n.important" class="kind star" :title="n.important">★ 중요</span>
                <span v-if="dimOf.get(n.cat)" class="dim">{{ dimOf.get(n.cat) }}</span>
                <span class="kind">{{ n.kind }}</span>
                <span v-for="t in n.tags" :key="t" class="pill tag">{{ t }}</span>
                <span v-if="n.follow?.length" class="pill tag more" :title="followSummary(n)">+{{ n.follow.length }}질문</span>
                <svg v-if="n.code" class="mark" viewBox="0 0 24 24" role="img" aria-label="코드 있음"><title>코드 있음</title><path d="m8 7-5 5 5 5m8-10 5 5-5 5" /></svg>
                <svg v-if="figOf(n)" class="mark" viewBox="0 0 24 24" role="img" aria-label="그림 있음"><title>그림 있음</title><circle cx="12" cy="12" r="9" /><path d="m10 8.5 5 3.5-5 3.5z" /></svg>
              </span>
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </summary>

            <!-- 주제(kindsQ 있음)는 교과서 순서: 1 그게 뭔가(+ 차원별) → 2 종류 → 3 차이 → 4 이어서 나올 질문 -->
            <div class="body" :class="{ 'has-fig': figOf(n) && !n.kindsQ, topic: n.kindsQ }">
              <section v-if="n.kindsQ" class="step-box">
                <h4 class="step"><span class="num">1</span>{{ n.title }}</h4>
                <p class="answer def">{{ n.answer }}</p>
                <ul v-if="n.answerFacts?.length" class="facts"><li v-for="f in n.answerFacts" :key="f">{{ f }}</li></ul>
                <p v-if="n.answerRefs?.length" class="src">출처 <a v-for="r in n.answerRefs" :key="r.id" :href="r.url" target="_blank" rel="noopener" :title="r.text">{{ r.title }}</a></p>
                <div v-if="n.dims?.length" class="dims">
                  <p class="dims-h">2D · 2.5D · 3D에서는</p>
                  <dl>
                    <div v-for="x in n.dims" :key="x.d"><dt><span class="dim">{{ x.d }}</span></dt><dd>{{ x.text }}</dd></div>
                  </dl>
                  <p v-if="n.dimsRefs?.length" class="src">출처 <a v-for="r in n.dimsRefs" :key="r.id" :href="r.url" target="_blank" rel="noopener" :title="r.text">{{ r.title }}</a></p>
                </div>
              </section>
              <div v-if="n.terms" class="intro">
                <h4 v-if="n.kindsQ" class="step"><span class="num">2</span>{{ n.kindsQ }}</h4>
                <ul v-if="n.terms" class="terms">
                  <li v-for="t in n.terms" :key="t.name">
                    <b>{{ t.name }}<span v-if="t.dim" class="dim">{{ t.dim }}</span></b><small>{{ t.sub }}</small>
                    <p class="def">{{ t.def }}</p>
                    <ul class="facts"><li v-for="f in t.facts" :key="f">{{ f }}</li></ul>
                    <dl v-if="t.subs?.length" class="tsubs">
                      <template v-for="x in t.subs" :key="x.name">
                        <dt>{{ x.name }}<code v-if="x.code">{{ x.code }}</code></dt>
                        <dd>{{ x.text }}</dd>
                      </template>
                    </dl>
                    <p class="src">출처 <a v-for="r in t.refs" :key="r.id" :href="r.url" target="_blank" rel="noopener" :title="`${r.title} — ${r.text}`">{{ r.title }}</a></p>
                  </li>
                </ul>
              </div>
              <figure v-if="figOf(n)" class="fig">
                <component :is="figOf(n)" v-if="runs.get(n.id)" :key="runs.get(n.id)" />
                <button type="button" class="btn" @click="replay(n.id)">다시 보기</button>
              </figure>
              <div v-if="n.table" class="diff">
                <h4 v-if="n.diffQ" class="step"><span class="num">3</span>{{ n.diffQ }}</h4>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th v-for="(c, k) in n.table.cols" :key="k" scope="col">{{ c }}</th></tr></thead>
                    <tbody>
                      <tr v-for="(r, k) in n.table.rows" :key="k">
                        <th scope="row"><NuxtLink v-if="r.to" :to="r.to">{{ r.cells[0] }}</NuxtLink><template v-else>{{ r.cells[0] }}</template></th>
                        <td v-for="(c, j) in r.cells.slice(1)" :key="j">{{ c }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p v-if="n.tableRefs?.length" class="src">출처 <a v-for="r in n.tableRefs" :key="r.id" :href="r.url" target="_blank" rel="noopener" :title="r.text">{{ r.title }}</a></p>
              </div>
              <div class="text">
                <p v-if="!n.kindsQ" class="answer"><b>답</b>{{ n.answer }}</p>
                <ul v-if="n.points.length" class="points"><li v-for="p in n.points" :key="p">{{ p }}</li></ul>
                <pre v-if="n.code"><code>{{ n.code }}</code></pre>
              </div>
              <div v-if="n.here || n.links?.length" class="after">
                <p v-if="n.here" class="fact"><b>이 사이트</b>{{ n.here }}</p>
                <nav v-if="n.links?.length" class="links" aria-label="같이 볼 정리">
                  <NuxtLink v-for="l in n.links" :key="l.to" :to="l.to" class="go">{{ l.label }} →</NuxtLink>
                </nav>
              </div>

              <section v-if="n.follow?.length" class="subs" :aria-label="`${n.title} — 이어지는 질문`">
                <h4 class="step"><span v-if="n.kindsQ" class="num">4</span>이어지는 질문<span class="n">{{ n.follow.length }}</span><small>{{ followSummary(n) }} · 면접 후기·실무 Q&amp;A에서, 항목마다 출처</small></h4>
                <p v-if="words.length" class="small muted">찾는 말이 들어간 질문만 보임 (번호는 그대로)</p>
                <details v-for="f in followOf(n)" :id="f.id" :key="f.id" class="sub" :open="opened.has(f.id)" @toggle="toggle(f.id, $event)">
                  <summary>
                    <span class="no">{{ f.no }}</span>
                    <span class="q">{{ f.q }}</span>
                    <span class="kind" :class="{ heard: f.kind === '면접 후기' }">{{ f.kind }}</span>
                    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </summary>
                  <div class="sub-body">
                    <p class="answer"><b>답</b>{{ f.a }}</p>
                    <p class="refs"><b>출처</b><a :href="f.src.url" target="_blank" rel="noopener">{{ f.src.title }}</a></p>
                  </div>
                </details>
              </section>
            </div>
          </details>
        </div>
        </section>
      </template>

      <p v-if="!sections.length" class="empty">
        맞는 노트 없음. <button type="button" class="btn" @click="reset">조건 지우기</button>
      </p>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; padding-bottom: 24px; interpolate-size: allow-keywords; }
.head { max-width: 46rem; }
.eyebrow { font-size: var(--fs-0); font-weight: 600; color: var(--ink-2); }
.head h1 { margin-top: 4px; font-size: var(--fs-5); }
.lead { margin-top: 12px; font-size: var(--fs-2); line-height: 1.6; color: var(--ink-2); }

.tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-top: 32px; }
.search { position: relative; flex: 1 1 18rem; max-width: 30rem; }
.search svg { position: absolute; left: 12px; top: 50%; translate: 0 -50%; width: 18px; height: 18px; fill: none; stroke: var(--ink-2); stroke-width: 2; stroke-linecap: round; }
.search input { width: 100%; padding: 9px 12px 9px 38px; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.search input:hover { border-color: var(--ink-2); }
.link { padding: 0; font: inherit; color: var(--link); background: none; border: 0; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }

/* 고르기: 줄마다 묶음 버튼(같은 폭) + 유형 칩. 누른 칩은 유형 색으로 채움, 다시 누르면 전체로 */
.kinds { margin-top: 12px; }
.kinds .n { margin-left: 6px; }
.filter { display: grid; gap: 8px; margin-top: 12px; }
.f-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.f-group {
  display: inline-flex; justify-content: space-between; gap: 8px; min-width: 8.5rem; padding: 4px 12px;
  font: inherit; font-size: var(--fs-0); font-weight: 600; color: var(--ink); background: var(--surface);
  border: 1px solid var(--rule); border-radius: var(--r-control); cursor: pointer;
}
.f-group:hover { border-color: var(--ink-2); }
.f-group[aria-pressed='true'] { color: #fff; background: var(--ink); border-color: var(--ink); }
.f-cat { font-family: inherit; cursor: pointer; }
.f-cat:hover { border-color: var(--c); }
.f-cat[aria-pressed='true'] { color: #fff; background: var(--c); border-color: var(--c); }
.f-cat[aria-pressed='true'] .chip-dot { background: #fff; }
.f-cat:disabled { opacity: 0.45; cursor: default; }
.f-cat:disabled:hover { border-color: var(--rule); }
.n { margin-left: 6px; font-family: var(--mono); font-size: 0.75rem; font-weight: 500; opacity: 0.7; }

/* 묶음 제목(공통·벡터…) → 그 밑에 유형별 목록 */
.grp { margin-top: 56px; padding-bottom: 6px; font-size: var(--fs-3); border-bottom: 2px solid var(--ink); }
.sec { margin-top: 32px; }
.grp + .sec { margin-top: 18px; }
.sec .cat { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; font-size: var(--fs-2); }
.sec .cat .chip-dot { align-self: center; width: 10px; height: 10px; }
.sec .cat .dim { align-self: center; }
.sec .cat small { font-size: var(--fs-0); font-weight: 400; color: var(--ink-2); }
/* 차원 표시 (2D·2.5D·3D) */
.dim { display: inline-block; padding: 0 6px; font-family: var(--mono); font-size: 0.72rem; font-weight: 600; line-height: 1.6; white-space: nowrap; color: var(--ink); background: var(--surface); border: 1px solid var(--ink-2); border-radius: 4px; }
.terms b .dim { margin-left: 8px; vertical-align: 2px; }
.list { margin-top: 10px; overflow: clip; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.note + .note { border-top: 1px solid var(--rule); }

/* 한 줄: 번호 · 질문 · 표식(종류·태그·하위 문항 수·코드·그림) · 꺾쇠. 펼치면 왼쪽에 유형 색 띠 */
.note > summary {
  display: grid; grid-template-columns: 2.6rem minmax(0, 1fr) auto 18px; align-items: center; gap: 12px;
  padding: 13px 18px; font-size: var(--fs-1); color: var(--ink); transition: background-color 0.15s;
}
.note > summary::before, .sub > summary::before { display: none; }
.note > summary:hover { background: var(--paper); }
.note[open] > summary { box-shadow: inset 3px 0 var(--c); }
.no { font-family: var(--mono); font-size: 0.8rem; color: var(--ink-2); }
.note[open] > summary .no { color: var(--c); font-weight: 500; }
.q { font-weight: 600; line-height: 1.5; }
.tag { font-family: var(--font); }
.kind { padding: 1px 8px; font-size: 0.72rem; font-weight: 600; white-space: nowrap; color: var(--ink-2); background: var(--paper); border: 1px solid var(--rule); border-radius: 999px; }
.kind.star { color: #fff; background: #C8323C; border-color: #C8323C; cursor: help; }
.kind.heard { color: #fff; background: #B45309; border-color: #B45309; }
.marks { display: flex; align-items: center; gap: 6px; }
.mark { width: 18px; height: 18px; fill: none; stroke: var(--c); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.chev { width: 18px; height: 18px; fill: none; stroke: var(--ink-2); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: rotate 0.25s; }
.note[open] > summary .chev, .sub[open] > summary .chev { rotate: 180deg; }

/* 펼침: 지원 브라우저(::details-content + interpolate-size)는 높이가 미끄러지고, 아니면 바로 */
.note::details-content { block-size: 0; overflow: clip; transition: block-size 0.3s ease, content-visibility 0.3s allow-discrete; }
.note[open]::details-content { block-size: auto; }

/* 본문. 정리 노트: 답 | 그림 → 표 → 이 사이트. 주제(실제 질문): ① 종류 → 그림 → ② 차이 → ③ 답 → 근거 → ④ 이어서 나올 질문 */
.body { display: grid; gap: 20px 36px; padding: 2px 18px 24px calc(18px + 2.6rem + 12px); }
.body.has-fig { grid-template-columns: minmax(0, 1fr) minmax(0, 27rem); }
.has-fig .text { order: -1; }
.intro, .diff, .subs, .after, .step-box { grid-column: 1 / -1; }
.intro, .diff, .subs, .step-box { display: grid; gap: 10px; }
.step-box { justify-items: start; max-width: 46rem; }
.topic .text { grid-column: 1 / -1; }
.step { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: var(--fs-1); }
.step .num { display: inline-grid; place-items: center; width: 24px; height: 24px; flex: none; font-family: var(--mono); font-size: 0.8rem; font-weight: 600; color: #fff; background: var(--c); border-radius: 50%; }
.step small { font-size: var(--fs-0); font-weight: 400; color: var(--ink-2); }
/* 1단계 안 차원별 단락: 2D · 2.5D · 3D 한 칸씩 */
.dims { display: grid; gap: 6px; justify-self: stretch; margin-top: 4px; }
.dims-h { font-size: var(--fs-0); font-weight: 700; }
.dims dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 8px; margin: 0; }
.dims dl > div { padding: 10px 12px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-tile); }
.dims dd { margin: 6px 0 0; font-size: var(--fs-0); line-height: 1.6; color: var(--ink-2); }
.terms { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.terms > li { display: grid; align-content: start; gap: 2px; padding: 12px 14px; overflow-wrap: anywhere; background: var(--surface); border: 1px solid var(--rule); border-top: 3px solid var(--c); border-radius: var(--r-tile); }
.terms b { font-size: var(--fs-1); }
.terms small { font-size: 0.78rem; font-weight: 600; color: color-mix(in srgb, var(--c) 80%, black); }
.terms .def { margin-top: 6px; font-size: var(--fs-0); font-weight: 600; line-height: 1.6; color: var(--ink); }
.facts { display: grid; gap: 3px; margin: 0; padding-left: 1.1em; font-size: var(--fs-0); line-height: 1.6; color: var(--ink-2); }
.facts li::marker { color: var(--c); }
.terms .facts { margin-top: 4px; }
/* 카드 안 세부 항목 (예: 투영 좌표계 → TM·UTM-K·Web Mercator). 세부가 있으면 카드를 넓게 */
.terms:has(.tsubs) { grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr)); }
.tsubs { display: grid; margin: 8px 0 0; padding-top: 4px; border-top: 1px dashed var(--rule); font-size: var(--fs-0); }
.tsubs dt { margin-top: 6px; font-weight: 700; color: var(--ink); }
.tsubs dt code { margin-left: 6px; padding: 0 6px; font-size: 0.75rem; color: color-mix(in srgb, var(--c) 80%, black); background: var(--paper); border-radius: 4px; }
.tsubs dd { margin: 0; line-height: 1.55; color: var(--ink-2); }
.src { display: flex; flex-wrap: wrap; gap: 2px 10px; margin-top: 2px; font-size: 0.78rem; color: var(--ink-2); }
.terms .src { margin-top: auto; padding-top: 6px; }
.terms .src a { display: inline-block; max-width: 13rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.src a { color: var(--link); }
.topic .fig { max-width: 40rem; }
.text { display: grid; gap: 12px; align-content: start; justify-items: start; max-width: 46rem; }
.answer { padding: 10px 14px; font-weight: 500; background: color-mix(in srgb, var(--c) 7%, var(--surface)); border-left: 3px solid var(--c); border-radius: 0 var(--r-tile) var(--r-tile) 0; }
.answer b { display: block; font-size: 0.75rem; font-weight: 700; color: color-mix(in srgb, var(--c) 85%, black); }
.points { display: grid; gap: 4px; margin: 0; padding-left: 1.2em; }
.points li::marker { color: var(--c); }
.text pre { justify-self: stretch; font-size: 0.8rem; }
/* 비교 표는 좁으면 옆으로 밀기 */
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-tile); }
.table-wrap table { width: 100%; min-width: 36rem; border-collapse: collapse; font-size: var(--fs-0); line-height: 1.55; }
.table-wrap th, .table-wrap td { padding: 8px 12px; text-align: left; vertical-align: top; }
.table-wrap tr + tr > * { border-top: 1px solid var(--rule); }
.table-wrap thead th { font-weight: 700; white-space: nowrap; background: var(--paper); border-bottom: 1px solid var(--rule); }
.table-wrap tbody th { min-width: 6.5rem; font-weight: 600; color: color-mix(in srgb, var(--c) 80%, black); }
.table-wrap tbody tr:hover { background: color-mix(in srgb, var(--c) 4%, var(--surface)); }
.after { display: grid; gap: 12px; justify-items: start; max-width: 46rem; }
.refs { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: var(--fs-0); }
.refs b { color: var(--ink); }
.fact { font-size: var(--fs-0); color: var(--ink-2); padding: 8px 12px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--r-tile); }
.fact b { color: var(--ink); margin-right: 6px; }
.links { display: flex; flex-wrap: wrap; gap: 8px; }
.go { padding: 4px 12px; font-size: var(--fs-0); font-weight: 600; color: var(--ink); text-decoration: none; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-control); }
.go:hover, .go:focus-visible { border-color: var(--ink-2); }
.fig { display: grid; gap: 8px; align-content: start; margin: 0; padding: 14px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.fig .btn { justify-self: end; }

/* 이어지는 질문: 주제 안 번호 1부터, 한 줄씩 펼침 */
.subs { padding-top: 6px; border-top: 1px dashed var(--rule); }
.sub { background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-tile); }
.sub > summary { display: grid; grid-template-columns: 2.6rem minmax(0, 1fr) auto 16px; align-items: center; gap: 10px; padding: 8px 12px; font-size: var(--fs-0); color: var(--ink); }
.sub > summary:hover { background: var(--paper); }
.sub[open] > summary { box-shadow: inset 3px 0 var(--c); }
.sub .chev { width: 16px; height: 16px; }
.sub-body { display: grid; gap: 10px; justify-items: start; padding: 4px 12px 14px calc(12px + 2.6rem + 10px); font-size: var(--fs-0); }
.sub-body .answer { font-weight: 400; }

.guide { margin-top: 20px; padding: 12px 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.guide-body { display: grid; gap: 6px; margin-top: 10px; font-size: var(--fs-0); }
.guide-body > p { color: var(--ink-2); }
.guide .steps { display: grid; gap: 14px; margin: 10px 0 0; padding-left: 1.4em; }
.srcs { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 4px 0 0; padding: 0; list-style: none; }
.caution { margin-top: 4px; color: #8A5300; }
.empty { margin-top: 40px; padding: 32px; text-align: center; color: var(--ink-2); background: var(--surface); border: 1px dashed var(--rule); border-radius: var(--r-panel); }

@media (max-width: 860px) {
  .body, .body.has-fig { grid-template-columns: minmax(0, 1fr); padding-left: 18px; }
}
@media (max-width: 640px) {
  .note > summary { grid-template-columns: 2.4rem minmax(0, 1fr) auto 18px; gap: 8px; padding-inline: 14px; }
  .tag, .note > summary .kind:not(.star) { display: none; }
  .body, .body.has-fig { padding-inline: 14px; }
  .sub > summary { grid-template-columns: 2.4rem minmax(0, 1fr) 16px; }
  .sub > summary .kind { display: none; }
  .sub-body { padding-left: 12px; }
}
</style>

<style>
/*
 * 정리노트 그림(app/note-figs/*.vue) 공통. 규칙: 정적 스타일 = 끝 장면, 애니메이션은 거기까지 오는 과정만 (fill both)
 * → 움직임 줄이기(전역 animation: none)에서는 끝 장면이 그대로 보인다. 색 --c = 노트 유형 색
 */
.nf { display: block; width: 100%; height: auto; overflow: visible; font-family: var(--font); }
.nf .cap { font-size: 11px; fill: var(--ink-2); }
.nf .strong { font-weight: 600; fill: var(--ink); }
.nf .mono { font-family: var(--mono); font-size: 11px; fill: var(--ink); }
.nf .card { fill: var(--surface); stroke: var(--rule); }
.nf .rule { stroke: var(--rule); fill: none; }
.nf .sea { fill: #E3ECF2; }
.nf .land { fill: #FBFAF6; stroke: #B9C3CC; }
.nf .accent { fill: var(--c); }
.nf .wire { fill: none; stroke: var(--c); stroke-width: 1.6; stroke-linecap: round; stroke-dasharray: 1; }
.nf .grow { transform-box: fill-box; transform-origin: center; }
@keyframes nf-in { from { opacity: 0; } }
@keyframes nf-draw { from { stroke-dashoffset: 1; } }
@keyframes nf-pop { from { opacity: 0; transform: scale(0.4); } }
@keyframes nf-blip { 0%, 100% { opacity: 0; } 15%, 85% { opacity: 1; } }
</style>
