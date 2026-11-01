<script setup lang="ts">
const route = useRoute()
const router = useRouter()
useHead({ title: '공간 데이터 시각화 도구 | geo' })
const base = useRuntimeConfig().app.baseURL

// 확장자 선택 창은 주소(?type=)로 연다. 뒤로 가기로 창이 다시 열리고, 다른 화면에서 이 창으로 바로 올 수 있다.
// 정적으로 미리 그린 화면과 어긋나지 않게 브라우저에 붙은 뒤에만 읽는다
const mounted = ref(false)
onMounted(() => { mounted.value = true })
const picked = computed({
  get: () => (mounted.value && typeof route.query.type === 'string' ? route.query.type : ''),
  set: type => router.replace({ query: type ? { type } : {} }),
})

// GeoTIFF와 COG처럼 확장자가 같은 포맷은 한 번만
const extsOf = (id: string) => [...new Set(formatsOf(id).filter(f => !f.closed).map(f => f.extensions[0]))]
const open = formats.filter(f => !f.closed)
const openCount = open.length
const recipeCount = open.reduce((n, f) => n + f.recipes.length, 0)

// 상단 바로 가기: 설명 · 직접 실행 (AI 연결은 사이트 공용 → 헤더 오른쪽)
const actions = [
  { to: '/viz/why', label: '처음이라면', hint: '왜 다듬고 바꾸나, 그림으로 3분', icon: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13z' },
  { to: '/viz/upload', label: '내 파일로 해 보기', hint: '파일 넣고 바로 변환', icon: 'M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15' },
]

// 카드 그림: 유형마다 대표 샘플의 시각화·렌더링 화면 (npm run thumbs → public/thumbs/<유형>-<확장자>.webp)
const thumbs: Record<string, [format: string, label: string]> = {
  'vector-2d': ['shp', '서울 상권 영역'],
  'vector-25d': ['shp', '과천 건물'],
  'raster': ['cog', '서울 위성영상'],
  'terrain': ['terrain', '마터호른 지형'],
  'pointcloud': ['las', '치악산 둘레길'],
  'model-3d': ['citygml', '도쿄역 건물'],
  'indoor-bim': ['ifc', 'IFC 예제 건물'],
  'attribute': ['csv', '서울 버스정류장'],
}
const thumbBase = `${useRuntimeConfig().app.baseURL}thumbs/`
const cards = categories.map(c => ({ ...c, thumb: thumbs[c.id] }))

// 유형마다 데이터 모양을 범례 기호처럼 그린 작은 그림 (viewBox 40×40)
const glyphs: Record<string, string> = {
  'vector-2d': '<path class="f" d="M7 27 13 11l14-3 7 13-11 11z"/><path d="M4 35c9-6 18 1 32-6"/><circle class="d" cx="13" cy="11" r="2"/><circle class="d" cx="27" cy="8" r="2"/><circle class="d" cx="34" cy="21" r="2"/>',
  'vector-25d': '<path class="f2" d="M6 15l8-4 8 4-8 4z"/><path class="f" d="M6 15v16l8 4V19zM14 19v16l8-4V15z"/><path class="f2" d="M22 23l6-3 6 3-6 3z"/><path class="f" d="M22 23v9l6 3v-9zM28 26v9l6-3v-9z"/>',
  'raster': '<rect class="f" x="5" y="5" width="7" height="7"/><rect class="f2" x="12" y="5" width="7" height="7"/><rect class="f3" x="19" y="5" width="7" height="7"/><rect class="f2" x="26" y="5" width="7" height="7"/><rect class="f2" x="5" y="12" width="7" height="7"/><rect class="f3" x="12" y="12" width="7" height="7"/><rect class="f" x="19" y="12" width="7" height="7"/><rect class="f3" x="26" y="12" width="7" height="7"/><rect class="f3" x="5" y="19" width="7" height="7"/><rect class="f" x="12" y="19" width="7" height="7"/><rect class="f2" x="19" y="19" width="7" height="7"/><rect class="f" x="26" y="19" width="7" height="7"/><rect class="f" x="5" y="26" width="7" height="7"/><rect class="f2" x="12" y="26" width="7" height="7"/><rect class="f3" x="19" y="26" width="7" height="7"/><rect class="f2" x="26" y="26" width="7" height="7"/>',
  'terrain': '<path class="f" d="M3 33l9-13 6 6 8-14 11 21z"/><path d="M8 26l4-6 6 6 8-14 6 11"/><path d="M3 36h34"/>',
  'pointcloud': '<g class="dots"><circle cx="20" cy="9" r="1.4"/><circle cx="14" cy="12" r="1.4"/><circle cx="26" cy="12" r="1.4"/><circle cx="20" cy="15" r="1.4"/><circle cx="10" cy="17" r="1.4"/><circle cx="30" cy="17" r="1.4"/><circle cx="16" cy="19" r="1.4"/><circle cx="24" cy="19" r="1.4"/><circle cx="7" cy="23" r="1.4"/><circle cx="33" cy="23" r="1.4"/><circle cx="13" cy="24" r="1.4"/><circle cx="20" cy="23" r="1.4"/><circle cx="27" cy="24" r="1.4"/><circle cx="5" cy="30" r="1.4"/><circle cx="11" cy="30" r="1.4"/><circle cx="17" cy="29" r="1.4"/><circle cx="23" cy="29" r="1.4"/><circle cx="29" cy="30" r="1.4"/><circle cx="35" cy="30" r="1.4"/></g>',
  'model-3d': '<path class="f" d="M7 14h18v18H7z"/><path d="M7 14l8-7h18l-8 7M25 14l8-7v18l-8 7"/><path class="dash" d="M15 7v18h18M15 25l-8 7"/>',
  'indoor-bim': '<path class="dash" d="M10 6h26v22"/><path class="f" d="M4 12h26v24H4z"/><path d="M17 12v10M4 24h8M17 30v6M30 24h-6"/><path d="M12 24a5 5 0 0 1 5-5"/>',
  'attribute': '<rect class="f" x="4" y="6" width="27" height="25" rx="2"/><path class="f2" d="M4 8a2 2 0 0 1 2-2h23a2 2 0 0 1 2 2v5H4z"/><path d="M4 13h27M4 19h27M4 25h17M14 6v25"/><path class="d" d="M30 21c-3.3 0-6 2.5-6 5.7 0 4 6 9.3 6 9.3s6-5.3 6-9.3c0-3.2-2.7-5.7-6-5.7z"/><circle cx="30" cy="26.6" r="2.1" style="fill: var(--surface); stroke: none"/>',
}
</script>

<template>
  <div>
    <FlowSteps />
    <section class="wrap hero">
      <h1>공간 데이터 시각화 도구</h1>
      <p class="muted intro">공개 원본에서 웹 지도·3D까지. 처리 명령과 이유를 따라가며 파일·서버 방식과 뷰어별 결과를 비교합니다.</p>
      <nav class="acts" aria-label="바로 가기">
        <NuxtLink v-for="a in actions" :key="a.to" :to="a.to" class="act">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="a.icon" /></svg>
          <span><b>{{ a.label }}</b><small>{{ a.hint }}</small></span>
        </NuxtLink>
      </nav>
      <section id="examples" aria-labelledby="examples-title">
        <h2 id="examples-title">대표 예시로 시작하기</h2>
        <ul class="examples">
          <li v-for="e in vizExamples" :key="e.id">
            <NuxtLink :to="e.to" class="example">
              <img :src="`${base}${e.thumb}`" :alt="e.alt" width="640" height="400" loading="lazy">
              <span><b>{{ e.name }} →</b><small>{{ e.summary }}</small></span>
            </NuxtLink>
          </li>
        </ul>
        <p class="small muted">썸네일은 기존 변환 결과 촬영본입니다. 결과 지도를 열려면 해당 샘플을 로컬에서 준비해야 합니다.</p>
      </section>
      <header class="eg-head">
        <h2>예시 {{ openCount }}개 — 원본부터 결과 화면까지</h2>
        <p class="muted">유형을 고르면 실제 공개 데이터의 처리 과정과 웹 지도·엔진 결과 화면. 처리 방법 {{ recipeCount }}가지.</p>
      </header>
      <RouteMap class="map" @pick="picked = $event" />
    </section>
    <section id="types" class="wrap" aria-label="데이터 유형">
      <ul class="cards">
        <li v-for="c in cards" :key="c.id" :style="{ '--c': c.color }">
          <button type="button" class="card" :disabled="!extsOf(c.id).length" @click="picked = c.id">
            <span v-if="c.thumb" class="shot">
              <img :src="`${thumbBase}${c.id}-${c.thumb[0]}.webp`" :alt="`${c.name} 예: ${c.thumb[1]}`" width="640" height="400" loading="lazy">
            </span>
            <span class="head">
              <svg class="glyph" viewBox="0 0 40 40" aria-hidden="true" v-html="glyphs[c.id]" />
              <span class="name">{{ c.name }}</span>
            </span>
            <span class="summary">{{ c.summary }}</span>
            <span class="exts">
              <span v-for="e in extsOf(c.id)" :key="e" class="pill">{{ e }}</span>
              <span v-if="!extsOf(c.id).length" class="small muted">준비 중</span>
            </span>
          </button>
          <NuxtLink v-if="c.thumb" :to="`/viz/${c.id}/${c.thumb[0]}/view`" class="see" :aria-label="`${c.name} 예시 결과 화면 보기: ${c.thumb[1]}`">결과 화면 ▶</NuxtLink>
        </li>
      </ul>
      <p class="small muted note">카드 그림: 각 유형 샘플을 실제로 변환해 그린 화면. 배경지도 © OpenStreetMap contributors.</p>
    </section>
    <FormatPicker :category="picked" @close="picked = ''" />
  </div>
</template>

<style scoped>
.hero { padding-top: 28px; }
.hero h1 { font-size: var(--fs-4); }
.intro { margin-top: 8px; max-width: 46rem; }
#examples { margin-top: 36px; }
#examples h2 { font-size: var(--fs-3); }
.examples { list-style: none; padding: 0; margin: 14px 0 8px; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: 14px; }
.example { display: grid; height: 100%; overflow: hidden; color: var(--ink); text-decoration: none; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.example:hover, .example:focus-visible { border-color: var(--ink-2); }
.example img { display: block; width: 100%; height: auto; aspect-ratio: 2 / 1; object-fit: cover; border-bottom: 1px solid var(--rule); }
.example span { display: grid; gap: 4px; padding: 14px 16px; }
.example small { color: var(--ink-2); font-size: var(--fs-0); }
.acts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); gap: 12px; margin-top: 18px; }
.act {
  display: flex; align-items: center; gap: 14px; padding: 14px 18px; text-decoration: none; color: var(--ink);
  background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.act:hover, .act:focus-visible { border-color: var(--ink-2); box-shadow: 0 2px 10px rgb(22 32 42 / 0.08); }
.act svg { flex: none; width: 36px; height: 36px; padding: 7px; border-radius: 10px; background: var(--stage); fill: none; stroke: var(--ink); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.act span { display: grid; }
.act b { font-size: var(--fs-1); }
.act small { font-size: var(--fs-0); color: var(--ink-2); }
.eg-head { margin-top: 44px; }
.eg-head h2 { font-size: var(--fs-3); }
.eg-head p { margin-top: 4px; }
.map { margin-top: 20px; }
#types { padding-top: 40px; }
.cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 14px; }
.cards li { position: relative; }
/* 그림 오른쪽 위: 대표 예시의 시각화 화면으로 바로 (카드 자체는 확장자 선택 창). 버튼 안에 링크를 못 넣어 카드 옆에 겹쳐 둔다 */
.see {
  position: absolute; right: 10px; top: 10px; padding: 3px 10px; border-radius: 999px; text-decoration: none;
  font-size: 0.75rem; font-weight: 600; color: #fff; background: rgb(22 32 42 / 0.78);
}
.see:hover, .see:focus-visible { background: var(--ink); }
.card {
  width: 100%; height: 100%; display: grid; grid-template-rows: auto auto auto 1fr; gap: 6px; text-align: left;
  padding: 0 0 14px; overflow: hidden; font: inherit; color: var(--ink); cursor: pointer;
  background: var(--surface); border: 1px solid var(--rule); border-radius: 14px;
}
.card:hover:not(:disabled), .card:focus-visible { border-color: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 14%, transparent); }
.card:disabled { cursor: default; opacity: 0.55; }
.shot { position: relative; display: block; aspect-ratio: 2 / 1; overflow: hidden; margin-bottom: 6px; background: var(--stage); border-bottom: 1px solid var(--rule); }
.shot img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease; }
.card:hover:not(:disabled) .shot img { transform: scale(1.05); }
@media (prefers-reduced-motion: reduce) { .shot img { transition: none; } }
.head { display: flex; align-items: center; gap: 8px; padding: 0 16px; }
.note { margin-top: 10px; }
.glyph {
  flex: none; width: 30px; height: 30px; padding: 3px; border-radius: 8px;
  background: color-mix(in srgb, var(--c) 9%, var(--surface));
  fill: none; stroke: var(--c); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round;
}
.glyph :deep(.f) { fill: color-mix(in srgb, var(--c) 16%, transparent); }
.glyph :deep(.f2) { fill: color-mix(in srgb, var(--c) 38%, transparent); }
.glyph :deep(.f3) { fill: color-mix(in srgb, var(--c) 70%, transparent); }
.glyph :deep(.d), .glyph :deep(.dots) { fill: var(--c); stroke: none; }
.glyph :deep(.dash) { stroke-dasharray: 2 2.5; opacity: 0.7; }
.name { font-size: var(--fs-2); font-weight: 700; letter-spacing: -0.01em; }
.summary { padding: 0 16px; color: var(--ink-2); font-size: var(--fs-0); line-height: 1.6; }
.exts { display: flex; flex-wrap: wrap; align-content: end; gap: 4px; padding: 4px 16px 0; }
.exts .pill { padding: 0 7px; font-size: 0.72rem; }
@media (max-width: 720px) {
  /* 휴대폰: 두 줄로 그림 위주, 설명은 확장자 선택 창에 */
  .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .summary, .glyph { display: none; }
  .head, .exts { padding-inline: 10px; }
  .card { padding-bottom: 10px; }
}
</style>
