<script setup lang="ts">
import { engine, kindLabels, viewers } from '#shared/viewers'
import type { FormatSpec, Output, OutputKind, Recipe, ViewerId } from '#shared/types'

// 홈 노선도. 데이터 유형 하나가 노선 하나이고, 그 유형의 확장자 중 하나라도 그릴 수 있는 뷰어로만 갈라져 간다.
// 세 과정 판 위에는 유형마다 그 과정의 요소(확장자 수·정리 작업·결과물)를 얹는다.
// 웹 형태 변환에서는 노선이 파일 가지와 서버마다의 가지(저장 형태 › 서버 › 서비스)로 갈라졌다 합쳐지고, 알갱이는 그 가지의 레시피가 그릴 수 있는 뷰어로만 간다.
// 엔진(Cesium for Unreal)은 같은 결과 파일을 언리얼에 따로 넘기는 별개 처리: 파일 가지 중 엔진이 읽는 형식(3D Tiles·QM) 줄이
// 칩 뒤에서 [Unreal 전달] 줄로 한 번 더 갈라져 엔진 역으로 간다. 다른 형식(GLB 등)과 섞이면 판 가운데에서 형식별로 줄을 먼저 나눈다.
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
/** 엔진 가지를 그리지 않는 유형: 읽을 수는 있어도 엔진을 쓸 이유가 약함 (2.5D = 높이만 준 상자, 웹 렌더러로 충분). 변환 단계 엔진 카드는 그대로 */
const ENGINE_SKIP = ['vector-25d']
const short: Partial<Record<OutputKind, string>> = { 'mvt': 'MVT', 'image': '그림', 'xyz-raster': 'XYZ', 'terrain-rgb': '지형 RGB', 'quantized-mesh': 'QM' }

type Chip = { label: string; title: string; style?: 'server' | 'store' | 'ghost' | 'engine'; x: number; y: number; w: number }
type Item = Pick<Chip, 'label' | 'title' | 'style'>
// 글자 폭 어림 (10px 글꼴: 한글 1em, 나머지 0.59em)
const textW = (s: string) => [...s].reduce((w, ch) => w + (/[가-힣]/.test(ch) ? 10 : 5.9), 0)
const PAD = 5, GAP = 3
const width = (s: string) => textW(s) + PAD * 2
/** 칩 한 줄. align: 가운데(cx), 왼쪽 끝(left) 또는 오른쪽 끝(right). 칸을 넘으면 남은 것은 +n 칩 하나로 */
function chips(items: Item[], at: { cx?: number; left?: number; right?: number }, y: number, max: number): Chip[] {
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
  let x = at.left ?? (at.right !== undefined ? at.right - total : at.cx! - total / 2)
  return fit.map(c => { const cx = x; x += c.w + GAP; return { ...c, x: cx, y } })
}

function preChips(list: FormatSpec[], y: number) {
  const titles = [...new Set(list.flatMap(f => f.recipes.flatMap(r => r.preprocess.map(s => s.title))))].filter(t => !t.startsWith('무결성 확인'))
  const found = preKinds.map(([label, re]) => ({ label, title: `${label}: ${titles.filter(t => re.test(t)).join(', ')}` })).filter(c => !c.title.endsWith(': '))
  return chips(found.length ? found : [{ label: '검사', title: '무결성 확인만' }], { cx: PRE.cx }, y, PRE.w - 12)
}

/**
 * 변환 가지. 파일: [파일 … 결과물 형식], 서버마다: [저장 형태 › 서버 › 서비스]. 결과물·서비스는 판 오른쪽 끝(뷰어 쪽)에 맞춘다.
 * 저장 형태는 서버 레시피 첫 변환 단계(PostGIS 적재 / 서버용 COG)에서 읽는다.
 * 엔진이 읽는 형식(3D Tiles·QM)이 있는 파일 가지: 형식 칩을 판 가운데(KX)에 두고, 다른 형식과 섞이면 그 앞(SPLIT)에서 형식별 줄로 나눈다.
 * 엔진 형식 줄은 칩 뒤에서 한 번 더 갈라져 [Unreal 전달] 줄이 엔진 역으로 간다.
 * parent·at = 갈라져 나온 줄(번호)과 갈라지는 x, engine = 웹 뷰어 대신 엔진 역으로 가는 줄
 */
type LaneDef = { rs: Recipe[]; parent?: number; at?: number; engine?: true; trunk?: true; svc?: string[]; make: (y: number) => { chips: Chip[]; arrows: number[] } }
/** 서비스 이름 = 출력 이름 첫 낱말 (WMS, WMTS, WFS …). OGC API는 두 낱말 */
const serviceOf = (o: Output) => (o.label.startsWith('OGC API') ? 'OGC API' : o.label.split(' ')[0]!)
const OGC = 'OGC API'
const L = X0 + 10, R = X1 - 10
const SX = L + width('PostGIS') + 14 // 서버 칩 열
const KX = CONVERT.cx - 40 // 형식별로 나눌 때 형식 칩 열
const SPLIT = KX - 34
const kindItems = (kinds: OutputKind[]) => kinds.map(k => ({ label: short[k] ?? kindLabels[k], title: kindLabels[k] }))
const UNREAL = { label: 'Unreal 전달', title: '같은 결과 파일을 언리얼 프로젝트에 넘겨 Cesium for Unreal로 읽음 (엔진 전용 변환 없음)', style: 'engine' as const, w: width('Unreal 전달') }
function lanes(list: FormatSpec[], category: string): LaneDef[] {
  const all = list.flatMap(f => f.recipes)
  const files = all.filter(r => !isService(r))
  const out: LaneDef[] = []
  // 엔진 형식 줄 번호와 그 칩 끝. [Unreal 전달] 줄은 서버 줄까지 다 놓은 뒤 맨 바깥(아래)에 둔다 → 합류하는 줄들과 나가는 줄 하나로 갈려 보인다
  let unreal: { parent: number; at: number } | undefined
  if (files.length) {
    const kinds = kindOrder.filter(k => files.some(r => r.outputs.some(o => o.kind === k)))
    const eng = ENGINE_SKIP.includes(category) ? [] : kinds.filter(k => engine.kinds.includes(k))
    const web = kinds.filter(k => !eng.includes(k))
    const file = { label: '파일', title: '파일로 구워 정적 호스팅 (서버 없음)', style: 'ghost' as const, w: width('파일') }
    const at = (ks: OutputKind[], y: number) => chips(kindItems(ks), { left: KX }, y, R - KX)
    if (!eng.length) out.push({ rs: files, make: y => ({ chips: [{ ...file, x: L, y }, ...chips(kindItems(kinds), { right: R }, y, R - SX)], arrows: [] }) })
    else {
      // 줄기 = 파일 칩 + 엔진 형식 줄. 노선 그대로 곧게 가고, 다른 형식(GLB 등)은 판 가운데에서 위로 갈라진다
      const trunk = out.length + (web.length ? 1 : 0)
      if (web.length) out.push({ rs: files, parent: trunk, at: SPLIT, make: y => ({ chips: at(web, y), arrows: [] }) })
      out.push({ rs: files, trunk: true, make: y => ({ chips: [{ ...file, x: L, y }, ...at(eng, y)], arrows: [] }) })
      unreal = { parent: trunk, at: KX + kindItems(eng).reduce((a, c) => a + width(c.label) + GAP, 0) + 6 }
    }
  }
  for (const name of [...new Set(all.filter(r => isService(r)).map(r => r.title))]) {
    const rs = all.filter(r => isService(r) && r.title === name)
    const firsts = [...new Set(rs.map(r => r.convert[0]!.title))]
    const store = firsts.some(t => /PostGIS/.test(t)) ? 'PostGIS' : 'COG'
    const served = rs.flatMap(r => r.outputs)
    // SAFETY: s는 아래 services(= served의 서비스 이름)에서만 오므로 항상 찾음
    const titleOf = (s: string) => served.find(o => serviceOf(o) === s)!.label
    // OGC API는 기존 서비스(WMS·WMTS·WFS)의 후속 표준 → 서버 칩 뒤에서 아래 줄로 갈라졌다가 판 끝에서 다시 합류
    const services = [...new Set(served.map(serviceOf))]
    const classic = services.filter(s => s !== OGC)
    const sw = width(name)
    const trunk = out.length
    out.push({
      rs,
      ...(services.includes(OGC) && { svc: classic }),
      make: y => {
        const outs = chips(classic.map(s => ({ label: s, title: titleOf(s) })), { right: R }, y, R - SX - sw - 14)
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
    if (services.includes(OGC)) {
      const at = SX + sw + 4
      out.push({
        rs, svc: [OGC], parent: trunk, at,
        make: y => {
          const c = chips([{ label: OGC, title: `${titleOf(OGC)} — WFS의 후속 표준 (REST·GeoJSON)` }], { right: R }, y, R - at)
          // 화살표: 갈라져 내려온 곡선(폭 24 + 한 줄 높이 / 2, into의 shift와 같음)이 끝난 곳과 칩 사이. SAFETY: 칩 하나를 넣었으니 c[0]은 있음
          return { chips: c, arrows: [(at + 24 + LANE / 2 + c[0]!.x) / 2] }
        },
      })
    }
  }
  if (unreal) out.push({ rs: files, ...unreal, engine: true, make: y => ({ chips: [{ ...UNREAL, x: R - UNREAL.w, y }], arrows: [] }) })
  return out
}

// 갈래 경로. into = 판 입구에서 첫 줄로 들어가 갈라지는 곳(at)마다 다음 줄로 옮겨 탄다, back = 판 끝에서 노선으로 다시 합류.
// 판 안 갈래는 내려가는 폭만큼 길게 (다른 줄을 건너갈 때 가파르지 않게)
type Hop = { dy: number; at?: number }
const shift = (y: number, x: number, from: number, to: number, w = 24) => from === to ? '' : ` H${x} C${x + w * 0.66} ${y + from} ${x + w * 0.33} ${y + to} ${x + w} ${y + to}`
const into = (y: number, hops: Hop[]) => hops.map((h, i) => i
  ? shift(y, h.at!, hops[i - 1]!.dy, h.dy, 24 + Math.abs(h.dy - hops[i - 1]!.dy) / 2)
  : shift(y, X0 - 6, 0, h.dy)).join('')
const back = (y: number, dy: number) => dy ? ` H${X1 - 20} C${X1 - 4} ${y + dy} ${X1 - 8} ${y} ${X1 + 8} ${y}` : ''

// 줄 높이는 가지 수에 맞춘다. 가지들은 노선(y) 가운데에 맞추고, 줄기(엔진 형식 파일 줄)가 있으면 줄기를 노선 위에 둔다
// → 줄기는 판 입구에서 꺾이지 않고 곧게 가다 갈라진다
let top = TOP
const rows = categories.map(c => {
  const list = formatsOf(c.id).filter(f => !f.closed)
  const ls = lanes(list, c.id)
  const t = ls.findIndex(l => l.trunk)
  const dys = ls.map((_, k) => (t < 0 ? k - (ls.length - 1) / 2 : k - t) * LANE)
  const h = Math.max(42, ls.length * LANE + 18)
  const y = top + (h - (ls.length - 1) * LANE) / 2 - dys[0]!
  top += h
  return { c, list, ls, y, dys }
})
const BOTTOM = top
const H = BOTTOM + 52
// 렌더러 자리 5칸(웹 4 + 엔진 1)을 노선 묶음 가운데에 맞춘다
const termY = (j: number) => (rows[0]!.y + rows.at(-1)!.y) / 2 - 160 + j * 80
const ENGINE_Y = termY(viewers.length)
const engineCats = rows.filter(r => r.ls.some(l => l.engine)).map(r => r.c)

/** 레시피가 뷰어로 이어지는지. svc가 있는 줄(서비스별로 나뉜 서버 줄)은 그 뷰어가 쓰는 출력의 서비스가 그 줄 것일 때만 */
function reaches(r: Recipe, v: ViewerId, svc?: string[]) {
  if (!supports(r, v)) return false
  const use = r.viewers[v]
  const o = 'output' in use ? r.outputs.find(x => x.id === use.output) : undefined
  return !svc || (!!o && svc.includes(serviceOf(o)))
}

const lines = rows.map(({ c, list, ls, y, dys }, i) => {
  const offset = (i - (categories.length - 1) / 2) * 3.2
  const dyOf = (k: number) => dys[k]!
  const hops = (k: number): Hop[] => [...(ls[k]!.parent === undefined ? [] : hops(ls[k]!.parent!)), { dy: dyOf(k), at: ls[k]!.at }]
  const placed = ls.map((l, k) => ({ ...l, dy: dyOf(k), hops: hops(k), ...l.make(y + dyOf(k)) }))
  // 웹 줄: 판 끝에서 노선으로 합류해 그 가지의 레시피가 그릴 수 있는 뷰어로. 엔진 줄: 줄 끝(R)에서 엔진 역으로 바로
  const ey = ENGINE_Y + offset
  const paths = placed.flatMap(l => l.engine
    ? [{ j: viewers.length, d: `M170 ${y}${into(y, l.hops)} H${R} C${R + 170} ${y + l.dy} ${TX - 170} ${ey} ${TX} ${ey}` }]
    : viewers.flatMap((v, j) => l.rs.some(r => reaches(r, v.id, l.svc)) ? [j] : [])
      .map(j => ({ j, d: `M170 ${y}${into(y, l.hops)}${back(y, l.dy)} H${FX} C${FX + 150} ${y} ${TX - 150} ${termY(j) + offset} ${TX} ${termY(j) + offset}` })))
  return {
    c, y,
    paths: paths.map(p => p.d),
    stops: [...viewers, engine].filter((_, j) => paths.some(p => p.j === j)).map(v => v.name),
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
// 마우스·포커스가 닿은 노선만 또렷하게, 나머지는 흐리게 → 얽힌 곡선 속에서 노선 하나를 따라갈 수 있다
const hot = ref('')
const dim = (id: string) => ({ dim: !!hot.value && hot.value !== id })
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
      <a
        :href="`/viz?type=${l.c.id}`" :aria-label="`${l.c.name}: ${l.stops.join(', ')}에서 확인 가능`" :class="dim(l.c.id)"
        @click.prevent="emit('pick', l.c.id)" @mouseenter="hot = l.c.id" @mouseleave="hot = ''" @focus="hot = l.c.id" @blur="hot = ''"
      >
        <text x="156" :y="l.y + 5" text-anchor="end" class="cat">{{ l.c.name }}</text>
        <path
          v-for="(d, k) in l.paths" :key="k" :d="d" pathLength="1" class="line"
          :style="{ stroke: l.c.color, animationDelay: `${i * 90 + k * 40}ms` }"
        />
      </a>
    </g>
    <!-- 데이터 알갱이: 노선 위, 과정 칩 아래로 지나간다 (칩을 지날 때 잠깐 가려져 "처리 중"처럼 보인다). 시작 시점을 노선마다 어긋나게 해 흐름이 끊기지 않게 한다 -->
    <g class="packets" aria-hidden="true">
      <g v-for="(l, i) in lines" :key="l.c.id" :class="dim(l.c.id)">
        <template v-for="(d, k) in l.paths" :key="k">
          <!-- 알갱이 뒤로 끌리는 밝은 꼬리. 알갱이와 같은 시각에 출발해 같은 속도로 간다 -->
          <path :d="d" pathLength="1" class="trail" :style="{ animationDuration: `${FLOW}s`, animationDelay: `-${lag(i, k)}s` }" />
          <circle r="5.5" :fill="l.c.color" class="packet">
            <animateMotion :path="d" :dur="`${FLOW}s`" :begin="`-${lag(i, k)}s`" repeatCount="indefinite" />
          </circle>
        </template>
      </g>
    </g>
    <!-- 과정 요소: 유형마다 수집(확장자 수)·전처리(작업 칩)·변환(가지별 칩). 마우스를 올리면 자세히 -->
    <g
      v-for="(l, i) in lines" :key="l.c.id" class="cells" :class="dim(l.c.id)" :style="{ '--c': l.c.color, animationDelay: `${700 + i * 90}ms` }" aria-hidden="true"
      @click="emit('pick', l.c.id)" @mouseenter="hot = l.c.id" @mouseleave="hot = ''"
    >
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
    <!-- 엔진: 변환 판의 엔진 가지가 들어오는 역. 웹 밖이라 확인은 수동 -->
    <g class="engine">
      <title>{{ engine.summary }} 연결: {{ engineCats.map(c => c.name).join(', ') }}</title>
      <rect :x="TX - 2" :y="ENGINE_Y - 14" width="14" height="28" rx="7" class="station" />
      <text :x="TX + 24" :y="ENGINE_Y + 1" class="label">{{ engine.name }}</text>
      <text :x="TX + 24" :y="ENGINE_Y + 19" class="dims">{{ engine.dims }} · 수동 확인</text>
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
a:hover .line, a:focus-visible .line { stroke-width: 7; opacity: 1; }a:focus-visible { outline: none; }
a:focus-visible .cat, a:hover .cat { text-decoration: underline; }
.station { fill: var(--surface); stroke: var(--ink); stroke-width: 2.5; }
.engine .station { stroke-dasharray: 4 3; }
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
/* Unreal 전달: 엔진 역처럼 검정 점선 */
.chip.engine rect { stroke: var(--ink); stroke-width: 1.5; stroke-dasharray: 3 2; }
.chip.engine text { font-weight: 600; }.arrow { font-size: 15px; font-weight: 700; fill: var(--ink); paint-order: stroke; stroke: var(--surface); stroke-width: 3px; }
.cells:hover .chip rect { stroke-width: 2; }
/* 다른 노선에 마우스 → 흐리게. .cells는 나타나기 애니메이션이 opacity를 쥐고 있어 자식에 준다 */
a.dim, .packets .dim, .cells.dim > * { opacity: 0.12; transition: opacity 0.15s; }
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
