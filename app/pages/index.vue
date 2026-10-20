<script setup lang="ts">
const route = useRoute()
const router = useRouter()

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
      <h1 class="sr-only">공간 데이터 웹 처리</h1>
      <RouteMap class="map" @pick="picked = $event" />
    </section>
    <section id="types" class="wrap" aria-label="데이터 유형">
      <ul class="cards">
        <li v-for="c in categories" :key="c.id" :style="{ '--c': c.color }">
          <button type="button" class="card" :disabled="!extsOf(c.id).length" @click="picked = c.id">
            <svg class="glyph" viewBox="0 0 40 40" aria-hidden="true" v-html="glyphs[c.id]" />
            <span class="name">{{ c.name }}</span>
            <span class="summary">{{ c.summary }}</span>
            <span class="exts">
              <span v-for="e in extsOf(c.id)" :key="e" class="pill">{{ e }}</span>
              <span v-if="!extsOf(c.id).length" class="small muted">준비 중</span>
            </span>
          </button>
        </li>
      </ul>
    </section>
    <FormatPicker :category="picked" @close="picked = ''" />
  </div>
</template>

<style scoped>
.hero { padding-top: 24px; }
.map { margin-top: 8px; }
#types { padding-top: 40px; }
.cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(16.5rem, 1fr)); gap: 14px; }
.card {
  width: 100%; height: 100%; display: grid; grid-template-rows: auto auto 1fr auto; gap: 6px; text-align: left;
  padding: 18px 18px 16px; font: inherit; color: var(--ink); cursor: pointer;
  background: var(--surface); border: 1px solid var(--rule); border-radius: 14px;
}
.card:hover:not(:disabled), .card:focus-visible { border-color: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 14%, transparent); }
.card:disabled { cursor: default; opacity: 0.55; }
.glyph {
  width: 44px; height: 44px; padding: 4px; margin-bottom: 8px; border-radius: 10px;
  background: color-mix(in srgb, var(--c) 9%, var(--surface));
  fill: none; stroke: var(--c); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round;
}
.glyph :deep(.f) { fill: color-mix(in srgb, var(--c) 16%, transparent); }
.glyph :deep(.f2) { fill: color-mix(in srgb, var(--c) 38%, transparent); }
.glyph :deep(.f3) { fill: color-mix(in srgb, var(--c) 70%, transparent); }
.glyph :deep(.d), .glyph :deep(.dots) { fill: var(--c); stroke: none; }
.glyph :deep(.dash) { stroke-dasharray: 2 2.5; opacity: 0.7; }
.name { font-size: var(--fs-2); font-weight: 700; letter-spacing: -0.01em; }
.summary { color: var(--ink-2); font-size: var(--fs-0); line-height: 1.6; }
.exts { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 10px; }
@media (max-width: 720px) { .map { display: none; } }
</style>
