<script setup lang="ts">
// 줌 0 → 1 → 2: 한 장이 네 장씩. 부모 (1/1/0)의 자식 넷 중 (2/3/1)까지 따라감. 원점은 왼쪽 위
const S = 120

const levels = [
  { z: 0, n: 1, x: 10 },
  { z: 1, n: 2, x: 180 },
  { z: 2, n: 4, x: 350 },
]

// 세계 대륙 흉내 (장식)
const land = [
  'M14 30c12-12 34-14 46-4 8 7 4 20-8 24-12 4-14 16-26 14C14 62 4 42 14 30z',
  'M66 18c16-8 40-6 48 8 6 11-2 22-14 22-8 0-12 8-20 6-10-3-22-12-20-22 1-6 2-11 6-14z',
  'M70 66c8-4 18 0 20 10 2 12-6 26-14 24-8-2-10-14-10-22 0-6 0-10 4-12z',
  'M96 84c8-2 16 2 16 8s-6 10-12 8-10-4-10-8 2-7 6-8z',
]

const grid = (n: number) => Array.from({ length: n - 1 }, (_, j) => `M${(j + 1) * S / n} 0v${S}M0 ${(j + 1) * S / n}h${S}`).join('')
</script>

<template>
  <svg class="nf f-xyz" viewBox="0 0 480 222" role="img" aria-label="줌 0의 타일 한 장이 줌 1에서 네 장, 줌 2에서 열여섯 장으로 나뉨. 부모 타일 하나의 자식 네 장을 따라 2/3/1 타일까지">
    <g v-for="(lv, k) in levels" :key="lv.z" :transform="`translate(${lv.x} 34)`" :class="`lv lv${k}`">
      <rect :width="S" :height="S" class="sea" />
      <path v-for="d in land" :key="d" :d="d" class="land" />
      <rect v-if="k === 1" x="60" width="60" height="60" class="hl" />
      <template v-if="k === 2">
        <rect x="60" width="60" height="60" class="kids" />
        <rect x="90" y="30" width="30" height="30" class="hl one grow" />
      </template>
      <path v-if="lv.n > 1" :d="grid(lv.n)" pathLength="1" class="grid" />
      <rect :width="S" :height="S" class="frame" :class="{ pick: k === 0 }" />
      <text :x="S / 2" :y="S + 18" text-anchor="middle" class="cap strong">z{{ lv.z }} · {{ lv.n * lv.n }}장</text>
    </g>

    <g class="ids1" transform="translate(180 34)">
      <text x="30" y="34" class="mono id" text-anchor="middle">0,0</text>
      <text x="90" y="34" class="mono id" text-anchor="middle">1,0</text>
      <text x="30" y="94" class="mono id" text-anchor="middle">0,1</text>
      <text x="90" y="94" class="mono id" text-anchor="middle">1,1</text>
    </g>
    <g class="ids2" transform="translate(350 34)">
      <text v-for="i in 4" :key="`x${i}`" :x="(i - 0.5) * 30" y="-5" class="mono id" text-anchor="middle">{{ i - 1 }}</text>
      <text v-for="i in 4" :key="`y${i}`" x="-5" :y="(i - 0.5) * 30 + 3" class="mono id" text-anchor="end">{{ i - 1 }}</text>
      <text x="126" y="-5" class="cap">x</text>
      <text x="-5" y="134" class="cap" text-anchor="end">y</text>
    </g>
    <text x="410" y="186" text-anchor="middle" class="mono pickname">2/3/1</text>

    <g class="step1"><text x="155" y="118" text-anchor="middle" class="cap strong">×4</text><path d="M140 124h30m-5-4 5 4-5 4" class="arrow" /></g>
    <g class="step2"><text x="325" y="118" text-anchor="middle" class="cap strong">×4</text><path d="M310 124h30m-5-4 5 4-5 4" class="arrow" /></g>

    <text x="240" y="214" text-anchor="middle" class="cap note">줌 z의 타일 수 = 4^z · 원점은 왼쪽 위, y는 아래로 (TMS는 아래에서 위로)</text>
  </svg>
</template>

<style scoped>
.frame { fill: none; stroke: #8FA0AE; stroke-width: 1; }
.frame.pick { stroke: var(--c); stroke-width: 2; }
.grid { fill: none; stroke: #8FA0AE; stroke-width: 1; stroke-dasharray: 1; }
.hl { fill: color-mix(in srgb, var(--c) 30%, transparent); stroke: var(--c); stroke-width: 1.5; }
.hl.one { fill: color-mix(in srgb, var(--c) 55%, transparent); stroke-width: 2; }
.kids { fill: color-mix(in srgb, var(--c) 12%, transparent); }
.id { font-size: 9px; fill: var(--ink-2); }
.pickname { font-size: 12px; font-weight: 500; fill: var(--c); }
.arrow { fill: none; stroke: var(--ink-2); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

.lv0 { animation: nf-in 0.3s both; }
.step1 { animation: nf-in 0.3s both 0.6s; }
.lv1 { animation: nf-in 0.3s both 0.8s; }
.lv1 .grid { animation: nf-draw 0.5s ease-out both 0.9s; }
.lv1 .hl, .ids1 { animation: nf-in 0.3s both 1.5s; }
.step2 { animation: nf-in 0.3s both 1.9s; }
.lv2 { animation: nf-in 0.3s both 2.1s; }
.lv2 .grid { animation: nf-draw 0.6s ease-out both 2.2s; }
.lv2 .kids { animation: nf-in 0.3s both 2.9s; }
.lv2 .one { animation: nf-pop 0.4s cubic-bezier(0.3, 1.5, 0.6, 1) both 3.3s; }
.ids2, .pickname { animation: nf-in 0.3s both 3.6s; }
.note { animation: nf-in 0.4s both 3.9s; }
</style>
