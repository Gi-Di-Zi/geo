<script setup lang="ts">
// ① 좌표(점) → ② 육각 칸으로 나누기 → ③ 칸마다 세기. 같은 칸 ID끼리 세면 집계.
// 좌표는 소수 한 자리로 반올림 (서버·브라우저의 sin·cos 끝자리 차이로 하이드레이션이 어긋나지 않게)
const S = 120
const R = 15
const W = Math.sqrt(3) * R
const r1 = (v: number) => Math.round(v * 10) / 10

// 칸 중심: 뾰족한 위 육각형, 홀수 줄은 반 칸 밀기. 판 밖까지 한 줄·한 칸 더 → 가장자리도 채움
const centers = Array.from({ length: 7 }, (_, row) => Array.from({ length: 6 }, (_, col) => ({ x: r1(col * W + (row % 2 ? W / 2 : 0)), y: r1(row * 1.5 * R) }))).flat()

const hexPath = (c: { x: number; y: number }) => `${Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30)

  return `${i ? 'L' : 'M'}${r1(c.x + R * Math.cos(a))} ${r1(c.y + R * Math.sin(a))}`
}).join('')}z`

const grid = centers.map(hexPath).join('')

// 점: 고정 난수로 두 무리 + 흩어진 점
let seed = 7
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const blob = (cx: number, cy: number, s: number, n: number) => Array.from({ length: n }, () => ({ x: r1(cx + (rand() + rand() + rand() - 1.5) * s), y: r1(cy + (rand() + rand() + rand() - 1.5) * s) }))
const pts = [...blob(40, 46, 30, 34), ...blob(88, 88, 22, 18), ...blob(60, 60, 80, 16)].filter(p => p.x > 3 && p.x < S - 3 && p.y > 3 && p.y < S - 3)

// 점이 든 칸 = 가장 가까운 중심 (육각 격자에서는 같음)
const dist = (c: { x: number; y: number }, p: { x: number; y: number }) => (c.x - p.x) ** 2 + (c.y - p.y) ** 2
const counts = centers.map(() => 0)

for (const p of pts) counts[centers.reduce((b, c, i) => (dist(c, p) < dist(centers[b]!, p) ? i : b), 0)]!++

const max = Math.max(...counts)
const cells = centers.map((c, i) => ({ ...c, d: hexPath(c), n: counts[i]! })).filter(c => c.n)
const top = cells.find(c => c.n === max)!
const panels = [10, 180, 350]
</script>

<template>
  <svg class="nf f-dggs" viewBox="0 0 480 222" role="img" :aria-label="`점 ${pts.length}개를 육각형 칸으로 나누고 칸마다 점 수를 셈. 가장 많은 칸은 ${max}개`">
    <defs><clipPath id="nf-dggs-clip"><rect :width="S" :height="S" /></clipPath></defs>

    <g v-for="(x, k) in panels" :key="x" :transform="`translate(${x} 34)`" :class="`p p${k + 1}`">
      <rect :width="S" :height="S" class="card" />
      <g clip-path="url(#nf-dggs-clip)">
        <template v-if="k === 2">
          <path v-for="c in cells" :key="c.d" :d="c.d" class="cell" :style="{ fillOpacity: r1(0.1 + 0.55 * c.n / max) }" />
          <path :d="grid" class="grid" />
          <text v-for="c in cells" :key="`n${c.d}`" :x="c.x" :y="c.y + 3" text-anchor="middle" class="mono n">{{ c.n }}</text>
        </template>
        <template v-else>
          <circle v-for="(p, i) in pts" :key="i" :cx="p.x" :cy="p.y" r="1.8" class="pt" />
          <path v-if="k === 1" :d="grid" pathLength="1" class="grid draw" />
        </template>
      </g>
      <path v-if="k === 2" :d="top.d" class="pick grow" />
      <rect :width="S" :height="S" class="frame" />
      <text :x="S / 2" :y="S + 18" text-anchor="middle" class="cap strong">{{ ['① 좌표 (점)', '② 칸으로 나누기', '③ 칸마다 세기'][k] }}</text>
    </g>

    <g class="step1"><text x="155" y="88" text-anchor="middle" class="cap">칸 ID</text><path d="M140 96h30m-5-4 5 4-5 4" class="arrow" /></g>
    <g class="step2"><text x="325" y="88" text-anchor="middle" class="cap">세기</text><path d="M310 96h30m-5-4 5 4-5 4" class="arrow" /></g>
    <text x="410" y="190" text-anchor="middle" class="cap pickname">가장 많은 칸 {{ max }}곳</text>

    <text x="240" y="214" text-anchor="middle" class="cap note">점마다 다른 좌표 대신 칸 ID → 같은 ID끼리 세면 집계, 같은 ID로 다른 표와 붙이면 조인</text>
  </svg>
</template>

<style scoped>
.frame { fill: none; stroke: #8FA0AE; stroke-width: 1; }
.pt { fill: var(--c); }
.grid { fill: none; stroke: #8FA0AE; stroke-width: 0.8; }
.grid.draw { stroke-dasharray: 1; }
.cell { fill: var(--c); }
.n { font-size: 8px; font-weight: 600; }
.pick { fill: none; stroke: var(--ink); stroke-width: 2; }
.pickname { font-weight: 600; fill: var(--c); }
.arrow { fill: none; stroke: var(--ink-2); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

.p1 { animation: nf-in 0.3s both; }
.step1 { animation: nf-in 0.3s both 0.6s; }
.p2 { animation: nf-in 0.3s both 0.8s; }
.p2 .draw { animation: nf-draw 0.7s ease-out both 0.9s; }
.step2 { animation: nf-in 0.3s both 1.8s; }
.p3 { animation: nf-in 0.3s both 2s; }
.p3 .n { animation: nf-in 0.3s both 2.4s; }
.pick { animation: nf-pop 0.4s cubic-bezier(0.3, 1.5, 0.6, 1) both 2.8s; }
.pickname { animation: nf-in 0.3s both 3.1s; }
.note { animation: nf-in 0.4s both 3.4s; }
</style>
