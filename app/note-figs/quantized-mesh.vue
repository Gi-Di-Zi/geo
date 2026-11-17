<script setup lang="ts">
// 같은 언덕: ① 격자 칸마다 높이 → ② 높이 변화가 큰 곳만 잘게 나눈 삼각형(평지는 큰 삼각형) → ③ 정점 u·v·h를 0~32767 정수로
// 높이장은 오른쪽 위 언덕 하나. 사각형을 높이 차가 클 때만 4등분하고 대각선으로 삼각형 2개 (모식도)
const S = 16
const hill = (x: number, y: number) => Math.max(0, 1 - ((x / S - 6) ** 2 + (y / S - 2.5) ** 2) / 6)

const cells = Array.from({ length: 64 }, (_, k) => {
  const i = k % 8
  const j = Math.floor(k / 8)
  const v = hill(i * S + S / 2, j * S + S / 2)

  return { x: i * S, y: j * S, fill: `color-mix(in srgb, #5E7A3A ${Math.round(v * 85)}%, #EEF2EA)`, delay: `${0.2 + (i + j) * 0.04}s` }
})

const quads: { x: number; y: number; s: number }[] = []

function split(x: number, y: number, s: number) {
  const hs = [hill(x, y), hill(x + s, y), hill(x, y + s), hill(x + s, y + s), hill(x + s / 2, y + s / 2)]
  const h = s / 2

  if (s > S && Math.max(...hs) - Math.min(...hs) > 0.12) {
    split(x, y, h)
    split(x + h, y, h)
    split(x, y + h, h)
    split(x + h, y + h, h)

    return
  }

  quads.push({ x, y, s })
}

split(0, 0, 64)

split(64, 0, 64)

split(0, 64, 64)

split(64, 64, 64)

const mesh = quads.map(q => `M${q.x} ${q.y}h${q.s}v${q.s}h${-q.s}zM${q.x} ${q.y}l${q.s} ${q.s}`).join('')
const verts = [...new Set(quads.flatMap(q => [`${q.x},${q.y}`, `${q.x + q.s},${q.y}`, `${q.x},${q.y + q.s}`, `${q.x + q.s},${q.y + q.s}`]))].map(p => p.split(',').map(Number))

const rows = [
  ['0', '0', '0'],
  ['32767', '0', '4096'],
  ['24575', '12287', '32767'],
  ['8191', '32767', '0'],
]
</script>

<template>
  <svg class="nf f-qm" viewBox="0 0 480 222" role="img" aria-label="같은 언덕을 격자 높이에서 높이 변화가 큰 곳만 잘게 나눈 삼각형 메시로 바꾸고, 정점의 위치와 높이를 0부터 32767까지의 정수로 저장하는 과정">
    <text x="16" y="16" class="cap strong">① DEM 격자</text>
    <text x="176" y="16" class="cap strong">② 삼각형 메시 (TIN)</text>
    <text x="336" y="16" class="cap strong">③ 정수로 양자화</text>

    <g transform="translate(16 24)">
      <rect v-for="c in cells" :key="`${c.x},${c.y}`" :x="c.x" :y="c.y" :width="S" :height="S" :style="{ fill: c.fill, animationDelay: c.delay }" class="cell" />
      <rect width="128" height="128" class="frame" />
    </g>
    <path d="M150 88h20m-5-4 5 4-5 4" class="arrow a1" />

    <g transform="translate(176 24)">
      <rect width="128" height="128" class="tin-bg" />
      <path :d="mesh" pathLength="1" class="tin" />
      <circle v-for="([x, y]) in verts" :key="`${x},${y}`" :cx="x" :cy="y" r="1.7" class="vert" />
    </g>
    <path d="M310 88h20m-5-4 5 4-5 4" class="arrow a2" />

    <rect x="336" y="24" width="134" height="128" rx="6" class="card" />
    <text x="376" y="44" text-anchor="end" class="mono strong">u</text>
    <text x="420" y="44" text-anchor="end" class="mono strong">v</text>
    <text x="462" y="44" text-anchor="end" class="mono strong">h</text>
    <path d="M344 52h118" class="rule" />
    <g v-for="(r, i) in rows" :key="i" class="row" :style="{ animationDelay: `${3 + i * 0.25}s` }">
      <text x="376" :y="70 + i * 20" text-anchor="end" class="mono num">{{ r[0] }}</text>
      <text x="420" :y="70 + i * 20" text-anchor="end" class="mono num">{{ r[1] }}</text>
      <text x="462" :y="70 + i * 20" text-anchor="end" class="mono num">{{ r[2] }}</text>
    </g>

    <g class="caps1">
      <text x="16" y="170" class="cap s">픽셀마다 높이 (실수)</text>
      <text x="16" y="185" class="cap s">원본 · 분석용</text>
    </g>
    <g class="caps2">
      <text x="176" y="170" class="cap s">평지는 큰, 험지는 작은 삼각형</text>
      <text x="176" y="185" class="cap s">+ 삼각형 인덱스 · 경계 정점(skirt)</text>
    </g>
    <g class="caps3">
      <text x="336" y="170" class="cap s">u·v·h: 0~32767 정수 (예시)</text>
      <text x="336" y="185" class="cap s">h → 타일 최소~최대 높이로 복원</text>
    </g>
    <text x="240" y="212" text-anchor="middle" class="cap strong foot">layer.json(목차) + z/x/y.terrain 타일 → CesiumJS 지형</text>
  </svg>
</template>

<style scoped>
.frame { fill: none; stroke: #8FA0AE; }
.tin-bg { fill: #F4F6F1; stroke: #8FA0AE; }
.tin { fill: none; stroke: var(--c); stroke-width: 0.9; stroke-dasharray: 1; }
.vert { fill: var(--c); }
.arrow { fill: none; stroke: var(--ink-2); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.s { font-size: 10px; }
.num { font-size: 10.5px; }

.cell { animation: nf-in 0.3s both; }
.caps1 { animation: nf-in 0.3s both 0.9s; }
.a1 { animation: nf-in 0.3s both 1.2s; }
.tin { animation: nf-draw 1s ease-in-out both 1.4s; }
.vert { animation: nf-in 0.3s both 2.3s; }
.caps2 { animation: nf-in 0.3s both 2.4s; }
.a2 { animation: nf-in 0.3s both 2.7s; }
.row { animation: nf-in 0.3s both; }
.caps3 { animation: nf-in 0.3s both 4s; }
.foot { animation: nf-in 0.4s both 4.4s; }
</style>
