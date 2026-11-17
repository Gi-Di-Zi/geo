<script setup lang="ts">
// 왼쪽: XML ⊃ GML ⊃ CityGML(2.0·3.0) 층. 오른쪽: 같은 CityGML 파일의 태그를 층 색으로 — GML 태그, CityGML 태그 순서로 물든다
const lines = [
  { d: 0, tag: 'core:CityModel', kind: 'c' },
  { d: 8, tag: 'core:cityObjectMember', kind: 'c' },
  { d: 16, tag: 'bldg:Building', kind: 'c' },
  { d: 24, tag: 'bldg:measuredHeight', kind: 'c', val: '21.5' },
  { d: 24, tag: 'bldg:lod2Solid', kind: 'c' },
  { d: 32, tag: 'gml:Solid', kind: 'g', attr: ' srsName="…6697"' },
  { d: 40, tag: 'gml:posList', kind: 'g', val: '35.68 139.76 …' },
]

const delay = (s: number) => ({ animationDelay: `${s}s` })
</script>

<template>
  <svg class="nf f-x" viewBox="0 0 480 236" role="img" aria-label="XML 안에 GML, GML 안에 CityGML 2.0과 3.0이 들어 있는 층 그림과, CityGML 파일에서 core·bldg 태그는 CityGML, gml 태그는 GML, 꺾쇠 문법은 XML임을 색으로 구분">
    <g class="in" :style="delay(0.2)">
      <rect x="8" y="8" width="210" height="220" rx="10" class="lx" />
      <text x="20" y="28" class="cap strong">XML</text>
      <text x="20" y="42" class="cap">태그 문법 · W3C</text>
    </g>
    <g class="in" :style="delay(0.8)">
      <rect x="20" y="52" width="186" height="164" rx="8" class="lg" />
      <text x="32" y="72" class="cap strong">GML</text>
      <text x="32" y="86" class="cap">도형 · 좌표계 · 피처 · OGC/ISO</text>
    </g>
    <rect x="20" y="52" width="186" height="164" rx="8" class="lg glow" :style="delay(3.6)" />
    <g class="in" :style="delay(1.4)">
      <rect x="32" y="96" width="162" height="108" rx="6" class="lc" />
      <text x="44" y="116" class="cap strong">CityGML</text>
      <text x="44" y="130" class="cap">건물 · 지붕 면 · LoD 어휘</text>
    </g>
    <rect x="32" y="96" width="162" height="108" rx="6" class="lc glow" :style="delay(4.2)" />
    <g class="in" :style="delay(1.9)">
      <rect x="40" y="140" width="148" height="24" rx="12" class="chip" />
      <text x="114" y="156" text-anchor="middle" class="cap">2.0 · GML 3.1.1 · LoD0~4</text>
    </g>
    <g class="in" :style="delay(2.1)">
      <rect x="40" y="172" width="148" height="24" rx="12" class="chip" />
      <text x="114" y="188" text-anchor="middle" class="cap">3.0 · GML 3.2.1 · LoD0~3</text>
    </g>

    <rect x="230" y="8" width="242" height="220" rx="8" class="card" />
    <text x="244" y="28" class="cap strong">CityGML 파일 한 조각</text>
    <text v-for="(l, i) in lines" :key="i" :x="244 + l.d" :y="52 + i * 22" class="mono code in" :style="delay(2.5 + i * 0.12)">
      <tspan class="sx">&lt;</tspan><tspan :class="`s${l.kind}`">{{ l.tag }}</tspan><tspan v-if="l.attr" class="sx">{{ l.attr }}</tspan><tspan class="sx">&gt;</tspan><tspan v-if="l.val">{{ l.val }}</tspan>
    </text>
    <g class="in" :style="delay(4.6)">
      <rect x="244" y="202" width="8" height="8" rx="2" class="kx" /><text x="256" y="210" class="cap">XML 문법</text>
      <rect x="316" y="202" width="8" height="8" rx="2" class="kg" /><text x="328" y="210" class="cap">GML</text>
      <rect x="364" y="202" width="8" height="8" rx="2" class="kc" /><text x="376" y="210" class="cap">CityGML</text>
    </g>
  </svg>
</template>

<style scoped>
.f-x { --gml: #12827F; --xml: #52606E; }
.lx { fill: color-mix(in srgb, var(--xml) 5%, var(--surface)); stroke: var(--xml); }
.lg { fill: color-mix(in srgb, var(--gml) 7%, var(--surface)); stroke: var(--gml); }
.lc { fill: color-mix(in srgb, var(--c) 8%, var(--surface)); stroke: var(--c); }
.glow { fill: none; stroke-width: 3; opacity: 0; animation: nf-blip 1s both; }
.chip { fill: var(--surface); stroke: var(--c); }
.code { font-size: 10px; }
.sx { fill: var(--xml); }
.sg { fill: var(--gml); font-weight: 500; animation: f-x-tint 0.4s both 3.6s; }
.sc { fill: var(--c); font-weight: 500; animation: f-x-tint 0.4s both 4.2s; }
@keyframes f-x-tint { from { fill: var(--ink-2); } }
.kx { fill: var(--xml); }
.kg { fill: var(--gml); }
.kc { fill: var(--c); }
.in { animation: nf-in 0.3s both; }
</style>
