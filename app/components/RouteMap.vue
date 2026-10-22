<script setup lang="ts">
import { engine, kindLabels, viewers } from '#shared/viewers'
import type { FormatSpec, OutputKind, Recipe } from '#shared/types'

// 홈 노선도. 데이터 유형 하나가 노선 하나이고, 그 유형의 확장자 중 하나라도 그릴 수 있는 뷰어로만 갈라져 간다.
// 세 과정 판 위에는 유형마다 그 과정의 요소(확장자 수·정리 작업·결과물)를 얹는다.
// 웹 형태 변환에서는 노선이 파일 가지와 서버마다의 가지(저장 형태 › 서버 › 서비스)로 갈라졌다 합쳐지고, 알갱이는 그 가지의 레시피가 그릴 수 있는 뷰어로만 간다.
// 시각화·렌더링 판: 웹 렌더러 4종 + CesiumJS 아래 점선으로 엔진(Cesium for Unreal, 수동 확인). 3D Tiles·지형 결과가 있는 유형만 엔진에 잇는다.
// 카탈로그에서 그리므로 확장자·레시피가 늘면 그림도 따라 바뀐다
const emit = defineEmits<{ pick: [category: string] }>()
const stations = [
  { id: 'collect', name: flow[0].name, x: 190, w: 96, caption: '샘플 있는 확장자' },
  { id: 'preprocess', name: flow[1].name, x: 306, w: 186, caption: '주요 정리 작업 (무결성 확인은 공통)' },
  { id: 'convert', name: flow[2].name, x: 512, w: 300, caption: '파일: 결과물 형식 · 서버: 저장 형태 › 서버 › 서비스' },
].map(s => ({ ...s, cx: s.x + s.w / 2 }))
const [COLLECT, PRE, CONVERT] = stations as [typeof stations[0], typeof stations[0], typeof stations[0]]
const X0 = CONVERT.x, X1 = CONVERT.x + CONVERT.w
const FX = X1 + 18 // 갈래가 합쳐진 뒤 뷰어로 퍼지기 시작하는 곳
const TX = FX + 260
const W = TX + 200
const RENDER = { name: flow[3].name, x: TX - 20, w: W - 8 - (TX - 20), caption: '웹 렌더러 4종 · 엔진 (수동 확인)' }
const TOP = 34
const LANE = 20 // 변환 판 안 가지 간격
const FLOW = 4.2 // 알갱이 하나가 노선 끝까지 가는 시간(초)

// 전처리 단계 제목 → 작업 종류. 화면 요약용 키워드 분류라 새 단계 제목이 어디에도 안 걸리면 칩에서 빠진다
const preKinds: [string, RegExp][] = [
  ['인코딩', /UTF|인코딩/],
  ['좌표계', /좌표계|위경도|재투영|메르카토르|격자/],
  ['높이', /높이/],
  ['속성', /속성|필드/],
  ['색', /색/],
  ['도형', /도형|구멍|점 만들기/],
  ['범위', /추출|남기기/],
  ['형식', /GeoTIFF 변환|적재/],
  ['최적화', /최적화/],
  ['배치', /배치/],
]
const kindOrder: OutputKind[] = ['geojson', 'mvt', 'pmtiles', 'cog', 'xyz-raster', 'image', 'terrain-rgb', 'quantized-mesh', '3dtiles', 'glb']
const short: Partial<Record<OutputKind, string>> = { 'mvt': 'MVT', 'image': '그림', 'xyz-raster': 'XYZ', 'terrain-rgb': '지형 RGB', 'quantized-mesh': 'QM' }

type Chip = { label: string; title: string; style?: 'server' | 'store' | 'ghost'; x: number; y: number; w: number }
type Item = Pick<Chip, 'label' | 'title' | 'style'>
// 글자 폭 어림 (10px 글꼴: 한글 1em, 나머지 0.59em)
const textW = (s: string) => [...s].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? 10 : 5.9), 0)
const PAD = 5, GAP = 3
const width = (s: string) => textW(s) + PAD * 2
/** 칩 한 줄. align: 가운데(cx) 또는 오른쪽 끝(x). 칸을 넘으면 남은 것은 +n 칩 하나로 */
function chips(items: Item[], at: { cx?: number; right?: number }, y: number, max: number): Chip[] {
  const fit: Omit<Chip, 'x' | 'y'>[] = []
  let used = 0
  for (const [i, it] of items.entries()) {
    const rest = items.length - i - 1
    const room = rest ? width(`+${rest}`) + GAP : 0
    if (i && used + width(it.label) + room > max) {
      const left = items.slice(i)
      fit.push({ label: `+${left.length}`, title: left.map(x => x.title).join('\n'), w: width(`+${left.length}`) })
      break
    }
    fit.push({ ...it, w: width(it.label) })
    used += width(it.label) + GAP
  }
  const total = fit.reduce((a, c) => a + c.w, 0) + GAP * (fit.length - 1)
  let x = at.right !== undefined ? at.right - total : at.cx! - total / 2
  return fit.map(c => { const cx = x; x += c.w + GAP; return { ...c, x: cx, y } })
}

function preChips(list: FormatSpec[], y: number) {
  const titles = [...new Set(list.flatMap(f => f.recipes.flatMap(r => r.preprocess.map(s => s.title))))].filter(t => !t.startsWith('무결성 확인'))
  const found = preKinds.map(([label, re]) => ({ label, title: `${label}: ${titles.filter(t => re.test(t)).join(', ')}` })).filter(c => !c.title.endsWith(': '))
  return chips(found.length ? found : [{ label: '검사', title: '무결성 확인만' }], { cx: PRE.cx }, y, PRE.w - 12)
}

/**
 * 변환 가지. 파일: [파일 … 결과물 형식], 서버마다: [저장 형태 › 서버 › 서비스]. 결과물·서비스는 판 오른쪽 끝(뷰어 쪽)에 맞춘다.
 * 저장 형태는 서버 레시피 첫 변환 단계(PostGIS 적재 / 서버용 COG)에서 읽는다
 */
type LaneDef = { rs: Recipe[]; make: (y: number) => { chips: Chip[]; arrows: number[] } }
const L = X0 + 10, R = X1 - 10
const SX = L + width('PostGIS') + 14 // 서버 칩 열
function lanes(list: FormatSpec[]): LaneDef[] {
  const all = list.flatMap(f => f.recipes)
  const files = all.filter(r => !isService(r))
  const out: LaneDef[] = []
  if (files.length) {
    const kinds = kindOrder.filter(k => files.some(r => r.outputs.some(o => o.kind === k)))
    out.push({
      rs: files,
      make: y => ({
        chips: [
          { label: '파일', title: '파일로 구워 정적 호스팅 (서버 없음)', style: 'ghost', x: L, y, w: width('파일') },
          ...chips(kinds.map(k => ({ label: short[k] ?? kindLabels[k], title: kindLabels[k] })), { right: R }, y, R - SX),
        ],
        arrows: [],
      }),
    })
  }
  for (const name of [...new Set(all.filter(r => isService(r)).map(r => r.title))]) {
    const rs = all.filter(r => isService(r) && r.title === name)
    const firsts = [...new Set(rs.map(r => r.convert[0]!.title))]
    const store = firsts.some(t => /PostGIS/.test(t)) ? 'PostGIS' : 'COG'
    const services = [...new Set(rs.flatMap(r => r.outputs.map(o => o.label.split(' ')[0]!)))]
    out.push({
      rs,
      make: y => {
        const sw = width(name)
        const outs = chips(services.map(s => ({ label: s, title: rs.flatMap(r => r.outputs).find(o => o.label.startsWith(s))!.label })), { right: R }, y, R - SX - sw - 14)
        return {
          chips: [
            { label: store, title: `서버가 읽는 저장 형태: ${firsts.join(', ')}`, style: 'store', x: L, y, w: width(store) },
            { label: name, title: `${name} 서버`, style: 'server', x: SX, y, w: sw },
            ...outs,
          ],
          arrows: [(L + width(store) + SX) / 2, (SX + sw + outs[0]!.x) / 2],
        }
      },
    })
  }
  return out
}

// 갈래 경로: 판 들어가며 dy만큼 갈라졌다 판 끝에서 다시 합친다
const via = (y: number, dy: number) => dy ? ` H${X0 - 8} C${X0 + 8} ${y} ${X0 + 4} ${y + dy} ${X0 + 20} ${y + dy} H${X1 - 20} C${X1 - 4} ${y + dy} ${X1 - 8} ${y} ${X1 + 8} ${y}` : ''

// 줄 높이는 가지 수에 맞춘다
let top = TOP
const rows = categories.map(c => {
  const list = formatsOf(c.id).filter(f => !f.closed)
  const ls = lanes(list)
  const h = Math.max(42, ls.length * LANE + 18)
  const y = top + h / 2
  top += h
  return { c, list, ls, y }
})
const BOTTOM = top
const H = BOTTOM + 52
// 렌더러 자리 5칸(웹 4 + 엔진 1)을 노선 묶음 가운데에 맞춘다
const termY = (j: number) => (rows[0]!.y + rows.at(-1)!.y) / 2 - 160 + j * 80
const ENGINE_Y = termY(viewers.length)
const CESIUM_Y = termY(viewers.findIndex(v => v.id === engine.family))
/** 엔진으로 잇는 유형: 3D Tiles·지형 결과가 있는 것 */
const engineCats = rows.filter(r => r.list.some(f => f.recipes.some(rc => rc.outputs.some(o => engine.kinds.includes(o.kind))))).map(r => r.c)

const lines = rows.map(({ c, list, ls, y }, i) => {
  const offset = (i - (categories.length - 1) / 2) * 3.2
  const placed = ls.map((l, k) => {
    const dy = (k - (ls.length - 1) / 2) * LANE
    return { ...l, dy, ...l.make(y + dy) }
  })
  const paths = placed.flatMap(l => viewers.map((v, j) => ({ v, j })).filter(({ v }) => l.rs.some(r => supports(r, v.id)))
    .map(({ v, j }) => ({ v, d: `M170 ${y}${via(y, l.dy)} H${FX} C${FX + 150} ${y} ${TX - 150} ${termY(j) + offset} ${TX} ${termY(j) + offset}` })))
  return {
    c, y,
    paths: paths.map(p => p.d),
    stops: viewers.filter(v => paths.some(p => p.v === v)).map(v => v.name),
    chips: [
      // 수집: 확장자 수. 마우스를 올리면 확장자와 샘플 분류
      ...chips([{ label: `확장자 ${list.length}개`, title: list.map(f => `${f.extensions[0]} ${f.name} · ${sampleLabels[sampleOf(f)]}`).join('\n') }], { cx: COLLECT.cx }, y, COLLECT.w - 12),
      ...preChips(list, y),
      ...placed.flatMap(l => l.chips),
    ],
    arrows: placed.flatMap(l => l.arrows.map(x => ({ x, y: y + l.dy }))),
  }
})
/** 노선마다 출발 시점을 어긋나게 한다 (초) */
const lag = (i: number, k: number) => ((i * 0.61 + k * 1.37) % FLOW).toFixed(2)
</script>

<template>
  <svg class="route-map" :viewBox="`0 0 ${W} ${H}`" role="img" aria-labelledby="map-title">
    <title id="map-title">데이터 유형 {{ categories.length }}개가 수집(확장자 수), 전처리(정리 작업), 웹 형태 변환(파일, 또는 저장 형태 › 서버 › 서비스)을 지나 시각화·렌더링(웹 렌더러 4종, 엔진 Cesium for Unreal)으로 갈라지는 노선도</title>
    <!-- 과정 판: 노선이 가로지르도록 맨 먼저 그린다 -->
    <g v-for="s in stations" :key="s.id">
      <rect :x="s.x" y="24" :width="s.w" :height="BOTTOM + 4 - 24" rx="12" class="panel" />
      <text :x="s.cx" y="14" text-anchor="middle" class="label">{{ s.name }}</text>
      <text :x="s.cx" :y="BOTTOM + 26" text-anchor="middle" class="caption">{{ s.caption }}</text>
    </g>
    <g>
      <rect :x="RENDER.x" y="24" :width="RENDER.w" :height="BOTTOM + 4 - 24" rx="12" class="panel" />
      <text :x="RENDER.x + RENDER.w / 2" y="14" text-anchor="middle" class="label">{{ RENDER.name }}</text>
      <text :x="RENDER.x + RENDER.w / 2" :y="BOTTOM + 26" text-anchor="middle" class="caption">{{ RENDER.caption }}</text>
    </g>
    <g v-for="(l, i) in lines" :key="l.c.id">
      <a :href="`/?type=${l.c.id}`" :aria-label="`${l.c.name}: ${l.stops.join(', ')}에서 확인 가능`" @click.prevent="emit('pick', l.c.id)">
        <text x="156" :y="l.y + 5" text-anchor="end" class="cat">{{ l.c.name }}</text>
        <path
          v-for="(d, k) in l.paths" :key="k" :d="d" pathLength="1" class="line"
          :style="{ stroke: l.c.color, animationDelay: `${i * 90 + k * 40}ms` }"
        />
      </a>
    </g>
    <!-- 데이터 알갱이: 노선 위, 과정 칩 아래로 지나간다 (칩을 지날 때 잠깐 가려져 "처리 중"처럼 보인다). 시작 시점을 노선마다 어긋나게 해 흐름이 끊기지 않게 한다 -->
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
    <!-- 과정 요소: 유형마다 수집(확장자 수)·전처리(작업 칩)·변환(가지별 칩). 마우스를 올리면 자세히 -->
    <g v-for="(l, i) in lines" :key="l.c.id" class="cells" :style="{ '--c': l.c.color, animationDelay: `${700 + i * 90}ms` }" aria-hidden="true" @click="emit('pick', l.c.id)">
      <g v-for="c in l.chips" :key="`${c.x},${c.y}`" class="chip" :class="c.style">
        <title>{{ c.title }}</title>
        <rect :x="c.x" :y="c.y - 8" :width="c.w" height="16" rx="8" />
        <text :x="c.x + c.w / 2" :y="c.y + 3.5" text-anchor="middle">{{ c.label }}</text>
      </g>
      <text v-for="a in l.arrows" :key="`${a.x},${a.y}`" :x="a.x" :y="a.y + 4" text-anchor="middle" class="arrow">›</text>
    </g>
    <g v-for="(v, j) in viewers" :key="v.id">
      <rect :x="TX - 2" :y="termY(j) - 14" width="14" height="28" rx="7" class="station" />
      <text :x="TX + 24" :y="termY(j) + 1" class="label">{{ v.name }}</text>
      <text :x="TX + 24" :y="termY(j) + 19" class="dims">{{ v.dims }}</text>
    </g>
    <!-- 엔진: CesiumJS와 같은 계열(같은 형식)이라 그 아래 점선으로. 자동 확인이 없어 알갱이는 가지 않는다 -->
    <g class="engine">
      <title>{{ engine.summary }} 연결: {{ engineCats.map(c => c.name).join(', ') }}</title>
      <path :d="`M${TX + 5} ${CESIUM_Y + 14} V${ENGINE_Y - 14}`" class="link" />
      <rect :x="TX - 2" :y="ENGINE_Y - 14" width="14" height="28" rx="7" class="station" />
      <text :x="TX + 24" :y="ENGINE_Y + 1" class="label">{{ engine.name }}</text>
      <text :x="TX + 24" :y="ENGINE_Y + 19" class="dims">{{ engine.dims }} · 수동 확인</text>
      <circle v-for="(c, k) in engineCats" :key="c.id" :cx="TX + 28 + k * 12" :cy="ENGINE_Y + 34" r="4" :fill="c.color"><title>{{ c.name }}</title></circle>
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
.engine .station { stroke-dasharray: 4 3; }
.engine .link { stroke: var(--ink); stroke-width: 2; stroke-dasharray: 4 3; fill: none; }
.engine circle { stroke: var(--surface); stroke-width: 1.5; }
.panel { fill: var(--surface); stroke: var(--ink); stroke-width: 2; }
.cat { font-size: 15px; font-weight: 600; fill: var(--ink); }
.label { font-size: 15px; font-weight: 600; fill: var(--ink); }
.dims { font-size: 13px; fill: var(--ink-2); }
.caption { font-size: 11px; fill: var(--ink-2); }
.cells { cursor: pointer; opacity: 0; animation: appear 0.5s ease-out forwards; }
.chip rect { fill: var(--surface); stroke: var(--c); stroke-width: 1.3; }
.chip text { font-size: 10px; font-weight: 500; fill: var(--ink); }
/* 서버: 검정, 저장 형태(PostGIS·COG): 회색 바탕, 파일: 점선 */
.chip.server rect { fill: var(--ink); stroke: var(--ink); }
.chip.server text { fill: var(--surface); font-weight: 600; }
.chip.store rect { fill: var(--stage); stroke: var(--ink-2); }
.chip.ghost rect { stroke: var(--ink-2); stroke-dasharray: 2 2; }
.chip.ghost text { fill: var(--ink-2); }
.arrow { font-size: 15px; font-weight: 700; fill: var(--ink); paint-order: stroke; stroke: var(--surface); stroke-width: 3px; }
.cells:hover .chip rect { stroke-width: 2; }
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
  .cells { animation: none; opacity: 1; }
  .packets { display: none; }
}
</style>
