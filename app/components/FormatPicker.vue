<script setup lang="ts">
import type { FormatSpec, StatusEntry } from '#shared/types'

/** 유형 카드를 누르면 뜨는 확장자 선택 창. ?에 올리거나 누르면 설명과 출신(표준/회사)이 뜬다 */
const props = defineProps<{ category: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const cat = computed(() => categoryOf(props.category))
const list = computed(() => formatsOf(props.category))

onMounted(() => watch(() => props.category, id => {
  if (id && !dialog.value!.open) dialog.value!.showModal()
  if (!id) dialog.value!.close()
}, { immediate: true }))

// 샘플 분류(국내 공공·해외·기타·샘플 없음). 현황(status.json)에서 변환이 하나도 성공하지 않았으면 준비 중
const { data: status } = useFetch<StatusEntry[]>(`${useRuntimeConfig().app.baseURL}data/status.json`, { server: false, default: () => [] })
const stateOf = (f: FormatSpec) => {
  const kind = sampleOf(f)
  const done = kind === 'none' || status.value.find(s => s.format === `${f.category}/${f.id}`)?.recipes.some(r => r.state === 'done')
  return done ? { id: kind, label: sampleLabels[kind] } : { id: 'wip', label: '준비 중' }
}

// 설명 말풍선. 창 안 스크롤에 잘리지 않게 화면 기준(fixed)으로 띄우고, 오른쪽에 자리가 없으면 ? 아래(또는 위)로 놓는다
const tip = ref<{ f: FormatSpec; style: Record<string, string> } | null>(null)
function show(f: FormatSpec, e: Event) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const w = Math.min(300, innerWidth - 16)
  const box = dialog.value!.getBoundingClientRect()
  const side = innerWidth - box.right > w + 24
  const up = !side && r.bottom > innerHeight * 0.6
  tip.value = {
    f,
    style: {
      width: `${w}px`,
      left: `${side ? box.right + 12 : Math.max(8, Math.min(r.left - 12, innerWidth - w - 8))}px`,
      ...(up ? { bottom: `${innerHeight - r.top + 6}px` } : { top: `${side ? Math.max(8, r.top - 12) : r.bottom + 6}px` }),
    },
  }
}
const origin = computed(() => tip.value && origins[tip.value.f.id])
</script>

<template>
  <dialog ref="dialog" class="picker" aria-labelledby="picker-title" :style="{ '--c': cat?.color }" @close="emit('close')" @click.self="dialog?.close()">
    <div v-if="cat" class="body">
      <header>
        <h2 id="picker-title"><span class="chip-dot" />{{ cat.name }}</h2>
        <button class="x" type="button" aria-label="닫기" @click="dialog?.close()">×</button>
      </header>
      <ul class="list">
        <li v-for="f in list" :key="f.id" :class="{ closed: f.closed }">
          <NuxtLink v-if="!f.closed" :to="stepPath(f, 'collect')" class="pick">
            <span class="pill">{{ f.extensions.join(' ') }}</span>
            <span class="name">{{ f.name }}</span>
          </NuxtLink>
          <span v-else class="pick" aria-disabled="true">
            <span class="pill">{{ f.extensions.join(' ') }}</span>
            <span class="name">{{ f.name }}</span>
          </span>
          <button
            type="button" class="help" :aria-label="`${f.name} 설명`" :aria-describedby="tip?.f === f ? 'picker-tip' : undefined"
            @mouseenter="show(f, $event)" @mouseleave="tip = null" @focus="show(f, $event)" @blur="tip = null"
          >?</button>
          <span class="sk state" :class="`sk-${stateOf(f).id}`">{{ stateOf(f).label }}</span>
        </li>
      </ul>
      <p v-if="!list.length" class="muted">준비 중.</p>
    </div>
    <div v-if="tip && origin" id="picker-tip" role="tooltip" class="tip" :style="tip.style">
      <p class="tip-head">
        <span class="origin" :class="origin.kind">{{ originLabels[origin.kind] }}</span>
        <strong>{{ origin.by }}</strong>
      </p>
      <p class="small">{{ origin.note }}</p>
      <p class="small muted">{{ tip.f.summary }}</p>
      <p v-if="tip.f.closed" class="small warn">샘플 없음: {{ tip.f.closed }}</p>
      <p v-else class="small muted">샘플: {{ sampleLabels[sampleOf(tip.f)] }} · {{ sourceOf(tip.f.collect.source)?.name }}<template v-if="tip.f.collect.converted"> (변환)</template></p>
    </div>
  </dialog>
</template>

<style scoped>
.picker {
  width: min(34rem, calc(100vw - 32px)); padding: 0; border: 1px solid var(--rule); border-radius: 14px;
  background: var(--surface); color: var(--ink); box-shadow: 0 20px 48px rgb(22 32 42 / 0.18);
}
.picker::backdrop { background: rgb(22 32 42 / 0.35); }
.body { padding: 16px 16px 12px; }
header { display: flex; align-items: center; gap: 10px; margin: 0 4px 8px; }
h2 { font-size: var(--fs-2); display: flex; align-items: center; gap: 8px; }
h2 .chip-dot { width: 12px; height: 12px; background: var(--c); }
.x { margin-left: auto; border: 0; background: none; font-size: 24px; line-height: 1; cursor: pointer; color: var(--ink-2); padding: 0 4px; }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.list li { display: flex; align-items: center; gap: 6px; padding-right: 6px; border-radius: 10px; }
.list li:hover:not(.closed) { background: var(--paper); }
.pick { min-width: 0; display: flex; align-items: center; gap: 10px; padding: 9px 4px 9px 8px; color: var(--ink); text-decoration: none; }
.closed .pick { color: var(--ink-2); }
.closed .pill { filter: grayscale(1); opacity: 0.7; }
.name { min-width: 0; font-weight: 500; }
.state { margin-left: auto; }
.tip {
  position: fixed; z-index: 1; margin: 0; padding: 12px 14px; display: grid; gap: 6px;
  background: var(--ink); color: #E6EDF3; border-radius: 12px; box-shadow: 0 12px 32px rgb(22 32 42 / 0.25);
  pointer-events: none; line-height: 1.6;
}
.tip .muted { color: #AEB9C4; }
.tip .warn { color: #F3C98B; }
.tip-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
</style>
