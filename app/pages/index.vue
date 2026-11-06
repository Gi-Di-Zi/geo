<script setup lang="ts">
// 첫 화면: 두 도구를 가로로 나란히. 하나를 펼치면 다른 하나는 세로 띠로 접힌다 (기본은 중심 도구인 시각화).
import { tools } from '#shared/catalog/tools'
import { viewers } from '#shared/viewers'

useHead({ title: 'geo-web-bridge · 공간 데이터 시각화' })
const base = useRuntimeConfig().app.baseURL

// 숫자는 카탈로그에서 센다 → 확장자·레시피가 늘면 같이 바뀐다
const open = formats.filter(f => !f.closed)
const stats = [
  [categories.length, '데이터 유형'],
  [open.length, '확장자 예시'],
  [open.reduce((n, f) => n + f.recipes.length, 0), '처리 방법'],
  [tools.length, '정리한 도구'],
  [`${viewers.length} + 1`, '웹 렌더러 + 엔진'],
] as const

const uses = [
  { to: '/viz', title: '예시 둘러보기', text: '확장자마다 실제 공개 원본 → 처리 명령·로그 → 웹 지도·엔진 결과 화면' },
  { to: '/viz/upload', title: '내 파일로 해 보기', text: '형식 자동 판별, 방식·도구 고르기, 변환 과정 실시간 → 지도' },
  { to: '/ai', title: 'AI 대화에서 쓰기', text: 'Claude·ChatGPT에 MCP로 연결, 쓸 지도 라이브러리를 말하면 맞는 변환 추천·실행·결과' },
  { to: '/qgis', title: 'QGIS에서 쓰기', text: '레이어를 웹 지도로, 속성 표의 주소·PNU를 코드·위치로 바꾸는 플러그인 두 개 (개발 중 · 실험 버전)' },
  { to: '/viz/why', title: '처음이라면', text: '왜 전처리·변환이 필요한지 그림으로 3분' },
]

const linkInputs = ['지번·도로명주소', 'PNU (19자리)', '법정동코드 (10자리)', '행정동코드', '우편번호', '좌표 (5개 좌표계)']
const linkOutputs = [
  { name: '주소·코드', items: ['지번주소 · 도로명주소', '우편번호', 'PNU', '시도·시군구·읍면동·리 코드', '행정동코드'] },
  { name: '위치', items: ['대표 좌표 (5개 좌표계로)', '법정동 경계 SHP'] },
  { name: '필지 단위', items: ['필지 실재 · 경계 GeoJSON', '건물 유무 · 이름 · 층수', '지목 · 면적 · 용도지역 · 공시지가'] },
]
const linkUses = [
  { to: '/link', title: '웹에서 찾기', text: '한 번에 20줄. 주소는 검색 후보에서 고르고, 좌표로도 찾기' },
  { to: '/qgis', title: 'QGIS에서 쓰기', text: '속성 표의 한 열이나 도형 위치를 결과 열·점·필지 레이어로 (개발 중 · 실험 버전)' },
  { to: '/ai', title: 'AI 대화에서 쓰기', text: 'MCP 도구로 대화 안에서 주소·코드 변환 (베타)' },
  { to: '/link/reference', title: '기준자료', text: '법정동·행정동 코드 공식 자료와 업데이트 상태' },
]

const stack = [
  { name: '사이트', items: ['Nuxt 4', 'Vue 3', 'TypeScript'] },
  { name: '처리', items: ['Docker 도구 이미지', 'GDAL', 'tippecanoe', 'mago 3D', 'py3dtiles'] },
  { name: '서버', items: ['PostGIS', 'GeoServer (WMS·WMTS·WFS·OGC API)', 'martin'] },
  { name: '렌더링', items: ['OpenLayers', 'MapLibre', 'Deck.gl', 'CesiumJS', 'Cesium for Unreal'] },
  { name: '주소·코드', items: ['행정안전부 법정동·행정동 코드', 'VWorld 검색·지오코더', 'VWorld 연속지적도·토지특성'] },
  { name: '외부 연결', items: ['MCP', 'MCP Apps (대화 안 화면)', 'QGIS 플러그인 (실험 버전)'] },
]

// 접힌 띠: 번호·이름·한 줄 설명·핵심어. 색은 위 가장자리 띠·핵심어에 쓴다
const panels = [
  { ...vizProject, no: '01', keys: ['3D Tiles', 'PMTiles', '점군', '웹 지도 4종'], color: 'var(--link)' },
  { ...linkProject, no: '02', keys: ['PNU', '법정동·행정동', '필지 경계', '공시지가'], color: '#0F766E' },
]
const shown = ref(vizProject.id)
const box = ref<HTMLElement>()
// 누른 띠는 사라지므로 펼친 쪽 제목으로 초점을 옮기고, 묶음 머리가 화면 위로 지나갔으면 끌어올린다
async function show(id: string) {
  shown.value = id
  await nextTick()
  document.getElementById(`${id}-title`)?.focus({ preventScroll: true })
  if (box.value && box.value.getBoundingClientRect().top < 0) box.value.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <header class="hero">
        <p class="eyebrow">geo-web-bridge</p>
        <h1>공간 데이터를 웹으로 잇는 두 도구</h1>
        <p class="lead">공개 원본을 다듬어 웹 지도·3D로 바꾸는 시각화 도구와, 국내 주소·코드를 서로 바꾸고 필지·위치를 붙이는 연계 도구입니다. 웹에서 바로 쓰고, QGIS와 AI 대화(MCP)에도 연결합니다.</p>
      </header>

      <div ref="box" class="tools">
        <section v-for="p in panels" :key="p.id" class="tool" :class="{ open: shown === p.id }" :style="{ '--c': p.color }" :aria-label="p.name">
          <Transition name="rail">
            <button v-show="shown !== p.id" class="rail" type="button" aria-expanded="false" :aria-controls="`${p.id}-body`" @click="show(p.id)">
              <span class="no">{{ p.no }}</span>
              <b>{{ p.name }}</b>
              <span class="sum">{{ p.summary }}</span>
              <span class="keys"><span v-for="k in p.keys" :key="k" class="pill">{{ k }}</span></span>
              <span class="more">펼쳐 보기<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m0 0-6-6m6 6-6 6" /></svg></span>
            </button>
          </Transition>
          <Transition name="full">
            <div v-show="shown === p.id" :id="`${p.id}-body`" class="full">
              <template v-if="p.id === 'viz'">
                <header>
                  <p class="eyebrow"><span class="no">{{ p.no }}</span>{{ p.name }}</p>
                  <h2 id="viz-title" tabindex="-1">공간 데이터를 웹 지도와 3D로</h2>
                  <p class="lead">
                    실제 공개 원본을 수집하고 좌표계·인코딩·형상을 다듬어 웹에서 읽을 수 있는 형식으로 바꿉니다.
                    단계별 명령과 처리 이유를 살펴보고, 같은 데이터를 여러 방식과 뷰어로 비교해 보세요.
                  </p>
                  <nav class="go" aria-label="시작">
                    <NuxtLink to="/viz" class="btn-go main">공간 데이터 시각화 도구 →</NuxtLink>
                    <NuxtLink to="/viz#examples" class="btn-go">대표 예시 3개 →</NuxtLink>
                  </nav>
                </header>

                <section class="part" aria-labelledby="examples-title">
                  <h3 id="examples-title">대표 예시</h3>
                  <p class="small muted">결과 화면에서 도구를 바꾸거나 수집·전처리·변환 단계를 따라갈 수 있습니다. 로컬 실행에는 샘플 데이터 준비가 필요합니다.</p>
                  <ul class="list">
                    <li v-for="e in vizExamples" :key="e.id">
                      <NuxtLink :to="e.to" class="proj">
                        <img :src="`${base}${e.thumb}`" :alt="e.alt" width="640" height="400">
                        <span class="body"><b>{{ e.name }} →</b><span>{{ e.summary }}</span></span>
                      </NuxtLink>
                    </li>
                  </ul>
                </section>

                <div>
                  <p class="small muted" style="margin-top: 28px">아래 통계는 공간 데이터 시각화 카탈로그의 예시·처리 현황입니다.</p>
                  <ul class="stats" aria-label="시각화 카탈로그 통계">
                    <li v-for="[n, label] in stats" :key="label"><b>{{ n }}</b><span>{{ label }}</span></li>
                  </ul>
                </div>

                <section class="part" aria-labelledby="uses">
                  <h3 id="uses">할 수 있는 것</h3>
                  <ul class="uses">
                    <li v-for="u in uses" :key="u.to">
                      <NuxtLink :to="u.to" class="use"><b>{{ u.title }} →</b><span>{{ u.text }}</span></NuxtLink>
                    </li>
                  </ul>
                </section>
              </template>

              <template v-else>
                <header>
                  <p class="eyebrow"><span class="no">{{ p.no }}</span>{{ p.name }}</p>
                  <h2 id="link-title" tabindex="-1">주소·코드를 서로 잇고, 필지까지</h2>
                  <p class="lead">
                    주소나 코드를 하나 넣으면 지번·도로명주소, PNU, 법정동·행정동 코드, 우편번호, 위치를 한 번에 찾습니다.
                    PNU가 정해지면 그 필지의 경계와 건물 유무, 지목·면적·공시지가 같은 토지 속성까지 붙입니다.
                  </p>
                  <nav class="go" aria-label="주소·코드 연계 시작">
                    <NuxtLink to="/link" class="btn-go main">주소·코드 변환 →</NuxtLink>
                    <NuxtLink to="/link/reference" class="btn-go">기준자료 →</NuxtLink>
                  </nav>
                </header>

                <section class="part" aria-labelledby="link-io-title">
                  <h3 id="link-io-title">넣는 것 → 나오는 것</h3>
                  <div class="io">
                    <ul class="ins" aria-label="넣는 것">
                      <li v-for="i in linkInputs" :key="i" class="pill">{{ i }}</li>
                    </ul>
                    <svg class="arrow" viewBox="0 0 48 24" aria-hidden="true"><path d="M2 12h40m0 0-7-7m7 7-7 7" /></svg>
                    <ul class="outs" aria-label="나오는 것">
                      <li v-for="o in linkOutputs" :key="o.name">
                        <b>{{ o.name }}</b>
                        <ul><li v-for="i in o.items" :key="i">{{ i }}</li></ul>
                      </li>
                    </ul>
                  </div>
                </section>

                <section class="part" aria-labelledby="link-uses-title">
                  <h3 id="link-uses-title">쓰는 곳</h3>
                  <ul class="uses">
                    <li v-for="u in linkUses" :key="u.to">
                      <NuxtLink :to="u.to" class="use"><b>{{ u.title }} →</b><span>{{ u.text }}</span></NuxtLink>
                    </li>
                  </ul>
                </section>

                <p class="small muted scope">
                  필지 실재·경계는 연속지적도(지적도를 이어 붙인 참고 도면) 기준이라 법적 경계·면적은 지적공부로 확인해야 합니다.
                  건물은 도로명주소가 부여된 건물 기준입니다.
                </p>
              </template>
            </div>
          </Transition>
        </section>
      </div>

      <section class="part" aria-labelledby="stack">
        <h2 id="stack">처리 구성</h2>
        <ul class="stack">
          <li v-for="s in stack" :key="s.name">
            <b>{{ s.name }}</b>
            <span class="chips"><span v-for="i in s.items" :key="i" class="pill">{{ i }}</span></span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 48px; padding-bottom: 24px; }
.hero { max-width: 52rem; }
.eyebrow { display: flex; align-items: center; gap: 8px; font-size: var(--fs-0); font-weight: 600; color: var(--ink-2); }
.hero h1 { margin-top: 6px; font-size: var(--fs-5); }
.lead { margin-top: 14px; font-size: var(--fs-2); line-height: 1.6; color: var(--ink-2); }
.go { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
.btn-go { padding: 9px 16px; border: 1px solid var(--rule); border-radius: var(--r-panel); background: var(--surface); color: var(--ink); font-weight: 600; text-decoration: none; }
.btn-go:hover, .btn-go:focus-visible { border-color: var(--ink-2); }
.btn-go.main { background: var(--ink); border-color: var(--ink); color: #fff; }
.btn-go.main:hover, .btn-go.main:focus-visible { background: #2A3540; }

/*
 * 펼침 패널. 닫힌 쪽은 띠 너비(--rail), 열린 쪽이 남은 폭을 flex-grow로 가져간다.
 * 두 패널이 같은 곡선으로 0↔1을 오가므로 합은 늘 1 → 전체 폭은 그대로, 경계만 미끄러진다.
 * 펼친 내용은 처음부터 다 펼친 폭(컨테이너 단위)으로 그려 두고 패널이 가리개처럼 드러낸다 → 움직이는 동안 줄바꿈이 다시 일어나지 않는다.
 */
.tools { --rail: 15.5rem; --gap: 16px; --ease: cubic-bezier(0.65, 0, 0.35, 1); display: flex; gap: var(--gap); margin-top: 36px; container-type: inline-size; }
.tool {
  position: relative; flex: 0 0 var(--rail); min-width: 0; overflow: clip; border-radius: 18px;
  background: var(--surface); box-shadow: 0 0 0 1px var(--rule);
  transition: flex-grow 0.75s var(--ease), box-shadow 0.3s, background-color 0.3s;
}
.tool.open {
  flex-grow: 1;
  background: radial-gradient(48rem 18rem at 100% 0, color-mix(in srgb, var(--c) 7%, transparent), transparent 70%), var(--surface);
  box-shadow: 0 0 0 1px var(--rule), 0 24px 48px -28px rgb(22 32 42 / 0.3);
}
.tool:not(.open):hover { background: color-mix(in srgb, var(--c) 4%, var(--surface)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 45%, var(--rule)); }
/* 위 가장자리 색 띠: 열리면 끝까지 차오른다 */
.tool::before { content: ''; position: absolute; z-index: 1; inset: 0 0 auto; height: 4px; background: var(--c); transform-origin: left; scale: 0.3 1; transition: scale 0.75s var(--ease); }
.tool.open::before { scale: 1 1; }

.rail {
  position: sticky; top: 72px; display: grid; align-content: start; gap: 12px; width: var(--rail); min-height: 24rem; padding: 30px 22px 24px;
  font: inherit; text-align: left; color: var(--ink); background: none; border: 0; cursor: pointer;
}
.rail .no { font-family: var(--mono); font-size: var(--fs-4); font-weight: 500; line-height: 1; color: var(--c); }
.rail b { font-size: var(--fs-2); line-height: 1.35; }
.sum { font-size: var(--fs-0); color: var(--ink-2); }
.keys { display: flex; flex-wrap: wrap; gap: 6px; }
.keys .pill { font-family: var(--font); }
.more { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; font-size: var(--fs-0); font-weight: 600; color: var(--c); }
.more svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: translate 0.25s; }
.rail:hover .more svg, .rail:focus-visible .more svg { translate: 4px 0; }

.full { width: calc(100cqi - var(--rail) - var(--gap)); padding: 34px 36px 36px; }
.full .eyebrow .no { font-family: var(--mono); color: var(--c); }
.full h2 { margin-top: 6px; font-size: var(--fs-4); }
.full h2:focus { outline: none; }
/* 펼칠 때 내용이 위에서부터 차례로 떠오른다 */
.open .full > * { animation: rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.open .full > :nth-child(n+2) { animation-delay: 0.14s; }
.open .full > :nth-child(n+3) { animation-delay: 0.22s; }
.open .full > :nth-child(n+4) { animation-delay: 0.3s; }
@keyframes rise { from { opacity: 0; translate: 0 18px; } }

/* 들고 나는 쪽: 나가는 것은 흐름에서 빼서(높이 안 차지) 접히는 패널에 가려지며 흐려지고, 띠는 패널이 거의 접힌 뒤 들어온다 */
.full-leave-active { position: absolute; top: 0; left: 0; transition: opacity 0.55s ease-in; }
.rail-leave-active { position: absolute; top: 0; left: 0; transition: opacity 0.2s ease-in; }
.full-leave-to, .rail-leave-to { opacity: 0; }
.rail-enter-active { transition: opacity 0.4s ease-out 0.4s, translate 0.4s ease-out 0.4s; }
.rail-enter-from { opacity: 0; translate: -14px 0; }

.stats { list-style: none; padding: 0; margin: 14px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: 12px; }
.stats li { display: grid; gap: 2px; padding: 14px 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.stats b { font-size: var(--fs-4); font-family: var(--mono); font-weight: 500; }
.stats span { font-size: var(--fs-0); color: var(--ink-2); }

.part { margin-top: 56px; padding-top: 32px; border-top: 1px solid var(--rule); }
.part h2 { font-size: var(--fs-3); }
.full .part { margin-top: 36px; padding-top: 26px; }
.uses { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr)); gap: 12px; }
.use { display: grid; gap: 6px; height: 100%; padding: 16px 18px; color: var(--ink); text-decoration: none; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.use:hover, .use:focus-visible { border-color: var(--ink-2); box-shadow: 0 2px 10px rgb(22 32 42 / 0.08); }
.use span { font-size: var(--fs-0); color: var(--ink-2); }
.stack { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 10px; max-width: 52rem; }
.stack li { display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: 12px; align-items: baseline; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips .pill { font-family: var(--font); background: var(--surface); border: 1px solid var(--rule); color: var(--ink); }

.list { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: 16px; }
.proj { display: grid; align-content: start; height: 100%; overflow: hidden; color: var(--ink); text-decoration: none; background: var(--surface); border: 1px solid var(--rule); border-radius: 14px; }
.proj:hover, .proj:focus-visible { border-color: var(--ink-2); box-shadow: 0 2px 12px rgb(22 32 42 / 0.08); }
/* height: auto — img의 height 속성(400)이 비율(2:1)보다 앞서지 않게 */
.proj img { display: block; width: 100%; height: auto; aspect-ratio: 2 / 1; object-fit: cover; border-bottom: 1px solid var(--rule); }
.body { display: grid; gap: 4px; padding: 14px 16px 16px; }
.body b { font-size: var(--fs-2); }
.body span { color: var(--ink-2); font-size: var(--fs-0); }

/* 넣는 것 → 나오는 것: 화살표 점선이 흐른다 */
.io { display: grid; grid-template-columns: minmax(0, 11rem) 48px minmax(0, 1fr); gap: 16px; align-items: center; margin-top: 16px; }
.ins { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.ins .pill { font-family: var(--font); font-size: var(--fs-0); padding: 3px 12px; }
.arrow { width: 48px; height: 24px; fill: none; stroke: var(--c); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.arrow path { stroke-dasharray: 4 4; animation: flow 0.9s linear infinite; }
@keyframes flow { to { stroke-dashoffset: -8; } }
.outs { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr)); gap: 12px; }
.outs > li { padding: 14px 16px; background: var(--surface); border: 1px solid var(--rule); border-top: 3px solid var(--c); border-radius: var(--r-panel); }
.outs b { font-size: var(--fs-0); color: var(--c); }
.outs ul { margin: 6px 0 0; padding-left: 1.1em; font-size: var(--fs-0); line-height: 1.6; }
.scope { margin-top: 28px; max-width: 48rem; }

/* 좁으면 위아래로: 닫힌 쪽은 한 줄 띠, 폭 애니메이션 없이 내용만 떠오른다 */
@media (max-width: 860px) {
  .tools { flex-direction: column; }
  .tool { flex: none; }
  .rail { position: static; width: 100%; min-height: 0; padding: 22px 18px 18px; gap: 8px; }
  .rail .no { font-size: var(--fs-2); }
  .full { width: auto; padding: 28px 18px 28px; }
  .full-leave-active, .rail-leave-active { width: 100%; }
  .io { grid-template-columns: minmax(0, 1fr); }
  .arrow { rotate: 90deg; justify-self: center; }
}
@media (max-width: 560px) { .stack li { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
</style>
