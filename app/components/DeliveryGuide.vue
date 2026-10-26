<script setup lang="ts">
import { byCategory, heavy, noteOf, ways, type Way } from '#shared/catalog/delivery'
import { engineOutput, kindLabels } from '#shared/viewers'
import type { FormatSpec, Recipe } from '#shared/types'

/**
 * 웹 형태 변환 단계 첫머리: 방식·도구 고르기. 이 확장자가 제공하는 방식만 카드로 두고, 카드 안에서 도구(레시피)를 고른다.
 * 엔진 카드의 도구 = 엔진이 읽는 결과(3D Tiles·QM)를 만드는 파일 레시피라 파일 카드와 같이 눌린다. current 없음 = 내 파일 모드 (도구 선택 없음)
 * 고르는 기준(방식별 맞는 경우·한계, 데이터 상태별 표)과 도구 장단점은 ?에 올리거나 포커스하면 뜬다
 */
/** recipes: 샘플 레시피 대신 보일 목록 (내 파일 업로드 레시피). readonly: 고르기 없이 쓴 도구만 표시 (변환이 끝난 내 파일) */
const props = defineProps<{ spec: FormatSpec; current?: string; recipes?: Recipe[]; readonly?: boolean }>()
const emit = defineEmits<{ select: [id: string] }>()
const list = props.recipes ?? props.spec.recipes
const recipesOf: Record<Way, Recipe[]> = {
  file: list.filter(r => !isService(r)),
  server: list.filter(r => isService(r)),
  // 엔진 렌더링은 샘플 결과만 → 업로드 목록에는 엔진 카드 없음 (업로드 결과의 실시간 보기는 MCP geo_engine)
  engine: props.recipes ? [] : list.filter(r => engineOutput(r)),
}
const shown = ways.filter(w => recipesOf[w.id].length)
const rows = (byCategory[props.spec.category]?.rows ?? []).filter(r => recipesOf[r.way].length)
const both = recipesOf.file.length && recipesOf.server.length
const category = categoryOf(props.spec.category)!
const nameOf = Object.fromEntries(ways.map(w => [w.id, w.name.split(' ')[0]]))
/** 도구 카드의 결과물 형식. 엔진 카드는 엔진이 읽는 결과 하나 */
const kinds = (w: Way, r: Recipe) => w === 'engine' ? [kindLabels[engineOutput(r)!.kind]] : [...new Set(r.outputs.map(o => kindLabels[o.kind]))]
const note = (r: Recipe) => noteOf(props.spec.category, props.spec.id, r.id)
</script>

<template>
  <section class="guide" aria-labelledby="guide-title">
    <div class="has-tip">
      <h2 id="guide-title">
        방식·도구 고르기
        <button v-if="rows.length" type="button" class="help" aria-label="데이터 상태별 방식" aria-describedby="guide-tip">?</button>
      </h2>
      <div v-if="rows.length" id="guide-tip" role="tooltip" class="tip wide">
        <p v-if="both" class="small">{{ heavy }}</p>
        <p class="tip-head small">{{ category.name }} · 데이터 상태별 <span class="muted">(크기 기준은 어림)</span></p>
        <table class="small">
          <thead><tr><th>데이터 상태</th><th>방식</th><th>고르는 이유 · 형태</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.when">
              <td>{{ r.when }}</td>
              <td><span class="way-chip" :class="r.way">{{ nameOf[r.way] }}</span></td>
              <td>{{ r.why }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <p class="muted small">{{ readonly ? '내 파일에 쓴 도구 표시.' : recipes ? '카드 안 도구 선택 → 그 도구로 변환.' : '카드 안 도구 선택 → 아래 단계·결과 전환.' }} ?: 고르는 기준·장단점.</p>
    <div class="ways">
      <div v-for="w in shown" :key="w.id" class="way has-tip" :class="w.id">
        <h3>{{ w.name }} <button type="button" class="help" :aria-label="`${w.name} 맞는 경우·한계`" :aria-describedby="`way-${w.id}`">?</button></h3>
        <div :id="`way-${w.id}`" role="tooltip" class="tip">
          <p class="tip-head small">맞는 경우</p>
          <ul class="small"><li v-for="t in w.fits" :key="t">{{ t }}</li></ul>
          <p class="tip-head small">한계</p>
          <ul class="small"><li v-for="t in w.limits" :key="t">{{ t }}</li></ul>
        </div>
        <p class="small muted">{{ w.text }}</p>
        <div v-if="current" class="picks" role="group" :aria-label="`${w.name} 도구`">
          <h4 class="small">{{ w.id === 'engine' ? '엔진이 읽는 결과를 만드는 도구' : '도구' }}</h4>
          <!-- 카드 = 고르기 버튼 + ? (장단점). 말풍선은 도구 줄(.picks) 아래에 카드 폭으로 뜬다 -->
          <div v-for="r in recipesOf[w.id]" :key="r.id" class="pick has-tip" :class="{ on: r.id === current }">
            <button type="button" class="pick-main" :aria-pressed="r.id === current" :disabled="readonly" @click="emit('select', r.id)">
              <strong class="pick-title">{{ r.title }}</strong>
              <!-- 이 도구로 나오는 형식: 카드에서 가장 눈에 띄게 (확장자 캡슐과 같은 모양) -->
              <span class="outs"><span class="sr-only">결과물:</span><span class="arrow" aria-hidden="true">→</span><span class="pills"><span v-for="k in kinds(w.id, r)" :key="k" class="pill">{{ k }}</span></span></span>
              <span v-if="note(r)" class="when">{{ note(r)!.when }}</span>
            </button>
            <template v-if="note(r)">
              <button type="button" class="help" :aria-label="`${r.title} 장단점`" :aria-describedby="`tool-${w.id}-${r.id}`">?</button>
              <div :id="`tool-${w.id}-${r.id}`" role="tooltip" class="tip">
                <p class="tip-head small">{{ r.title }} · 장점</p>
                <ul class="small"><li v-for="t in note(r)!.pros" :key="t">{{ t }}</li></ul>
                <p class="tip-head small">단점</p>
                <ul class="small"><li v-for="t in note(r)!.cons" :key="t">{{ t }}</li></ul>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.guide { margin-bottom: 36px; }
.guide > .has-tip { position: relative; }
.guide h2 { font-size: var(--fs-2); margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
.ways { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 12px; margin-top: 14px; }
/* 도구 칸을 카드 맨 아래로 밀어 카드끼리 높이를 맞춘다 */
.way { position: relative; display: flex; flex-direction: column; gap: 4px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); padding: 14px 16px; }
.way h3 { font-size: var(--fs-1); display: flex; align-items: center; gap: 8px; }
.way h4 { color: var(--ink-2); font-weight: 600; }
/* 엔진: 노선도의 엔진 역·칩처럼 점선 */
.way.engine { border-style: dashed; border-color: var(--ink-2); }
.picks { position: relative; margin-top: auto; padding-top: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.picks h4 { grid-column: 1 / -1; margin: 0; padding-top: 10px; border-top: 1px solid var(--rule); }
.pick {
  display: grid; grid-template-columns: 1fr auto; align-items: start;
  background: var(--paper); border: 1px solid var(--rule); border-radius: var(--r-panel);
}
.pick:hover { border-color: var(--ink-2); }
.pick.on { background: var(--surface); border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
.pick-main {
  font: inherit; text-align: left; color: var(--ink); cursor: pointer; background: none; border: 0;
  display: grid; gap: 6px; align-content: start; padding: 8px 2px 9px 10px; border-radius: var(--r-panel);
}
.pick-title { font-size: var(--fs-0); line-height: 1.35; }
.pick-main[aria-pressed='true'] .pick-title::after { content: ' ✓'; }
.pick-main:disabled { cursor: default; }
/* 화살표는 캡슐 묶음 왼쪽에 고정, 캡슐만 줄바꿈 */
.outs { display: flex; align-items: flex-start; gap: 5px; }
.outs .arrow { color: var(--c); font-weight: 700; font-size: 0.8rem; line-height: 1.6; }
.pills { display: flex; flex-wrap: wrap; gap: 4px; }
/* 한글 섞인 형식 이름(MVT 벡터타일 등)은 고정폭 글꼴이면 자간이 벌어져 본문 글꼴로 */
.pills .pill { font-family: inherit; font-weight: 600; font-size: 0.75rem; }
.when { font-size: 0.75rem; line-height: 1.45; color: var(--ink-2); }
.pick .help { width: 18px; height: 18px; font-size: 0.7rem; margin: 7px 7px 0 0; }

/* ? 말풍선: ?에 올리거나 포커스하면 뜬다. 위치는 가장 가까운 기준 상자(제목 줄·카드·도구 줄) 폭에 맞춘다 */
.tip {
  display: none; position: absolute; z-index: 20; padding: 12px 14px; line-height: 1.6;
  background: var(--surface); color: var(--ink); border: 1px solid var(--rule); border-radius: var(--r-panel);
  box-shadow: 0 12px 32px rgb(22 32 42 / 0.18); pointer-events: none;
}
.has-tip:has(> h2 .help:hover, > h2 .help:focus-visible) > .tip,
.has-tip:has(> h3 .help:hover, > h3 .help:focus-visible) > .tip,
.has-tip:has(> .help:hover, > .help:focus-visible) > .tip { display: grid; gap: 4px; }
.guide > .has-tip > .tip { top: calc(100% + 4px); left: 0; width: min(100%, 52rem); }
.way > .tip { top: 2.9rem; left: 8px; right: 8px; }
.picks .tip { top: calc(100% + 6px); left: 0; right: 0; }
.tip-head { font-weight: 700; }
.tip-head:not(:first-child) { margin-top: 6px; }
.tip ul { margin: 0; padding-left: 1.1em; display: grid; gap: 2px; }
table { width: 100%; border-collapse: collapse; margin-top: 2px; }
th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid var(--rule); }
th { color: var(--ink-2); font-weight: 600; white-space: nowrap; }
td:first-child { min-width: 10rem; }
td:nth-child(2) { white-space: nowrap; }
.way-chip { display: inline-block; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--ink-2); font-weight: 600; }
/* 노선도와 같은 표시: 파일 = 점선 회색, 서버 = 검정, 엔진 = 검정 점선 */
.way-chip.file { border-style: dashed; color: var(--ink-2); }
.way-chip.server { background: var(--ink); border-color: var(--ink); color: var(--surface); }
.way-chip.engine { border-style: dashed; border-color: var(--ink); }
@media (max-width: 600px) { td:first-child { min-width: 0; width: 34%; } }
</style>
