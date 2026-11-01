<script setup lang="ts">
import type { FormatSpec } from '#shared/types'

/**
 * 상단 막대. 예시(확장자) 안(spec 있음): 프로젝트 이름 | 유형·확장자 · 4단계 (어느 단계로든 오감).
 * 그 밖: 프로젝트 이름들 (세로 구분선, 지금 화면은 밑줄. 누르면 그 첫 화면, 기획 중인 자리는 이름만).
 * 오른쪽 끝: 소개(/)로 돌아가는 화살표(소개 화면에선 숨김) + AI 연결(MCP)
 */
const props = defineProps<{ spec?: FormatSpec; step?: FlowStep }>()
const route = useRoute()
const cat = computed(() => props.spec && categoryOf(props.spec.category))
const at = computed(() => flow.findIndex(s => s.id === props.step))
const viz = vizProject
</script>

<template>
  <nav class="flow-bar" :aria-label="spec ? '변환 단계' : '프로젝트'" :style="{ '--c': cat?.color }">
    <div class="wrap inner">
      <template v-if="spec && cat">
        <NuxtLink :to="viz.base" class="brand">{{ viz.name }}</NuxtLink>
        <p class="where">
          <NuxtLink :to="{ path: viz.base, query: { type: cat.id } }" class="chip" title="확장자 다시 고르기"><span class="chip-dot" />{{ cat.name }}</NuxtLink>
          <strong class="ext">{{ spec.extensions[0] }}</strong>
          <span class="name">{{ spec.name }}</span>
        </p>
        <ol class="steps">
          <li v-for="(s, i) in flow" :key="s.id" :class="{ done: i < at, now: i === at }" :title="s.text">
            <NuxtLink :to="{ path: stepPath(spec, s.id), query: route.query }" :aria-current="i === at ? 'step' : undefined">
              <span class="no">{{ i < at ? '✓' : i + 1 }}</span><span class="label">{{ s.name }}</span>
            </NuxtLink>
          </li>
        </ol>
      </template>
      <ul v-else class="projects">
        <li v-for="p in projects" :key="p.id">
          <NuxtLink v-if="p.base" :to="p.base" class="project" :class="{ developing: p.status }" :aria-current="route.path.startsWith(p.base) ? 'page' : undefined">{{ p.name }}<small v-if="p.status" class="status">{{ p.status }}</small></NuxtLink>
          <span v-else class="project soon" :title="p.summary">{{ p.name }}</span>
        </li>
      </ul>
      <!-- 오른쪽: 화면별 버튼(slot) + AI 연결(MCP, 사이트 공용이라 어느 프로젝트에서나 같은 자리) + 맨 끝 소개로 화살표 -->
      <div class="extra">
        <slot />
        <NuxtLink to="/ai" class="mcp" :aria-current="route.path === '/ai' ? 'page' : undefined">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" /></svg>AI 연결 (MCP) <small class="status">베타</small>
        </NuxtLink>
        <NuxtLink v-if="route.path !== '/'" to="/" class="home" title="소개로" aria-label="소개로">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m0 0 6-6m-6 6 6 6" /></svg>
        </NuxtLink>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.flow-bar { position: sticky; top: 0; z-index: 25; background: var(--surface); border-bottom: 1px solid var(--rule); }
.inner { display: flex; align-items: center; gap: 8px 18px; min-height: 56px; flex-wrap: wrap; padding-block: 6px; }
.brand { font-weight: 700; color: var(--ink); text-decoration: none; letter-spacing: -0.02em; white-space: nowrap; }
/* 세로 구분선: 프로젝트 | 유형·확장자, 프로젝트 이름끼리도 같은 선 */
.brand + .where, .projects li + li { padding-left: 16px; border-left: 1px solid var(--rule); }
.where { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ext { color: var(--c); }
.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 16rem; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 4px; }
.steps li { display: flex; align-items: center; gap: 4px; }
.steps li + li::before { content: ''; width: 20px; height: 2px; background: var(--rule); }
.steps li.done + li::before, .steps li.now::before { background: var(--ink); }
.steps a {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px; border-radius: 999px;
  font-size: var(--fs-0); color: var(--ink-2); text-decoration: none; white-space: nowrap;
}
/* 프로젝트 이름들: 지금 프로젝트는 진하게 + 밑줄 */
.projects { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; }
.project { font-weight: 700; color: var(--ink-2); text-decoration: none; letter-spacing: -0.02em; white-space: nowrap; padding-block: 4px; border-bottom: 2px solid transparent; }
.project:hover { color: var(--ink); }
.project[aria-current='page'] { color: var(--ink); border-bottom-color: var(--ink); }
.project.soon { font-weight: 500; color: var(--no); cursor: default; }
.project.developing { font-weight: 500; }
.status { margin-left: 6px; font-size: 0.75rem; font-weight: 500; padding: 2px 6px; border: 1px solid var(--rule); border-radius: 4px; }
.steps a:hover { background: var(--surface); color: var(--ink); }
.no {
  width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none;
  border: 1.5px solid var(--rule); background: var(--surface); font-size: 0.75rem;
}
.done a { color: var(--ink); }
.done .no { background: var(--ink); border-color: var(--ink); color: #fff; }
.now a { color: var(--ink); font-weight: 700; background: var(--surface); box-shadow: 0 0 0 1px var(--ink); }
.now .no { border-color: var(--ink); }
.extra { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mcp {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border: 1px solid var(--rule); border-radius: 999px;
  font-size: var(--fs-0); font-weight: 600; color: var(--ink); background: var(--surface); text-decoration: none; white-space: nowrap;
}
.mcp:hover, .mcp:focus-visible { border-color: var(--ink-2); }
.mcp[aria-current='page'] { background: var(--ink); border-color: var(--ink); color: #fff; }
.mcp svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
.home { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--rule); border-radius: 50%; color: var(--ink-2); background: var(--surface); }
.home:hover, .home:focus-visible { border-color: var(--ink-2); color: var(--ink); }
.home svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
@media (max-width: 768px) {
  .inner { gap: 6px 12px; }
  /* 좁으면 단계 줄만 옆으로 밀린다 */
  .steps { order: 3; width: 100%; overflow-x: auto; scrollbar-width: none; }
  .extra { margin-left: 0; }
}
/* 아주 좁으면 지금 단계만 이름을 보이고 나머지는 번호만 (이름은 title로) */
@media (max-width: 480px) {
  .steps li:not(.now) .label { display: none; }
  .steps li:not(.now) a { padding-right: 4px; }
  .steps li + li::before { width: 12px; }
}
</style>
