<script setup lang="ts">
// 같은 서울시청 한 점을 세 가지로 적기: 지구본 위 각도(지리) → 평면에 펼쳐 미터(투영) → 지구 중심에서 X·Y·Z(지심)
// 지구본은 비스듬히 본 모식도 (축척 아님). 숫자는 실제 서울시청 값
const vLines = [296, 330, 364, 398, 432]
const hLines = [54, 80, 106]
</script>

<template>
  <svg class="nf f-crs" viewBox="0 0 480 250" role="img" aria-label="서울시청 한 점을 지리 좌표계는 경도·위도 각도로, 투영 좌표계는 평면의 동·북 미터로, 지심 좌표계는 지구 중심 기준 X·Y·Z 미터로 적는 그림">
    <g class="globe">
      <ellipse cx="115" cy="135" rx="88" ry="82" class="earth" />
      <ellipse cx="115" cy="135" rx="88" ry="16" class="line" />
      <ellipse cx="115" cy="82" rx="67" ry="12" class="line" />
      <ellipse cx="115" cy="188" rx="67" ry="12" class="line" />
      <path d="M115 53V217" class="line" />
      <path d="M115 53C140 58 154 74 158 91C163 112 167 130 166 148C164 175 145 205 115 217" class="line" />
    </g>

    <path d="M115 135L166 148M115 135L158 91" pathLength="1" class="helper" />
    <path d="M115 151A88 16 0 0 0 166 148" pathLength="1" class="arc arc-l" />
    <path d="M140.2 141.4A26 26 0 0 0 133.2 116.4" pathLength="1" class="arc arc-p" />
    <g class="lab-g">
      <text x="146" y="126" class="cap g">φ 위도</text>
      <text x="122" y="168" class="cap g">λ 경도</text>
    </g>
    <circle cx="158" cy="91" r="4.5" class="pt grow" />
    <g class="geo-t">
      <text x="12" y="20" class="cap strong g">지리 좌표계 (EPSG:4326)</text>
      <text x="12" y="36" class="mono">126.978°, 37.567°</text>
    </g>

    <path d="M162 88C210 40 290 36 334 62" pathLength="1" class="proj-path" />
    <path d="M326 54l8 8-11 1" class="proj-head" />
    <text x="222" y="74" text-anchor="middle" class="cap p proj-lab">투영 (TM 등)</text>
    <g class="plane">
      <text x="262" y="18" class="cap strong p">투영 좌표계 (EPSG:5186)</text>
      <rect x="262" y="26" width="206" height="106" rx="6" class="paper" />
      <path v-for="x in vLines" :key="`v${x}`" :d="`M${x} 26V132`" class="grid" />
      <path v-for="y in hLines" :key="`h${y}`" :d="`M262 ${y}H468`" class="grid" />
      <path d="M272 124H322M316 119l6 5-6 5M272 124V78M267 84l5-6 5 6" class="axis" />
      <text x="326" y="128" class="cap p">X 동</text>
      <text x="278" y="76" class="cap p">Y 북</text>
      <rect x="350" y="31" width="114" height="18" rx="3" class="tagbg" />
      <text x="458" y="44" text-anchor="end" class="mono small">동 198,054 · 북 551,897 m</text>
    </g>
    <circle cx="338" cy="64" r="4.5" class="pt2 grow" />

    <path d="M115 135V44M115 135L62 176M115 135L214 128" pathLength="1" class="axes" />
    <g class="axes-t">
      <text x="120" y="50" class="cap e">Z</text>
      <text x="50" y="188" class="cap e">X</text>
      <text x="218" y="126" class="cap e">Y</text>
      <text x="76" y="126" class="cap e">중심</text>
    </g>
    <path d="M115 135L156 93" pathLength="1" class="vec" />
    <circle cx="115" cy="135" r="2.8" class="o" />
    <g class="ecef">
      <rect x="262" y="150" width="206" height="88" rx="8" class="ecard" />
      <text x="274" y="170" class="cap strong e">지심 좌표계 (ECEF, EPSG:4978)</text>
      <text x="274" y="192" class="mono">X  −3,044,800 m</text>
      <text x="274" y="209" class="mono">Y   4,043,800 m</text>
      <text x="274" y="226" class="mono">Z   3,867,400 m</text>
    </g>
    <text x="12" y="242" class="cap hgt">높이는 기준이 따로: 타원체고 h · 정표고 H</text>
  </svg>
</template>

<style scoped>
.f-crs { --g: #C8323C; --p: #2C5FD4; --e: #2F855A; }
.g { fill: var(--g); }
.p { fill: var(--p); }
.e { fill: var(--e); }
.small { font-size: 10px; }
.earth { fill: #EEF3F7; stroke: #8FA0AE; }
.line { fill: none; stroke: #B9C3CC; }
.helper { fill: none; stroke: #8FA0AE; stroke-dasharray: 1; stroke-width: 1; }
.arc { fill: none; stroke: var(--g); stroke-width: 2.4; stroke-dasharray: 1; stroke-linecap: round; }
.pt { fill: var(--g); }
.proj-path { fill: none; stroke: var(--p); stroke-width: 1.6; stroke-dasharray: 1; }
.proj-head { fill: none; stroke: var(--p); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.paper { fill: #F4F7FA; stroke: var(--p); }
.grid { stroke: #D3DCE6; }
.axis { fill: none; stroke: var(--p); stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.tagbg { fill: var(--surface); stroke: var(--rule); }
.pt2 { fill: var(--p); }
.axes { fill: none; stroke: var(--e); stroke-width: 1.4; stroke-dasharray: 1; }
.vec { fill: none; stroke: var(--e); stroke-width: 2.4; stroke-dasharray: 1; stroke-linecap: round; }
.o { fill: var(--e); }
.ecard { fill: var(--surface); stroke: var(--e); }

.globe { animation: nf-in 0.4s both 0.2s; }
.pt { animation: nf-pop 0.35s both 0.6s; }
.helper { animation: nf-draw 0.4s ease-out both 0.9s; }
.arc-l { animation: nf-draw 0.4s ease-out both 1.1s; }
.arc-p { animation: nf-draw 0.4s ease-out both 1.3s; }
.lab-g { animation: nf-in 0.3s both 1.5s; }
.geo-t { animation: nf-in 0.3s both 1.6s; }
.proj-path { animation: nf-draw 0.6s ease-out both 2.2s; }
.plane { animation: nf-in 0.4s both 2.4s; }
.proj-lab, .proj-head { animation: nf-in 0.3s both 2.7s; }
.pt2 { animation: nf-pop 0.35s both 2.9s; }
.axes { animation: nf-draw 0.6s ease-out both 3.5s; }
.axes-t { animation: nf-in 0.3s both 3.9s; }
.vec { animation: nf-draw 0.4s ease-out both 4s; }
.o { animation: nf-in 0.2s both 3.5s; }
.ecef { animation: nf-in 0.4s both 4.3s; }
.hgt { animation: nf-in 0.4s both 4.7s; }
</style>
