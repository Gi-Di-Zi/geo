<script setup lang="ts">
import { kindLabels, viewers } from '#shared/viewers'
import type { FormatSpec, Output, Recipe, ViewerId } from '#shared/types'

/** base: 결과 폴더 URL. 없으면 미리 변환해 둔 샘플(public/data) */
const props = defineProps<{ spec: FormatSpec; recipe: Recipe; color: string; base?: string }>()
const { camera, sync, reset, move } = useCamera()
const { basemap, hasKey } = useBasemap()
const dir = computed(() => props.base ?? `${useRuntimeConfig().app.baseURL}data/${props.spec.category}/${props.spec.id}/${props.recipe.id}/`)

const root = ref<HTMLElement>()
const active = ref(false)

// 뷰어 하나씩. 한 번이라도 고른 뷰어만 띄우고, 다른 뷰어로 바꿔도 숨겨 둔 뷰어의 상태는 지킨다
const current = ref<ViewerId>('deck')
const seen = reactive(new Set<ViewerId>())
watch(current, id => seen.add(id), { immediate: true })
const mounted = (id: ViewerId) => active.value && seen.has(id)

onMounted(() => {
  const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { active.value = true; io.disconnect() } }, { rootMargin: '200px' })
  io.observe(root.value!)
  document.addEventListener('fullscreenchange', onFull)
})
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFull))

const full = ref(false)
const onFull = () => { full.value = document.fullscreenElement === root.value }
const toggleFull = () => (full.value ? document.exitFullscreen() : root.value!.requestFullscreen())

// 코드 서랍: 뷰어 하나가 출력 하나를 그리는 최소 코드
const drawer = ref<HTMLDialogElement>()
const code = ref<{ viewer: string; kind: string; text: string } | null>(null)
const copied = ref(false)
function openCode(viewer: ViewerId, o: Output, path: string) {
  code.value = { viewer: viewers.find(v => v.id === viewer)!.name, kind: kindLabels[o.kind], text: snippet(viewer, o, location.origin + path) }
  copied.value = false
  drawer.value?.showModal()
}
async function copy() {
  await navigator.clipboard.writeText(code.value!.text)
  copied.value = true
}

const view = computed(() => props.recipe.view ?? props.spec.view)
watch([() => props.spec, view], ([, v]) => {
  reset(v)
  // 해외 데이터는 VWorld(한국만 제공) 범위 밖이라 OSM으로 바꾼다
  if (v.basemap === 'osm') basemap.value = 'osm'
}, { immediate: true })
const abroad = computed(() => view.value.basemap === 'osm')

const tiles = computed(() => viewers.map(v => {
  const use = props.recipe.viewers[v.id]
  const output = 'output' in use ? props.recipe.outputs.find(o => o.id === use.output) : undefined
  return {
    meta: v,
    use,
    output,
    path: output && outPath(dir.value, output),
    elsewhere: viewers.filter(w => 'output' in props.recipe.viewers[w.id]).map(w => w.name),
  }
}))

// 기본은 MapLibre + Deck.gl. 그 뷰어가 못 그리는 데이터면 그릴 수 있는 첫 뷰어
watch(tiles, t => {
  if (!t.find(x => x.meta.id === current.value)?.output) current.value = t.find(x => x.meta.id === 'deck' && x.output)?.meta.id ?? t.find(x => x.output)?.meta.id ?? 'ol'
}, { immediate: true })
const cur = computed(() => tiles.value.find(t => t.meta.id === current.value)!)
</script>

<template>
  <section ref="root" class="stage" aria-label="뷰어 4개 결과 비교">
    <div class="viewer">
      <ViewerTile
        v-for="t in tiles" v-show="current === t.meta.id" :key="`${dir}-${t.meta.id}`"
        v-bind="t" :color :active="mounted(t.meta.id)"
      />
    </div>

    <!-- 지도 위에 뜨는 도구: 왼쪽 위 = 뷰어·배경지도 (누르면 펼침, 다시 누르면 닫힘), 오른쪽 = 지도 조작 -->
    <div class="float top">
      <details name="stage-pop" class="pop">
        <summary class="panel" title="뷰어 전환">
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M3 8h14" /></svg>{{ cur.meta.name }}
        </summary>
        <div class="panel menu" role="group" aria-label="뷰어 전환">
          <button
            v-for="t in tiles" :key="t.meta.id" type="button" :class="{ off: !t.output }"
            :aria-pressed="current === t.meta.id" @click="current = t.meta.id"
          >{{ t.meta.name }} <span class="small">{{ t.output ? t.meta.dims : '표시 불가' }}</span></button>
        </div>
      </details>
      <details name="stage-pop" class="pop">
        <summary class="panel" title="배경지도">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 3 7 4-7 4-7-4zM3 10.5l7 4 7-4M3 14l7 4 7-4" /></svg>{{ basemapLabels[basemap] }}
        </summary>
        <div class="panel menu">
          <div role="group" aria-label="배경지도">
            <button
              v-for="(label, k) in basemapLabels" :key="k" type="button"
              :aria-pressed="basemap === k" :disabled="k !== 'osm' && (!hasKey || abroad)" @click="basemap = k"
            >{{ label }}</button>
          </div>
          <label class="sync small" title="OpenLayers는 2D 지도 — 기울기·높이 미반영">
            <input v-model="sync" type="checkbox"> 뷰어 간 시점 공유
          </label>
          <p v-if="abroad" class="small muted">해외 범위 — OSM만 (VWorld는 국내 전용)</p>
          <p v-else-if="!hasKey" class="small muted">VWorld 인증키 없음 — OSM만</p>
        </div>
      </details>
    </div>
    <div class="float tools panel" role="group" aria-label="지도 도구">
      <button type="button" title="확대" aria-label="확대" @click="move({ zoom: camera.zoom + 1 })">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
      </button>
      <button type="button" title="축소" aria-label="축소" @click="move({ zoom: camera.zoom - 1 })">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" /></svg>
      </button>
      <hr>
      <button type="button" title="처음 위치" aria-label="처음 위치" @click="reset(view)">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 9.5 10 4l6.5 5.5M5.5 8v8h9V8" /></svg>
      </button>
      <button type="button" title="북쪽 위로, 기울기 없애기" aria-label="북쪽 위로" @click="move({ bearing: 0, pitch: 0 })">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path class="solid" d="M10 2.5l4 8h-8z" /><path d="M6 10.5h8l-4 7z" /></svg>
      </button>
      <button type="button" title="이 뷰어 코드" aria-label="이 뷰어 코드" :disabled="!cur.output" @click="openCode(cur.meta.id, cur.output!, cur.path!)">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 6 3 10l4 4M13 6l4 4-4 4" /></svg>
      </button>
      <button type="button" :title="full ? '전체 화면 끝내기' : '전체 화면'" :aria-label="full ? '전체 화면 끝내기' : '전체 화면'" @click="toggleFull">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path v-if="!full" d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" /><path v-else d="M8 4v4H4M16 8h-4V4M12 16v-4h4M4 12h4v4" /></svg>
      </button>
    </div>
    <dialog ref="drawer" class="drawer" aria-labelledby="code-title" @click.self="drawer?.close()">
      <div v-if="code" class="drawer-body">
        <header>
          <h2 id="code-title">{{ code.viewer }}로 {{ code.kind }} 그리기</h2>
          <button class="btn" type="button" @click="copy">{{ copied ? '복사됨' : '코드 복사' }}</button>
          <button class="btn" type="button" aria-label="닫기" @click="drawer?.close()">닫기</button>
        </header>
        <p class="small muted">이 뷰어가 하는 일을 줄인 최소 코드. 주소는 지금 보는 결과물.</p>
        <pre><code>{{ code.text }}</code></pre>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
/* 부모(화면 비교 단계)가 남은 높이를 다 준다. 전체 화면에서도 같은 배치 */
.stage { position: relative; flex: 1; min-height: 320px; background: var(--stage); }
.viewer { position: absolute; inset: 0; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); }

.float { position: absolute; z-index: 5; }
.panel { background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); box-shadow: 0 4px 16px rgb(22 32 42 / 0.16); }
.top { top: 12px; left: 12px; display: flex; align-items: flex-start; gap: 8px; }

/* 작은 버튼 + 아래로 펼치는 패널. 같은 name이라 하나 열면 다른 하나는 닫힌다 */
.pop { position: relative; }
.pop summary {
  list-style: none; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 10px;
  font-size: var(--fs-0); font-weight: 600; color: var(--ink); cursor: pointer; white-space: nowrap; user-select: none;
}
.pop summary::-webkit-details-marker { display: none; }
.pop summary:hover, .pop[open] summary { background: var(--paper); }
.pop summary svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.menu { position: absolute; top: calc(100% + 6px); left: 0; min-width: 100%; width: max-content; max-width: 16rem; padding: 4px; display: grid; gap: 4px; }
.menu button {
  display: flex; justify-content: space-between; gap: 12px; width: 100%; padding: 6px 10px; border: 0; border-radius: 7px;
  font: inherit; font-size: var(--fs-0); text-align: left; background: none; color: var(--ink); cursor: pointer;
}
.menu button:hover { background: var(--paper); }
.menu button span { color: var(--ink-2); }
.menu button.off { color: var(--no); }
.menu button[aria-pressed='true'] { background: var(--ink); color: #fff; }
.menu button[aria-pressed='true'] span { color: inherit; opacity: 0.7; }
.menu button:disabled { opacity: 0.4; cursor: not-allowed; }
.menu p { padding: 0 10px 4px; }
.sync { display: flex; gap: 6px; align-items: center; padding: 6px 10px 4px; border-top: 1px solid var(--rule); cursor: pointer; }

.tools { right: 12px; top: 12px; display: grid; padding: 3px; gap: 2px; }
.tools button {
  width: 34px; height: 34px; display: grid; place-items: center; padding: 0;
  border: 0; border-radius: 8px; background: none; color: var(--ink); cursor: pointer;
}
.tools button:hover:not(:disabled) { background: var(--paper); }
.tools button:disabled { opacity: 0.35; cursor: not-allowed; }
.tools svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.tools svg .solid { fill: currentColor; }
.tools hr { margin: 2px 4px; border: 0; border-top: 1px solid var(--rule); }

/* 오른쪽에서 나오는 코드 서랍 */
.drawer {
  margin: 0 0 0 auto; height: 100dvh; max-height: none; width: min(40rem, 100vw); padding: 0;
  border: 0; border-left: 1px solid var(--rule); background: var(--surface); color: var(--ink);
}
.drawer::backdrop { background: rgb(22 32 42 / 0.25); }
.drawer[open] { animation: slide 0.18s ease-out; }
@keyframes slide { from { transform: translateX(24px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .drawer[open] { animation: none; } }
.drawer-body { padding: 20px 24px; display: grid; gap: 12px; }
.drawer header { display: flex; align-items: center; gap: 8px; }
.drawer h2 { font-size: var(--fs-2); margin-right: auto; }
.drawer pre { padding: 14px 16px; overflow: auto; font-size: 0.8125rem; line-height: 1.6; }
</style>
