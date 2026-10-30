<script setup lang="ts">
import { terms } from '#shared/catalog/terms'

// 글에서 용어를 찾아 처음 나온 곳에만 팝오버를 단다 (같은 용어에 밑줄이 반복되면 읽기 어렵다)
const props = defineProps<{ text: string }>()
const re = new RegExp(terms.map(t => `(${t.match})`).join('|'), 'g')
const uid = useId()

const parts = computed(() => {
  const out: { text: string; term?: (typeof terms)[number] }[] = []
  const used = new Set<string>()
  let last = 0
  for (const m of props.text.matchAll(re)) {
    const term = terms[m.slice(1).findIndex(Boolean)]!
    if (used.has(term.id)) continue
    used.add(term.id)
    out.push({ text: props.text.slice(last, m.index) }, { text: m[0], term })
    last = m.index! + m[0].length
  }
  out.push({ text: props.text.slice(last) })
  return out
})
</script>

<template>
  <span><template v-for="(p, i) in parts" :key="i"><template v-if="!p.term">{{ p.text }}</template><template v-else><button type="button" class="term" :popovertarget="`${uid}-${i}`">{{ p.text }}</button><span :id="`${uid}-${i}`" popover class="term-pop"><strong>{{ p.term.label }}</strong> {{ p.term.short }} <NuxtLink :to="`/viz/concepts#${p.term.id}`">자세히</NuxtLink></span></template></template></span>
</template>

<style>
/* 팝오버는 최상위 층에 뜨므로 scoped가 아닌 전역 스타일로 둔다 */
.term {
  font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: help;
  text-decoration: underline dotted var(--ink-2); text-underline-offset: 3px;
}
.term-pop {
  max-width: min(26rem, calc(100vw - 32px)); margin: auto; padding: 14px 16px;
  border: 1px solid var(--rule); border-radius: var(--r-panel); background: var(--surface); color: var(--ink);
  font-size: var(--fs-0); line-height: 1.6;
}
.term-pop::backdrop { background: transparent; }
.term-pop strong { display: block; margin-bottom: 4px; }
</style>
