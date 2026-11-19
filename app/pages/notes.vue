<script setup lang="ts">
// 개념 정리노트: 주제 하나 = 줄 하나, 묶음(공통·벡터…) → 유형별. 펼치면(<details>) 1 무엇인가(+차원별) → 2 종류 → 3 차이 → 4 이어지는 질문(그 안에 또 <details>)
// 줄 표식: ★중요(면접에 나온 주제)만. 차원은 유형 제목에
// 그림은 app/note-figs/<fig 또는 노트 id>.vue. 펼칠 때 처음 불러오고, 펼칠 때마다 처음부터 재생 (key를 바꿔 새로 그림)
// 주소 #id = 그 노트를 펼친 채로, 이어지는 질문은 #노트id-번호 (공유·다른 화면에서 연결)
import type { Component } from 'vue'
import type { Note } from '~/utils/notes'

useHead({ title: '개념 정리노트' })

const figFiles = new Map(Object.entries(import.meta.glob<Component>('~/note-figs/*.vue', { import: 'default' }))
  .map(([path, load]) => [path.slice(path.lastIndexOf('/') + 1, -'.vue'.length), defineAsyncComponent(load)]))

const figOf = (n: Note) => figFiles.get(n.fig ?? n.id)

const groupName = new Map(noteGroups.map(g => [g.id, g.name]))
const byId = new Map(notes.map(n => [n.id, n]))

// 묶음이 바뀌는 첫 유형 앞에 묶음 제목 (group)
const sections = noteCats.flatMap(cat => {
  const items = notes.filter(n => n.cat === cat.id)

  return items.length ? [{ cat, items }] : []
}).map((s, i, all) => ({ ...s, group: all[i - 1]?.cat.group === s.cat.group ? undefined : groupName.get(s.cat.group) }))

// 이어지는 질문: 번호는 주제 안 순서(1부터)
const followOf = (n: Note) => (n.follow ?? []).map((f, i) => ({ ...f, no: i + 1, id: `${n.id}-${i + 1}` }))

function followSummary(n: Note) {
  const counts = new Map<string, number>()

  for (const f of n.follow ?? []) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1)

  return [...counts].map(([k, c]) => `${k} ${c}`).join(' · ')
}

// 펼침 상태는 여기서 들고 있다 (노트·이어지는 질문 같이) → 주소 #id로 열 때 씀
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

// 주소의 #id: 처음 열 때와, 노트 안 링크로 옮길 때. 이어지는 질문(#노트id-번호)이면 그 노트도 펼친다
async function openHash(hash: string) {
  const id = decodeURIComponent(hash.slice(1))
  const top = byId.get(id) ?? byId.get(id.replace(/-\d+$/, ''))

  if (!top) return

  opened.add(top.id)
  opened.add(id)
  await nextTick()
  document.getElementById(id)?.scrollIntoView()
}

// 설명 수준: 입문(개발·GIS를 몰라도 읽히게) / 자세히. 고른 값은 이 브라우저에 기억 (저장소를 못 쓰면 매번 자세히부터)
type Mode = 'easy' | 'full'

const mode = ref<Mode>('full')
const easyOn = computed(() => mode.value === 'easy')

function setMode(m: Mode) {
  mode.value = m

  try { localStorage.setItem('notes-mode', m) } catch { /* 저장 못 해도 화면은 바뀜 */ }
}

const route = useRoute()

onMounted(() => {
  try { if (localStorage.getItem('notes-mode') === 'easy') mode.value = 'easy' } catch { /* 기본값(자세히) */ }

  openHash(location.hash)
})

watch(() => route.hash, openHash)
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <h1 class="head">공간 데이터 개념 정리</h1>
      <div class="mode">
        <div class="seg" role="group" aria-label="설명 수준">
          <button type="button" :aria-pressed="easyOn" @click="setMode('easy')">입문</button>
          <button type="button" :aria-pressed="!easyOn" @click="setMode('full')">자세히</button>
        </div>
        <p class="small muted">{{ easyOn ? '개발·GIS를 몰라도 읽히게 쉬운 말과 비유로' : '정의 → 종류 → 차이 → 이어지는 질문, 항목마다 출처' }}</p>
      </div>

      <template v-for="s in sections" :key="s.cat.id">
        <h2 v-if="s.group" class="grp">{{ s.group }}</h2>
        <section class="sec" :style="{ '--c': s.cat.color }" :aria-labelledby="`cat-${s.cat.id}`">
        <h3 :id="`cat-${s.cat.id}`" class="cat"><span class="chip-dot" />{{ s.cat.name }}<span v-if="s.cat.dim" class="dim">{{ s.cat.dim }}</span><span class="n">{{ s.items.length }}</span><small>{{ easyOn ? noteEasyCats[s.cat.id] ?? s.cat.text : s.cat.text }}</small></h3>
        <div class="list">
          <details v-for="(n, i) in s.items" :id="n.id" :key="n.id" class="note" :open="opened.has(n.id)" @toggle="toggle(n.id, $event)">
            <summary>
              <span class="no">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="q">{{ easyOn && n.easy?.q || n.title }}</span>
              <span class="marks"><span v-if="n.important" class="star" :title="n.important">★ 중요</span></span>
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </summary>

            <!-- 주제(kindsQ 있음)는 교과서 순서: 1 그게 뭔가(+ 차원별) → 2 종류 → 3 차이 → 4 이어서 나올 질문 -->
            <!-- 입문: 한 줄 요약 → 쉬운 문단 → 비유 → 낱말 → 그림. 카드·표·출처·이어지는 질문은 자세히에서 -->
            <div v-if="easyOn && n.easy" class="body easy">
              <p class="answer def">{{ n.easy.one }}</p>
              <p v-for="p in n.easy.say" :key="p" class="say">{{ p }}</p>
              <p v-if="n.easy.eg" class="eg"><b>예를 들면</b>{{ n.easy.eg }}</p>
              <dl v-if="n.easy.words?.length" class="words">
                <div v-for="[w, d] in n.easy.words" :key="w"><dt>{{ w }}</dt><dd>{{ d }}</dd></div>
              </dl>
              <figure v-if="figOf(n)" class="fig">
                <component :is="figOf(n)" v-if="runs.get(n.id)" :key="runs.get(n.id)" />
                <button type="button" class="btn" @click="replay(n.id)">다시 보기</button>
              </figure>
              <button type="button" class="btn more" @click="setMode('full')">자세히 보기 →</button>
            </div>
            <div v-else class="body" :class="{ 'has-fig': figOf(n) && !n.kindsQ, topic: n.kindsQ }">
              <section v-if="n.kindsQ" class="step-box">
                <h4 class="step"><span class="num">1</span>{{ n.title }}</h4>
                <p class="answer def">{{ n.answer }}</p>
                <p v-if="n.easy" class="plain"><b>쉽게 말하면</b>{{ n.easy.one }}</p>
                <ul v-if="n.answerFacts?.length" class="facts"><li v-for="f in n.answerFacts" :key="f">{{ f }}</li></ul>
                <p v-if="n.answerRefs?.length" class="src">출처 <a v-for="r in n.answerRefs" :key="r.id" :href="r.url" target="_blank" rel="noopener" :title="r.text">{{ r.title }}</a></p>
                <p v-if="n.see?.length" class="see">겹치는 내용은 앞 질문 참고 <NuxtLink v-for="s in n.see" :key="s.id" :to="`#${s.id}`">{{ s.title }}</NuxtLink></p>
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
                    <ul v-if="t.facts.length" class="facts"><li v-for="f in t.facts" :key="f">{{ f }}</li></ul>
                    <dl v-if="t.subs?.length" class="tsubs">
                      <template v-for="x in t.subs" :key="x.name">
                        <dt><NuxtLink v-if="x.to" :to="x.to">{{ x.name }}</NuxtLink><template v-else>{{ x.name }}</template><code v-if="x.code">{{ x.code }}</code></dt>
                        <dd>{{ x.text }}</dd>
                      </template>
                    </dl>
                    <details v-if="t.refs.length" class="src-fold">
                      <summary>출처 {{ t.refs.length }}</summary>
                      <p class="src"><a v-for="r in t.refs" :key="r.id" :href="r.url" target="_blank" rel="noopener" :title="`${r.title} — ${r.text}`">{{ r.title }}</a></p>
                    </details>
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
                <p v-if="!n.kindsQ && n.easy" class="plain"><b>쉽게 말하면</b>{{ n.easy.one }}</p>
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
                <details v-for="f in followOf(n)" :id="f.id" :key="f.id" class="sub" :open="opened.has(f.id)" @toggle="toggle(f.id, $event)">
                  <summary>
                    <span class="no">{{ f.no }}</span>
                    <span class="q">{{ f.q }}</span>
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
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; padding-bottom: 24px; interpolate-size: allow-keywords; }
.head { font-size: var(--fs-5); }
.mode { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-top: 16px; }
/* 입문 본문: 문단을 넉넉한 줄 간격으로, 비유는 연한 상자, 낱말은 두 칸 */
.easy { gap: 12px; max-width: calc(46rem + 18px + 2.6rem + 12px); }
.easy .say { font-size: var(--fs-1); line-height: 1.8; }
.eg { padding: 10px 14px; line-height: 1.7; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--r-tile); }
.eg b, .plain b { margin-right: 8px; font-size: 0.78rem; color: color-mix(in srgb, var(--c) 85%, black); }
.words { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 6px; margin: 0; }
.words > div { padding: 8px 12px; background: var(--surface); border: 1px solid var(--rule); border-left: 3px solid var(--c); border-radius: 0 var(--r-tile) var(--r-tile) 0; }
.words dt { font-weight: 700; }
.words dd { margin: 2px 0 0; font-size: var(--fs-0); color: var(--ink-2); }
.easy .more { justify-self: start; }
.plain { font-size: var(--fs-0); line-height: 1.6; color: var(--ink-2); }
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
.star { padding: 1px 8px; font-size: 0.72rem; font-weight: 600; white-space: nowrap; color: #fff; background: #C8323C; border-radius: 999px; cursor: help; }
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
/* 카드 출처는 접어 둔다 (펼치면 링크 목록) — 카드 본문이 먼저 읽히게 */
.src-fold { margin-top: auto; padding-top: 6px; font-size: 0.78rem; color: var(--ink-2); }
.src-fold > summary { width: fit-content; cursor: pointer; list-style: none; }
.src-fold > summary::-webkit-details-marker { display: none; }
.src-fold > summary::before { content: '▸ '; }
.src-fold[open] > summary::before { content: '▾ '; }
.src-fold .src { margin-top: 4px; }
.terms .src a { display: inline-block; max-width: 13rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.src a { color: var(--link); }
.see { display: flex; flex-wrap: wrap; gap: 2px 12px; padding: 6px 10px; font-size: var(--fs-0); color: var(--ink-2); background: var(--paper); border-radius: var(--r-tile); }
.see a { font-weight: 600; color: var(--link); }
.tsubs dt a { color: var(--link); }
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
.sub > summary { display: grid; grid-template-columns: 2.6rem minmax(0, 1fr) 16px; align-items: center; gap: 10px; padding: 8px 12px; font-size: var(--fs-0); color: var(--ink); }
.sub > summary:hover { background: var(--paper); }
.sub[open] > summary { box-shadow: inset 3px 0 var(--c); }
.sub .chev { width: 16px; height: 16px; }
.sub-body { display: grid; gap: 10px; justify-items: start; padding: 4px 12px 14px calc(12px + 2.6rem + 10px); font-size: var(--fs-0); }
.sub-body .answer { font-weight: 400; }

@media (max-width: 860px) {
  .body, .body.has-fig { grid-template-columns: minmax(0, 1fr); padding-left: 18px; }
}
@media (max-width: 640px) {
  .note > summary { grid-template-columns: 2.4rem minmax(0, 1fr) auto 18px; gap: 8px; padding-inline: 14px; }
  .body, .body.has-fig { padding-inline: 14px; }
  .sub > summary { grid-template-columns: 2.4rem minmax(0, 1fr) 16px; }
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
