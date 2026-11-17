<script setup lang="ts">
// 파일 하나에 범위 요청 두 번: ① 앞 16KB(헤더 + 루트 디렉터리) → 디렉터리에서 위치 찾기 → ② 그 타일 바이트만
const cells = Array.from({ length: 17 }, (_, i) => `M${120 + i * 20} 24v30`)
</script>

<template>
  <svg class="nf f-pm" viewBox="0 0 480 236" role="img" aria-label="브라우저가 PMTiles 파일 하나에 범위 요청을 두 번 보냄: 먼저 헤더와 디렉터리, 다음에 필요한 타일 하나만">
    <text x="20" y="16" class="cap strong">archive.pmtiles</text>
    <text x="460" y="16" class="cap" text-anchor="end">파일 하나 · 정적 호스팅(S3·CDN)</text>

    <rect x="20" y="24" width="440" height="30" class="card" />
    <rect x="20" y="24" width="80" height="30" class="got got1" />
    <rect x="320" y="24" width="20" height="30" class="got got2" />
    <path d="M46 24v30M100 24v30" class="rule" />
    <path v-for="d in cells" :key="d" :d="d" class="rule" />
    <text x="33" y="43" class="mono" text-anchor="middle">H</text>
    <text x="73" y="43" class="cap" text-anchor="middle">디렉터리</text>
    <text x="104" y="68" class="cap">타일 데이터 · 힐베르트 순서로 줄 섬</text>

    <path d="M60 112V58" pathLength="1" class="wire req1" />
    <path d="M55 64l5-6 5 6" pathLength="1" class="wire head1" />
    <text x="68" y="92" class="mono lab1">① bytes=0-16383</text>
    <path d="M150 112C150 84 330 92 330 58" pathLength="1" class="wire req2" />
    <path d="M325 64l5-6 5 6" pathLength="1" class="wire head2" />
    <text x="250" y="104" class="mono lab2">② 그 타일 범위만</text>

    <rect x="20" y="112" width="190" height="116" rx="8" class="card" />
    <path d="M20 128h190" class="rule" />
    <circle v-for="k in 3" :key="k" :cx="20 + k * 10" cy="120" r="2.5" class="dot" />
    <text x="200" y="123" class="cap" text-anchor="end">브라우저</text>
    <rect x="28" y="134" width="174" height="86" rx="3" class="sea" />
    <g class="tile grow">
      <rect x="85" y="146" width="60" height="62" class="land" />
      <path d="M85 172h60M112 146v62M85 200l60-40" class="road" />
      <text x="89" y="157" class="mono small">z/x/y</text>
    </g>

    <rect x="230" y="112" width="230" height="116" rx="8" class="card" />
    <text x="244" y="132" class="cap strong">네트워크</text>
    <text x="446" y="132" class="cap" text-anchor="end">상태 · 크기</text>
    <path d="M230 140h230" class="rule" />
    <g class="r1"><text x="244" y="162" class="cap">① 헤더 + 디렉터리</text><text x="446" y="162" class="mono" text-anchor="end">206 · 16 KB</text></g>
    <g class="r2"><text x="244" y="186" class="cap">↳ 디렉터리에서 위치·길이 찾기</text><text x="446" y="186" class="mono" text-anchor="end">—</text></g>
    <g class="r3"><text x="244" y="210" class="cap">② 타일 하나</text><text x="446" y="210" class="mono" text-anchor="end">206 · 수 KB</text></g>
  </svg>
</template>

<style scoped>
.got { fill: color-mix(in srgb, var(--c) 30%, transparent); }
.dot { fill: var(--rule); }
.road { fill: none; stroke: #B9C3CC; stroke-width: 2; }
.small { font-size: 9px; fill: var(--ink-2); }
.tile .land { stroke: var(--c); stroke-width: 1.5; }

.req1 { animation: nf-draw 0.5s ease-out both 0.3s; }
.lab1 { animation: nf-in 0.3s both 0.3s; }
.head1 { animation: nf-in 0.2s both 0.8s; }
.got1 { animation: nf-in 0.3s both 0.9s; }
.r1 { animation: nf-in 0.3s both 1.1s; }
.r2 { animation: nf-in 0.3s both 1.7s; }
.req2 { animation: nf-draw 0.6s ease-out both 2.3s; }
.lab2 { animation: nf-in 0.3s both 2.3s; }
.head2 { animation: nf-in 0.2s both 2.9s; }
.got2 { animation: nf-in 0.3s both 3s; }
.r3 { animation: nf-in 0.3s both 3.2s; }
.tile { animation: nf-pop 0.45s cubic-bezier(0.3, 1.5, 0.6, 1) both 3.4s; }
</style>
