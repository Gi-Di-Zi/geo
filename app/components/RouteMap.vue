<script setup lang="ts">
import { viewers } from '#shared/viewers'

// 홈 노선도. 데이터 유형 하나가 노선 하나이고, 그 유형의 확장자 중 하나라도 그릴 수 있는 뷰어로만 갈라져 간다.
// 카탈로그에서 그리므로 확장자·레시피가 늘면 그림도 따라 바뀐다. 노선 위로 데이터 알갱이가 수집 → 변환 → 뷰어로 흐른다
const emit = defineEmits<{ pick: [category: string] }>()
const W = 1050
const lineY = (i: number) => 44 + i * 44
const stations = [{ x: 300, name: '수집' }, { x: 430, name: '전처리' }, { x: 560, name: '웹 형태 변환' }]
const termY = (j: number) => 74 + j * 86
const TX = 860
const FLOW = 4.2 // 알갱이 하나가 노선 끝까지 가는 시간(초)

const lines = computed(() => categories.map((c, i) => {
  const list = formatsOf(c.id).filter(f => !f.closed)
  const y = lineY(i)
  const offset = (i - (categories.length - 1) / 2) * 3.2
  const to = viewers.map((v, j) => ({ v, j })).filter(({ v }) => list.some(f => f.recipes.some(r => supports(r, v.id))))
  return {
    c, y, empty: !list.length,
    paths: to.map(({ j }) => `M170 ${y} H650 C760 ${y} 770 ${termY(j) + offset} ${TX} ${termY(j) + offset}`),
    stops: to.map(({ v }) => v.name),
  }
}))
const H = lineY(categories.length - 1) + 44
/** 노선마다 출발 시점을 어긋나게 한다 (초) */
const lag = (i: number, k: number) => ((i * 0.61 + k * 1.37) % FLOW).toFixed(2)
</script>

<template>
  <svg class="route-map" :viewBox="`0 0 ${W} ${H}`" role="img" aria-labelledby="map-title">
    <title id="map-title">데이터 유형 {{ categories.length }}개가 수집, 전처리, 웹 형태 변환을 지나 그릴 수 있는 뷰어로 갈라지는 노선도</title>
    <g v-for="(l, i) in lines" :key="l.c.id">
      <a :href="`/?type=${l.c.id}`" :aria-label="`${l.c.name}: ${l.stops.join(', ')}에서 확인 가능`" @click.prevent="emit('pick', l.c.id)">
        <text x="156" :y="l.y + 5" text-anchor="end" class="cat">{{ l.c.name }}</text>
        <path
          v-for="(d, k) in l.paths" :key="k" :d="d" pathLength="1" class="line"
          :style="{ stroke: l.c.color, animationDelay: `${i * 90 + k * 40}ms` }"
        />
      </a>
    </g>
    <g v-for="s in stations" :key="s.name">
      <rect :x="s.x - 10" y="24" width="20" :height="H - 48" rx="10" class="station" />
      <text :x="s.x" y="14" text-anchor="middle" class="label">{{ s.name }}</text>
    </g>
    <!-- 데이터 알갱이: 역 위를 지나가도록 역보다 나중에 그린다. 시작 시점을 노선마다 어긋나게 해 흐름이 끊기지 않게 한다 -->
    <g class="packets" aria-hidden="true">
      <template v-for="(l, i) in lines" :key="l.c.id">
        <template v-for="(d, k) in l.paths" :key="k">
          <!-- 알갱이 뒤로 끌리는 밝은 꼬리. 알갱이와 같은 시각에 출발해 같은 속도로 간다 -->
          <path :d="d" pathLength="1" class="trail" :style="{ animationDuration: `${FLOW}s`, animationDelay: `-${lag(i, k)}s` }" />
          <circle r="5.5" :fill="l.c.color" class="packet">
            <animateMotion :path="d" :dur="`${FLOW}s`" :begin="`-${lag(i, k)}s`" repeatCount="indefinite" />
          </circle>
        </template>
      </template>
    </g>
    <g v-for="(v, j) in viewers" :key="v.id">
      <rect :x="TX - 2" :y="termY(j) - 14" width="14" height="28" rx="7" class="station" />
      <text :x="TX + 24" :y="termY(j) + 1" class="label">{{ v.name }}</text>
      <text :x="TX + 24" :y="termY(j) + 19" class="dims">{{ v.dims }}</text>
    </g>
  </svg>
</template>

<style scoped>
.route-map { width: 100%; height: auto; display: block; }
a { cursor: pointer; }
.line {
  fill: none; stroke-width: 5; stroke-linecap: round; opacity: 0.92;
  stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.1s ease-out forwards;
}
a:hover .line, a:focus-visible .line { stroke-width: 7; opacity: 1; }
a:focus-visible { outline: none; }
a:focus-visible .cat, a:hover .cat { text-decoration: underline; }
.station { fill: var(--surface); stroke: var(--ink); stroke-width: 2.5; }
.cat { font-size: 15px; font-weight: 600; fill: var(--ink); }
.label { font-size: 15px; font-weight: 600; fill: var(--ink); }
.dims { font-size: 13px; fill: var(--ink-2); }
/* 노선이 다 그려진 뒤 알갱이가 나타난다 */
.packets { pointer-events: none; opacity: 0; animation: appear 0.6s ease-out 1.5s forwards; }
.packet { stroke: var(--surface); stroke-width: 2.5; }
.trail {
  fill: none; stroke: var(--surface); stroke-width: 3; stroke-linecap: round; opacity: 0.7;
  stroke-dasharray: 0.07 0.93; animation: run linear infinite;
}
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes run { from { stroke-dashoffset: 0.07; } to { stroke-dashoffset: -0.93; } }
@keyframes appear { to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .line { animation: none; stroke-dashoffset: 0; }
  .packets { display: none; }
}
</style>
