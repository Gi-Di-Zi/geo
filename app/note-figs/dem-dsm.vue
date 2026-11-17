<script setup lang="ts">
// 지형 단면 하나에 세 표면: 라이다 첫 반사로 DSM(지붕·나무 꼭대기를 따라), 지면점으로 DTM(맨땅), 둘의 차 nDSM(건물·나무 높이)
const ground = 'M20 172L60 166L100 160L140 160L180 152L220 142L260 146L300 156L340 152L380 140L420 144L460 150'
const dsm = 'M20 172L60 166L100 160L112 160L112 104L158 104L158 156.4L180 152L205 145.8L205 118A17 17 0 0 1 239 118L239 143.9L250 145L250 126A12 12 0 0 1 274 126L274 149.5L296 155L296 120L326 120L326 153.4L340 152L380 140L382 140.2L382 114A16 16 0 0 1 414 114L414 143.4L420 144L460 150'

const trees = [
  { cx: 222, cy: 118, r: 17, base: 142 },
  { cx: 262, cy: 126, r: 12, base: 147 },
  { cx: 398, cy: 114, r: 16, base: 142 },
]
</script>

<template>
  <svg class="nf f-dem" viewBox="0 0 480 236" role="img" aria-label="지형 단면에서 DSM은 건물 지붕과 나무 꼭대기를 따라가고, DTM은 맨땅을 따라가며, 둘의 차이 nDSM이 건물과 나무의 높이">
    <g class="scene">
      <rect x="112" y="104" width="46" height="62" class="bldg" />
      <rect x="296" y="120" width="30" height="42" class="bldg" />
      <g v-for="t in trees" :key="t.cx">
        <path :d="`M${t.cx} ${t.cy + t.r - 2}V${t.base}`" class="trunk" />
        <circle :cx="t.cx" :cy="t.cy" :r="t.r" class="canopy" />
      </g>
    </g>
    <g class="ndsm">
      <rect x="112" y="104" width="46" height="62" class="fillh" />
      <rect x="296" y="120" width="30" height="42" class="fillh" />
      <circle v-for="t in trees" :key="`n${t.cx}`" :cx="t.cx" :cy="t.cy" :r="t.r" class="fillh" />
      <path d="M135 154V110M131 114l4-5 4 5M131 150l4 5 4-5" class="harrow" />
    </g>
    <path :d="`${ground}V214H20Z`" class="soil" />

    <g class="lidar">
      <path d="M296 14h18l4 6h-26z" class="sensor" />
      <path d="M305 22L311 120M305 22L262 114M305 22L284 152" pathLength="1" class="ray" />
      <text x="326" y="20" class="cap strong">라이다</text>
      <text x="326" y="34" class="cap s">첫 반사 → DSM, 지면점 → DTM</text>
    </g>

    <path :d="ground" pathLength="1" class="dtm" />
    <path :d="dsm" pathLength="1" class="dsm" />

    <g class="leg leg-dsm"><path d="M14 18h20" class="dsm still" /><text x="40" y="22" class="cap"><tspan class="strong">DSM</tspan> 지붕·나무 꼭대기까지 (보이는 맨 위)</text></g>
    <g class="leg leg-dtm"><path d="M14 38h20" class="dtm still" /><text x="40" y="42" class="cap"><tspan class="strong">DTM</tspan> 걷어낸 맨땅 (DSM과 대비한 DEM)</text></g>
    <g class="leg leg-n"><rect x="14" y="52" width="20" height="10" class="fillh" /><text x="40" y="61" class="cap"><tspan class="strong">nDSM = DSM − DTM</tspan> 건물·나무 높이</text></g>
    <text x="141" y="136" class="cap strong ntext">nDSM</text>
    <text x="20" y="230" class="cap">지형 단면 (가로 = 거리, 세로 = 높이, 과장)</text>
  </svg>
</template>

<style scoped>
.f-dem { --dsm: #C8323C; --dtm: #2F855A; --n: #CA8A04; }
.bldg { fill: #DCE2E8; stroke: #8FA0AE; }
.canopy { fill: #9CC28C; }
.trunk { stroke: #8A6A4F; stroke-width: 3; }
.soil { fill: #EDE3D3; }
.fillh { fill: color-mix(in srgb, var(--n) 42%, transparent); }
.harrow { fill: none; stroke: #7A5300; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.ntext { fill: #7A5300; font-size: 10px; }
.s { font-size: 10px; }
.sensor { fill: var(--ink-2); }
.ray { fill: none; stroke: var(--ink-2); stroke-width: 1; stroke-dasharray: 1; opacity: 0.7; }
.dsm { fill: none; stroke: var(--dsm); stroke-width: 2.6; stroke-linejoin: round; stroke-dasharray: 1; }
.dtm { fill: none; stroke: var(--dtm); stroke-width: 2.6; stroke-linejoin: round; stroke-dasharray: 1; }
.still { stroke-dasharray: none; }

.scene { animation: nf-in 0.4s both 0.2s; }
.soil { animation: nf-in 0.4s both 0.2s; }
.lidar { animation: nf-in 0.3s both 0.6s; }
.ray { animation: nf-draw 0.6s ease-out both 0.8s; }
path.dsm:not(.still) { animation: nf-draw 1.2s ease-in-out both 1.6s; }
.leg-dsm { animation: nf-in 0.3s both 2.4s; }
path.dtm:not(.still) { animation: nf-draw 0.9s ease-in-out both 3s; }
.leg-dtm { animation: nf-in 0.3s both 3.5s; }
.ndsm, .ntext { animation: nf-in 0.5s both 4s; }
.leg-n { animation: nf-in 0.3s both 4.3s; }
</style>
