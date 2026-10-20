<script setup lang="ts">
import { kindLabels } from '#shared/viewers'

const route = useRoute()
const tool = toolOf(String(route.params.tool))
if (!tool) throw createError({ statusCode: 404, message: '없는 도구' })
const type = toolTypes.find(t => t.id === tool.type)
const usages = usagesOf(tool.id)
const statusLabels = { active: '사용 중', stale: '업데이트 중단', dead: '개발 종료' }
useHead({ title: `${tool.name} | 공간 데이터 웹 처리` })
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <p class="small"><NuxtLink :to="`/tools#${tool.type}`">{{ type?.name }}</NuxtLink></p>
      <h1>{{ tool.name }}</h1>
      <p class="prose lead">{{ tool.summary }}</p>
      <p class="prose desc">{{ tool.description }}</p>

      <dl class="facts">
        <dt>입출력</dt><dd>{{ tool.io }}</dd>
        <dt>언어</dt><dd>{{ tool.lang }}</dd>
        <dt>라이선스</dt><dd>{{ tool.license }}</dd>
        <dt>버전</dt><dd>{{ tool.version }}</dd>
        <dt>상태</dt><dd>{{ statusLabels[tool.status] }}</dd>
        <template v-if="tool.image">
          <dt>실행 이미지</dt><dd><code>{{ tool.image.startsWith('local:') ? '로컬 빌드 (pipeline/Dockerfile 등)' : tool.image }}</code></dd>
        </template>
        <template v-if="tool.serves">
          <dt>서빙하는 출력</dt><dd>{{ tool.serves.map(k => kindLabels[k]).join(', ') }}</dd>
        </template>
        <dt>홈페이지</dt><dd><a :href="tool.url" target="_blank" rel="noopener">{{ tool.url }}</a></dd>
      </dl>

      <h2>대표 명령</h2>
      <pre><code>{{ tool.example }}</code></pre>

      <h2>이 사이트 사용처</h2>
      <ul v-if="usages.length" class="uses">
        <li v-for="(u, i) in usages" :key="i">
          <NuxtLink :to="{ path: stepPath(u.format, 'convert'), query: u.recipe && u.recipe.id !== u.format.recipes[0]!.id ? { tool: u.recipe.id } : {} }">
            {{ u.format.extensions.join(' ') }} {{ u.format.name }}
          </NuxtLink>
          <span class="small muted">{{ categoryOf(u.format.category)?.name }}</span>
          <span class="small" :class="u.ran ? 'ok' : 'muted'">{{ u.ran ? `실행: ${u.recipe?.title} 레시피` : '대안으로 소개' }}</span>
        </li>
      </ul>
      <p v-else class="muted">이 도구를 쓰는 확장자 없음.</p>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; }
.lead { margin-top: 8px; font-size: var(--fs-2); line-height: 1.55; }
.desc { margin-top: 12px; color: var(--ink-2); }
.facts { display: grid; grid-template-columns: 7rem 1fr; gap: 6px 16px; margin: 28px 0 0; max-width: 48rem; }
.facts dt { color: var(--ink-2); }
.facts dd { margin: 0; }
h2 { font-size: var(--fs-2); margin: 40px 0 12px; }
pre { max-width: 48rem; }
.uses { padding-left: 18px; display: grid; gap: 6px; }
.uses li span { margin-left: 8px; }
</style>
