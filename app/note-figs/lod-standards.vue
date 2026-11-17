<script setup lang="ts">
// 위: CityGML 2.0 정의대로 건물이 LoD0 → LoD4로 자세해짐. 아래: 같은 열을 세 기준이 어떻게 부르는지
// 국내 기준은 LoD1(블록)만 열에 맞추고 2·3·4는 한 칸으로 (단계 간 차이가 모호 — 열에 억지로 맞추지 않음)
const cols = [134, 210, 286, 362, 438]
const names = ['바닥·지붕선', '블록', '지붕 형태', '창·문', '실내']
const delay = (s: number) => ({ animationDelay: `${s}s` })
</script>

<template>
  <svg class="nf f-lod" viewBox="0 0 480 234" role="img" aria-label="건물이 LoD0 바닥선에서 LoD4 실내까지 자세해지는 그림과, CityGML 2.0은 0~4, CityGML 3.0은 0~3에 실내를 모든 단계로, 국내 기준은 1~4에 2·3·4 구분이 모호함을 같은 열에 맞춘 표">
    <text x="8" y="60" class="cap">세밀도 →</text>
    <path d="M100 92H472" class="rule" />

    <g v-for="(cx, k) in cols" :key="cx" :transform="`translate(${cx - 38} 0)`" class="b" :style="delay(0.2 + k * 0.45)">
      <template v-if="k === 0">
        <path d="M11 92H51l14-10H25z" class="foot" />
        <path d="M11 52H51l14-10H25zM11 92V52M51 92V52M65 82V42" class="ghost" />
      </template>
      <template v-else-if="k === 1">
        <path d="M51 92l14-10V42l-14 10z" class="side" />
        <path d="M11 92H51V52H11z" class="wall" />
        <path d="M11 52H51l14-10H25z" class="top" />
      </template>
      <template v-else>
        <path d="M11 58L31 40l14-10L25 48z" class="roof" />
        <path d="M51 92l14-10V48l-14 10z" class="side" />
        <path d="M31 40L51 58l14-10L45 30z" class="roof" />
        <template v-if="k === 4">
          <path d="M11 92H31V75H11z" class="room" />
          <path d="M11 75H51l14-10M31 92V75M38 92h4v-4h4v-4h4v-5" class="inner" />
        </template>
        <path d="M11 92H51V58L31 40L11 58z" :class="k === 4 ? 'glass' : 'wall'" />
        <template v-if="k >= 3">
          <rect x="16" y="62" width="7" height="8" class="win" /><rect x="39" y="62" width="7" height="8" class="win" />
          <rect x="16" y="78" width="7" height="8" class="win" /><rect x="39" y="78" width="7" height="8" class="win" />
          <rect x="27" y="78" width="7" height="14" class="door" />
          <path d="M54 72l7-5v8l-7 5z" class="win" />
        </template>
      </template>
      <text x="38" y="108" text-anchor="middle" class="cap strong">{{ names[k] }}</text>
    </g>

    <g class="pop" :style="delay(2.5)"><text x="8" y="129" class="cap strong">CityGML 2.0</text></g>
    <g v-for="(cx, k) in cols" :key="`a${cx}`" class="pop grow" :style="delay(2.5 + k * 0.08)">
      <rect :x="cx - 26" y="116" width="52" height="18" rx="9" class="chip-on" />
      <text :x="cx" y="129" text-anchor="middle" class="mono t">LoD{{ k }}</text>
    </g>

    <g class="pop" :style="delay(3)"><text x="8" y="153" class="cap strong">CityGML 3.0</text></g>
    <g v-for="(cx, k) in cols.slice(0, 4)" :key="`b${cx}`" class="pop grow" :style="delay(3 + k * 0.08)">
      <rect :x="cx - 26" y="140" width="52" height="18" rx="9" class="chip-on" />
      <text :x="cx" y="153" text-anchor="middle" class="mono t">LoD{{ k }}</text>
    </g>
    <g class="pop" :style="delay(3.45)">
      <rect x="412" y="140" width="52" height="18" rx="9" class="chip-off" />
      <text x="438" y="153" text-anchor="middle" class="mono t off">LoD4</text>
    </g>
    <path d="M418 149h40" pathLength="1" class="strike" :style="delay(3.65)" />
    <rect x="108" y="162" width="280" height="16" rx="8" class="band" :style="delay(3.9)" />
    <text x="248" y="174" text-anchor="middle" class="cap strong band-t" :style="delay(4.3)">실내·개구부는 LoD0~3 어디서나 (LoD = 기하 세밀도만)</text>

    <g class="pop" :style="delay(4.6)">
      <text x="8" y="199" class="cap strong">국내 기준</text>
      <rect x="108" y="186" width="52" height="18" rx="9" class="chip-off" />
      <text x="134" y="199" text-anchor="middle" class="cap off">없음</text>
    </g>
    <g class="pop grow" :style="delay(4.7)">
      <rect x="184" y="186" width="52" height="18" rx="9" class="chip-on" />
      <text x="210" y="199" text-anchor="middle" class="mono t">LoD1</text>
    </g>
    <g class="pop" :style="delay(4.85)">
      <rect x="260" y="186" width="204" height="18" rx="9" class="chip-vague" />
      <text x="330" y="199" text-anchor="middle" class="cap t">LoD2·3·4 — 단계 차이 모호</text>
    </g>

    <rect x="406" y="4" width="64" height="206" rx="8" class="ring" :style="delay(5.3)" />
    <text x="470" y="228" text-anchor="end" class="cap warn" :style="delay(5.4)">같은 "LoD 4"도 기준마다 뜻이 다름 → 어느 기준인지 먼저</text>
  </svg>
</template>

<style scoped>
.wall { fill: #FBFAF6; stroke: #8FA0AE; stroke-linejoin: round; }
.side { fill: #E3E9EE; stroke: #8FA0AE; stroke-linejoin: round; }
.top { fill: #EEF2F5; stroke: #8FA0AE; stroke-linejoin: round; }
.roof { fill: #C9D3DC; stroke: #8FA0AE; stroke-linejoin: round; }
.glass { fill: rgb(251 250 246 / 0.3); stroke: #8FA0AE; stroke-linejoin: round; }
.foot { fill: color-mix(in srgb, var(--c) 22%, transparent); stroke: var(--c); }
.ghost { fill: none; stroke: var(--c); stroke-dasharray: 3 2; }
.win { fill: #9DB8D9; stroke: #6F8FB5; stroke-width: 0.6; }
.door { fill: #8A6A4F; }
.room { fill: color-mix(in srgb, var(--c) 22%, transparent); }
.inner { fill: none; stroke: var(--c); stroke-width: 1.4; stroke-linejoin: round; }
.chip-on { fill: color-mix(in srgb, var(--c) 10%, var(--surface)); stroke: var(--c); }
.chip-off { fill: var(--surface); stroke: var(--no); stroke-dasharray: 3 2; }
.chip-vague { fill: #FBF3E4; stroke: #C9A227; stroke-dasharray: 4 2; }
.t { font-size: 10px; }
.off { fill: var(--no); }
.strike { fill: none; stroke: #C8323C; stroke-width: 1.6; stroke-dasharray: 1; }
.band { fill: color-mix(in srgb, var(--c) 14%, transparent); stroke: var(--c); transform-box: fill-box; transform-origin: left center; }
.band-t { font-size: 10px; fill: color-mix(in srgb, var(--c) 80%, black); }
.ring { fill: none; stroke: #C8323C; stroke-width: 1.5; stroke-dasharray: 4 3; }
.warn { fill: #C8323C; font-weight: 600; }

.b { animation: nf-in 0.4s both; }
.pop { animation: nf-in 0.3s both; }
.pop.grow { animation-name: nf-pop; }
.strike { animation: nf-draw 0.3s ease-out both; }
.band { animation: f-lod-grow 0.5s ease-out both; }
.band-t, .ring, .warn { animation: nf-in 0.3s both; }
@keyframes f-lod-grow { from { transform: scaleX(0); } }
</style>
