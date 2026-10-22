<script setup lang="ts">
import { engine, kindLabels, viewerKinds, viewers } from '#shared/viewers'

const statusLabels = { active: '사용 중', stale: '업데이트 중단', dead: '개발 종료' }
const filter = ref<string>('')
const groups = computed(() => toolTypes.filter(t => !filter.value || t.id === filter.value)
  .map(t => ({ ...t, items: tools.filter(x => x.type === t.id) })))
useHead({ title: '뷰어와 변환 도구 | 공간 데이터 웹 처리' })
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <h1>뷰어와 변환 도구</h1>

      <section id="viewers" class="block" aria-labelledby="viewers-title">
        <h2 id="viewers-title">렌더러</h2>
        <p class="muted">시각화·렌더링 단계. 같은 결과물을 웹 렌더러 4개에서 나란히 비교, 3D 결과는 엔진에서도 확인.</p>
        <ul class="viewers">
          <li v-for="v in viewers" :key="v.id" class="viewer">
            <p><strong>{{ v.name }}</strong> <span class="chip">{{ v.dims }}</span></p>
            <p class="muted small">{{ v.summary }}</p>
            <p class="kinds small"><span v-for="k in viewerKinds[v.id]" :key="k">{{ kindLabels[k] }}</span></p>
          </li>
          <li class="viewer engine">
            <p><strong>{{ engine.name }}</strong> <span class="chip">{{ engine.dims }} · 수동 확인</span></p>
            <p class="muted small">{{ engine.summary }} 파이프라인이 언리얼로 렌더링해 스크린샷을 남김(npm run unreal). 실시간 보기는 Pixel Streaming(npm run unreal -- stream).</p>
            <p class="kinds small"><span v-for="k in engine.kinds" :key="k">{{ kindLabels[k] }}</span></p>
          </li>
        </ul>
      </section>

      <h2 id="tools-title" class="block">변환 도구</h2>
      <p class="muted">이 사이트에서 실행한 도구와 같은 역할의 대안 도구, 유형별 정리.</p>
      <div class="filters" role="group" aria-label="도구 유형 필터">
        <button class="chip" :aria-pressed="!filter" @click="filter = ''">전체</button>
        <button v-for="t in toolTypes" :key="t.id" class="chip" :aria-pressed="filter === t.id" @click="filter = t.id">{{ t.name }}</button>
      </div>
      <section v-for="g in groups" :id="g.id" :key="g.id" class="group">
        <h3>{{ g.name }}</h3>
        <p class="muted">{{ g.summary }}</p>
        <ul class="rows">
          <li v-for="t in g.items" :key="t.id">
            <NuxtLink :to="`/tools/${t.id}`" class="row">
              <span class="name"><strong>{{ t.name }}</strong></span>
              <span class="muted">{{ t.summary }}</span>
              <span class="meta small">
                <span :class="`status ${t.status}`">{{ statusLabels[t.status] }}</span>
                <span v-if="t.image" class="ok">실행 완료</span>
                <span class="muted">{{ t.lang }}</span>
                <span class="muted">{{ t.license }}</span>
              </span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; }
.block { margin-top: 40px; }
.block h2, h2.block { font-size: var(--fs-3); margin-bottom: 4px; }
.viewers { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 12px; }
.viewer { display: grid; gap: 6px; align-content: start; padding: 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.kinds { display: flex; flex-wrap: wrap; gap: 2px 10px; color: var(--ink-2); padding-top: 6px; border-top: 1px solid var(--rule); }
.filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 28px 0 8px; }
.filters .chip { font: inherit; font-size: var(--fs-0); cursor: pointer; }
.filters .chip[aria-pressed='true'] { background: var(--ink); color: #fff; border-color: var(--ink); }
.group { padding-top: 32px; }
.group h3 { font-size: var(--fs-2); }
.rows { list-style: none; padding: 0; margin: 14px 0 0; border-top: 1px solid var(--rule); }
.row {
  display: grid; grid-template-columns: 13rem 1fr 15rem; gap: 20px; padding: 14px 4px;
  border-bottom: 1px solid var(--rule); color: var(--ink); text-decoration: none;
}
.row:hover { background: var(--surface); }
.meta { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.status.stale { color: #9A5B00; }
.status.dead { color: #A3262E; }
@media (max-width: 768px) { .row { grid-template-columns: 1fr; gap: 4px; } }
.viewer.engine { border-style: dashed; }
</style>
