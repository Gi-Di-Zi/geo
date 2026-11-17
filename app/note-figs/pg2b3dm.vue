<script setup lang="ts">
// 이 사이트의 도쿄역 경로: CityGML → 3DCityDB(PostGIS) 적재 → SQL로 건물별 3D 도형 표 → pg2b3dm → 3D Tiles. 단계가 차례로 켜진다
const steps = [
  { cx: 37, name: '원본 파일', notes: ['EPSG:6697', '위도 먼저'] },
  { cx: 139, name: '적재', notes: ['citydb import', '구조 그대로 표로'] },
  { cx: 251, name: 'SQL 형상 준비', notes: ['건물별 면 모음', '경도·위도로 뒤집기'] },
  { cx: 357, name: '3D Tiles 생성', notes: ['-t bldg3d -c geom', '-a gml_id,height'] },
  { cx: 445, name: '웹 3D', notes: ['1.1 · glb', '암시적 타일링'] },
]

const arrows = ['M70 82h24', 'M184 82h22', 'M296 82h24', 'M394 82h18']
const delay = (i: number) => ({ animationDelay: `${0.3 + i * 0.75}s` })
</script>

<template>
  <svg class="nf f-pg" viewBox="0 0 480 196" role="img" aria-label="CityGML 파일을 3DCityDB(PostGIS)에 적재하고, SQL로 건물별 3D 도형 표를 만든 뒤, pg2b3dm으로 3D Tiles를 만들어 웹 3D 뷰어에 띄우는 단계">
    <text x="8" y="16" class="cap strong">도쿄역 CityGML → 3D Tiles (이 사이트 경로)</text>

    <g class="st" :style="delay(0)">
      <path d="M12 46h36l14 14v56H12z" class="box" />
      <path d="M48 46v14h14" class="box" />
      <text x="37" y="88" text-anchor="middle" class="mono t">.gml</text>
    </g>

    <g class="st" :style="delay(1)">
      <path d="M100 52v54c0 6 18 10 39 10s39-4 39-10V52" class="db" />
      <ellipse cx="139" cy="52" rx="39" ry="9" class="db" />
      <text x="139" y="78" text-anchor="middle" class="cap strong">3DCityDB</text>
      <text x="139" y="93" text-anchor="middle" class="cap">PostGIS</text>
    </g>

    <g class="st" :style="delay(2)">
      <rect x="210" y="46" width="82" height="70" rx="4" class="box" />
      <rect x="210" y="46" width="82" height="16" rx="4" class="head" />
      <text x="251" y="58" text-anchor="middle" class="mono tiny strongw">bldg3d</text>
      <path d="M210 78h82M210 96h82M238 62v54M266 62v54" class="rule" />
      <text x="224" y="74" text-anchor="middle" class="mono tiny">id</text>
      <text x="252" y="74" text-anchor="middle" class="mono tiny">높이</text>
      <text x="279" y="74" text-anchor="middle" class="mono tiny">geom</text>
    </g>

    <g class="st" :style="delay(3)">
      <rect x="324" y="58" width="66" height="48" rx="8" class="tool" />
      <text x="357" y="80" text-anchor="middle" class="cap strongw">pg2b3dm</text>
      <text x="357" y="96" text-anchor="middle" class="mono tiny w">-t -c -a</text>
    </g>

    <g class="st" :style="delay(4)">
      <path d="M418 46h26l8 8v20h-34z" class="box" />
      <text x="433" y="64" text-anchor="middle" class="mono tiny">json</text>
      <rect x="420" y="84" width="14" height="14" class="glb" /><rect x="438" y="88" width="12" height="10" class="glb" /><rect x="454" y="80" width="10" height="18" class="glb" />
      <path d="M416 100h52" class="rule" />
    </g>

    <path v-for="(d, i) in arrows" :key="d" :d="`${d}m-5-4 5 4-5 4`" class="arrow st" :style="delay(i + 0.6)" />

    <g v-for="(s, i) in steps" :key="s.name" class="st" :style="delay(i)">
      <text :x="s.cx" y="138" text-anchor="middle" class="cap strong">{{ s.name }}</text>
      <text :x="s.cx" y="156" text-anchor="middle" :class="i === 3 ? 'mono tiny' : 'cap s'">{{ s.notes[0] }}</text>
      <text :x="s.cx" y="171" text-anchor="middle" :class="i === 3 ? 'mono tiny' : 'cap s'">{{ s.notes[1] }}</text>
    </g>
    <text x="8" y="190" class="cap s foot">CesiumJS Cesium3DTileset · Deck.gl Tile3DLayer로 표시, gml_id·height는 클릭 속성</text>
  </svg>
</template>

<style scoped>
.box { fill: var(--surface); stroke: #8FA0AE; stroke-linejoin: round; }
.db { fill: color-mix(in srgb, var(--c) 8%, var(--surface)); stroke: var(--c); }
.head { fill: var(--c); }
.tool { fill: var(--c); }
.glb { fill: color-mix(in srgb, var(--c) 30%, var(--surface)); stroke: var(--c); }
.arrow { fill: none; stroke: var(--ink-2); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.t { font-size: 11px; }
.tiny { font-size: 8.5px; fill: var(--ink-2); }
.s { font-size: 10px; }
.strongw { font-weight: 600; fill: #fff; }
.w { fill: #fff; }

.st { animation: nf-in 0.4s both; }
.foot { animation: nf-in 0.4s both 3.8s; }
</style>
