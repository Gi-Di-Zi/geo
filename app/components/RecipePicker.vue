<script setup lang="ts">
import { kindLabels } from '#shared/viewers'
import type { FormatSpec } from '#shared/types'

/** 변환 방식 고르기. 파일 방식·서버 방식으로 나눈 카드 */
const props = defineProps<{ spec: FormatSpec; current: string }>()
const emit = defineEmits<{ select: [id: string] }>()
const groups = recipeGroups(props.spec)
const kinds = (r: FormatSpec['recipes'][number]) => [...new Set(r.outputs.map(o => kindLabels[o.kind]))].join(' · ')
</script>

<template>
  <section class="picker" aria-labelledby="picker-title">
    <h2 id="picker-title">변환 방식 선택</h2>
    <p class="muted small">같은 원본을 방식·도구별로 변환. 카드 선택 시 아래 요약·변환 단계·결과물·뷰어별 처리가 해당 도구로 전환.</p>
    <div class="groups">
      <div v-for="g in groups" :key="g.name">
        <h3>{{ g.name }}</h3>
        <p class="small muted">{{ g.text }}</p>
        <div class="cards">
          <button v-for="r in g.recipes" :key="r.id" type="button" class="pick" :aria-pressed="r.id === current" @click="emit('select', r.id)">
            <strong>{{ r.title }}</strong>
            <span class="small muted">{{ kinds(r) }}</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.picker { margin-bottom: 32px; }
.picker h2 { font-size: var(--fs-2); margin-bottom: 4px; }
.groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 20px 32px; margin-top: 16px; }
.groups h3 { font-size: var(--fs-1); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 10px; }
.pick {
  font: inherit; text-align: left; color: var(--ink); cursor: pointer;
  display: grid; gap: 2px; align-content: start; padding: 12px 14px;
  background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel);
}
.pick:hover { border-color: var(--ink-2); }
.pick[aria-pressed='true'] { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
.pick[aria-pressed='true'] strong::after { content: ' ✓'; }
</style>
