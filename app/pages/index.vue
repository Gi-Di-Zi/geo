<script setup lang="ts">
// 첫 화면: 시각화 탐색을 먼저, 함께 쓰는 다른 도구는 아래 영역에 표시.
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
  { to: '/viz/why', title: '처음이라면', text: '왜 전처리·변환이 필요한지 그림으로 3분' },
]

const stack = [
  { name: '사이트', items: ['Nuxt 4', 'Vue 3', 'TypeScript'] },
  { name: '처리', items: ['Docker 도구 이미지', 'GDAL', 'tippecanoe', 'mago 3D', 'py3dtiles'] },
  { name: '서버', items: ['PostGIS', 'GeoServer (WMS·WMTS·WFS·OGC API)', 'martin'] },
  { name: '렌더링', items: ['OpenLayers', 'MapLibre', 'Deck.gl', 'CesiumJS', 'Cesium for Unreal'] },
  { name: 'AI 연동', items: ['MCP', 'MCP Apps (대화 안 화면)'] },
]
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <header class="hero">
        <p class="eyebrow">공간 데이터 시각화 도구</p>
        <h1>공간 데이터를 웹 지도와 3D로</h1>
        <p class="lead">
          실제 공개 원본을 수집하고 좌표계·인코딩·형상을 다듬어 웹에서 읽을 수 있는 형식으로 바꿉니다.
          단계별 명령과 처리 이유를 살펴보고, 같은 데이터를 여러 방식과 뷰어로 비교해 보세요.
        </p>
        <nav class="go" aria-label="시작">
          <NuxtLink to="/viz" class="btn-go main">공간 데이터 시각화 도구 →</NuxtLink>
          <NuxtLink to="/viz#examples" class="btn-go">대표 예시 3개 →</NuxtLink>
          <a href="https://github.com/Gi-Di-Zi/geo" class="btn-go">GitHub 저장소 →</a>
        </nav>
      </header>

      <section class="part" aria-labelledby="examples-title">
        <h2 id="examples-title">대표 예시</h2>
        <p class="small muted">결과 화면에서 도구를 바꾸거나 수집·전처리·변환 단계를 따라갈 수 있습니다. 로컬 실행에는 샘플 데이터 준비가 필요합니다.</p>
        <ul class="list examples">
          <li v-for="e in vizExamples" :key="e.id">
            <NuxtLink :to="e.to" class="proj">
              <img :src="`${base}${e.thumb}`" :alt="e.alt" width="640" height="400">
              <span class="body"><b>{{ e.name }} →</b><span>{{ e.summary }}</span></span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <p class="small muted" style="margin-top: 32px">아래 통계는 공간 데이터 시각화 카탈로그의 예시·처리 현황입니다.</p>
      <ul class="stats" aria-label="시각화 카탈로그 통계">
        <li v-for="[n, label] in stats" :key="label"><b>{{ n }}</b><span>{{ label }}</span></li>
      </ul>

      <section class="part" aria-labelledby="uses">
        <h2 id="uses">할 수 있는 것</h2>
        <ul class="uses">
          <li v-for="u in uses" :key="u.to">
            <NuxtLink :to="u.to" class="use"><b>{{ u.title }} →</b><span>{{ u.text }}</span></NuxtLink>
          </li>
        </ul>
      </section>

      <section class="part" aria-labelledby="stack">
        <h2 id="stack">처리 구성</h2>
        <ul class="stack">
          <li v-for="s in stack" :key="s.name">
            <b>{{ s.name }}</b>
            <span class="chips"><span v-for="i in s.items" :key="i" class="pill">{{ i }}</span></span>
          </li>
        </ul>
      </section>

      <section class="part" aria-labelledby="projects-title">
        <h2 id="projects-title">함께 쓰는 도구</h2>
        <ul class="list">
          <li v-for="p in projects.filter(p => p.id !== vizProject.id)" :key="p.id">
            <NuxtLink v-if="p.base" :to="p.base" class="proj">
              <img v-if="p.thumb" :src="`${base}${p.thumb}`" alt="" width="640" height="400">
              <span class="body"><span v-if="p.status" class="small">{{ p.status }}</span><b>{{ p.name }}</b><span>{{ p.summary }}</span></span>
            </NuxtLink>
            <div v-else class="proj soon">
              <span class="ph" aria-hidden="true">기획 중</span>
              <span class="body"><b>{{ p.name }}</b><span>{{ p.summary }}</span></span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 48px; }
.hero { max-width: 52rem; }
.eyebrow { font-size: var(--fs-0); font-weight: 600; color: var(--ink-2); }
.hero h1 { margin-top: 6px; font-size: var(--fs-5); }
.lead { margin-top: 14px; font-size: var(--fs-2); line-height: 1.6; color: var(--ink-2); }
.go { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
.btn-go { padding: 9px 16px; border: 1px solid var(--rule); border-radius: var(--r-panel); background: var(--surface); color: var(--ink); font-weight: 600; text-decoration: none; }
.btn-go:hover, .btn-go:focus-visible { border-color: var(--ink-2); }
.btn-go.main { background: var(--ink); border-color: var(--ink); color: #fff; }
.btn-go.main:hover, .btn-go.main:focus-visible { background: #2A3540; }

.stats { list-style: none; padding: 0; margin: 40px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 12px; }
.stats li { display: grid; gap: 2px; padding: 14px 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.stats b { font-size: var(--fs-4); font-family: var(--mono); font-weight: 500; }
.stats span { font-size: var(--fs-0); color: var(--ink-2); }

.part { margin-top: 56px; padding-top: 32px; border-top: 1px solid var(--rule); }
.part h2 { font-size: var(--fs-3); }
.uses { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); gap: 12px; }
.use { display: grid; gap: 6px; height: 100%; padding: 16px 18px; color: var(--ink); text-decoration: none; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.use:hover, .use:focus-visible { border-color: var(--ink-2); box-shadow: 0 2px 10px rgb(22 32 42 / 0.08); }
.use span { font-size: var(--fs-0); color: var(--ink-2); }
.stack { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 10px; max-width: 52rem; }
.stack li { display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: 12px; align-items: baseline; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips .pill { font-family: var(--font); background: var(--surface); border: 1px solid var(--rule); color: var(--ink); }

.list { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); gap: 16px; }
.examples { grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); }
.proj { display: grid; align-content: start; height: 100%; overflow: hidden; color: var(--ink); text-decoration: none; background: var(--surface); border: 1px solid var(--rule); border-radius: 14px; }
a.proj:hover, a.proj:focus-visible { border-color: var(--ink-2); box-shadow: 0 2px 12px rgb(22 32 42 / 0.08); }
/* height: auto — img의 height 속성(400)이 비율(2:1)보다 앞서지 않게 */
.proj img, .ph { display: block; width: 100%; height: auto; aspect-ratio: 2 / 1; object-fit: cover; border-bottom: 1px solid var(--rule); }
.ph { display: grid; place-items: center; background: repeating-linear-gradient(-45deg, var(--paper) 0 10px, var(--stage) 10px 20px); color: var(--ink-2); font-size: var(--fs-0); }
.body { display: grid; gap: 4px; padding: 14px 16px 16px; }
.body b { font-size: var(--fs-2); }
.body span { color: var(--ink-2); font-size: var(--fs-0); }
.soon { color: var(--ink-2); }
@media (max-width: 560px) { .stack li { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
</style>
