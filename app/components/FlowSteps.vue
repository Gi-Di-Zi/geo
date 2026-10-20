<script setup lang="ts">
import type { FormatSpec } from '#shared/types'

/** 상단 단계 막대. 확장자를 고르기 전(spec 없음)에는 단계만 보여 주고, 고른 뒤에는 어느 단계로든 오갈 수 있다 */
const props = defineProps<{ spec?: FormatSpec; step?: FlowStep }>()
const route = useRoute()
const cat = computed(() => props.spec && categoryOf(props.spec.category))
const at = computed(() => flow.findIndex(s => s.id === props.step))
</script>

<template>
  <nav class="flow-bar" aria-label="변환 단계" :style="{ '--c': cat?.color }">
    <div class="wrap inner">
      <NuxtLink to="/" class="brand">공간 데이터 웹 처리</NuxtLink>
      <p class="where">
        <template v-if="spec && cat">
          <NuxtLink :to="{ path: '/', query: { type: cat.id } }" class="chip" title="확장자 다시 고르기"><span class="chip-dot" />{{ cat.name }}</NuxtLink>
          <strong class="ext">{{ spec.extensions[0] }}</strong>
          <span class="name">{{ spec.name }}</span>
        </template>
        <span v-else class="muted small">유형·확장자 선택 후 진행</span>
      </p>
      <ol class="steps">
        <li v-for="(s, i) in flow" :key="s.id" :class="{ done: i < at, now: i === at }" :title="s.text">
          <NuxtLink v-if="spec" :to="{ path: stepPath(spec, s.id), query: route.query }" :aria-current="i === at ? 'step' : undefined">
            <span class="no">{{ i < at ? '✓' : i + 1 }}</span><span class="label">{{ s.name }}</span>
          </NuxtLink>
          <span v-else class="off"><span class="no">{{ i + 1 }}</span><span class="label">{{ s.name }}</span></span>
        </li>
      </ol>
      <div class="extra"><slot /></div>
    </div>
  </nav>
</template>

<style scoped>
.flow-bar { position: sticky; top: 0; z-index: 25; background: var(--surface); border-bottom: 1px solid var(--rule); }
.inner { display: flex; align-items: center; gap: 8px 24px; min-height: 56px; flex-wrap: wrap; padding-block: 6px; }
.brand { font-weight: 700; color: var(--ink); text-decoration: none; letter-spacing: -0.02em; white-space: nowrap; }
.brand + .where { padding-left: 20px; border-left: 1px solid var(--rule); }
.where { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ext { color: var(--c); }
.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 16rem; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 4px; }
.steps li { display: flex; align-items: center; gap: 4px; }
.steps li + li::before { content: ''; width: 20px; height: 2px; background: var(--rule); }
.steps li.done + li::before, .steps li.now::before { background: var(--ink); }
.steps a, .off {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px; border-radius: 999px;
  font-size: var(--fs-0); color: var(--ink-2); text-decoration: none; white-space: nowrap;
}
.steps a:hover { background: var(--surface); color: var(--ink); }
.no {
  width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none;
  border: 1.5px solid var(--rule); background: var(--surface); font-size: 0.75rem;
}
.done a { color: var(--ink); }
.done .no { background: var(--ink); border-color: var(--ink); color: #fff; }
.now a { color: var(--ink); font-weight: 700; background: var(--surface); box-shadow: 0 0 0 1px var(--ink); }
.now .no { border-color: var(--ink); }
.off { cursor: default; }
.extra { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.extra:empty { display: none; }
@media (max-width: 768px) {
  .inner { gap: 6px 12px; }
  /* 좁으면 단계 줄만 옆으로 밀린다 */
  .steps { order: 3; width: 100%; overflow-x: auto; scrollbar-width: none; }
  .extra { margin-left: 0; }
}
/* 아주 좁으면 지금 단계만 이름을 보이고 나머지는 번호만 (이름은 title로) */
@media (max-width: 480px) {
  .steps li:not(.now) .label { display: none; }
  .steps li:not(.now) a, .steps li:not(.now) .off { padding-right: 4px; }
  .steps li + li::before { width: 12px; }
}
</style>
