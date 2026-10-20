<script setup lang="ts">
/** 도구 이름 칩. 누르면 화면 이동 대신 떠 있는 설명 창, 창 안의 "자세히 보기"로 도구 화면 이동 */
const props = defineProps<{ id: string }>()
const tool = computed(() => toolOf(props.id))
const uid = useId()
const btn = ref<HTMLButtonElement>()
const pos = ref<Record<string, string>>({})

// 창은 최상위 층(popover)에 떠서 스크롤 상자에 잘리지 않는다. 열릴 때 칩 아래(자리 없으면 위)에 놓는다
function place(e: Event) {
  if ((e as ToggleEvent).newState !== 'open') return
  const r = btn.value!.getBoundingClientRect()
  const w = Math.min(320, innerWidth - 16)
  const below = r.bottom + 200 < innerHeight
  pos.value = {
    width: `${w}px`,
    left: `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`,
    ...(below ? { top: `${r.bottom + 6}px` } : { bottom: `${innerHeight - r.top + 6}px` }),
  }
}
</script>

<template>
  <button ref="btn" type="button" class="chip tool-chip" :popovertarget="uid">{{ tool?.name ?? id }}</button>
  <!-- 문단(<p>) 안에도 놓이므로 span만 쓴다 (div면 HTML 파서가 문단을 끊어 hydration이 어긋난다) -->
  <span v-if="tool" :id="uid" popover class="tool-pop" :style="pos" @beforetoggle="place">
    <span class="head"><strong>{{ tool.name }}</strong> <span class="muted small">{{ tool.lang }}, {{ tool.license }}, v{{ tool.version }}</span></span>
    <span class="small">{{ tool.summary }}</span>
    <NuxtLink :to="`/tools/${id}`" class="small more">자세히 보기</NuxtLink>
  </span>
</template>

<style>
/* 팝오버는 최상위 층이라 scoped가 아닌 전역 스타일 */
.tool-chip { font: inherit; font-size: var(--fs-0); cursor: pointer; }
.tool-chip:hover { border-color: var(--ink-2); }
/* display는 열렸을 때만 준다. 그냥 주면 닫힌 팝오버를 숨기는 브라우저 기본값을 덮어써 늘 보인다 */
.tool-pop:popover-open { display: grid; }
.tool-pop {
  position: fixed; inset: auto; margin: 0; padding: 12px 14px; gap: 6px;
  border: 1px solid var(--rule); border-radius: var(--r-panel); background: var(--surface); color: var(--ink);
  box-shadow: 0 12px 32px rgb(22 32 42 / 0.18); line-height: 1.6;
}
.tool-pop::backdrop { background: transparent; }
.tool-pop .head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.tool-pop .more { justify-self: start; }
</style>
