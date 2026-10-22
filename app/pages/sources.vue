<script setup lang="ts">
import type { Source } from '#shared/types'

const notes: Record<Source['scope'], string> = {
  domestic: '국내 공공기관·공공 플랫폼.',
  abroad: '해외 정부·기관, 전 세계 공개 데이터 플랫폼.',
  personal: '개인 블로그·저장소, 커뮤니티 프로젝트. 원출처·라이선스 따로 확인.',
}
const groups = (Object.keys(scopeLabels) as Source['scope'][])
  .map(scope => ({ scope, title: scopeLabels[scope], note: notes[scope], list: sources.filter(s => s.scope === scope) }))
  .filter(g => g.list.length)
useHead({ title: '데이터 받는 곳 | 공간 데이터 웹 처리' })
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <h1>데이터 받는 곳</h1>
      <p class="prose lead">공간 데이터 다운로드 사이트 모음. 국내·해외·개인·커뮤니티 구분, 사이트별 받을 수 있는 확장자 연결.</p>
      <p class="prose small muted">
        샘플 분류: <span class="sk sk-domestic">국내 공공 데이터</span> 국내 기관 원본 →
        없으면 <span class="sk sk-abroad">해외 데이터</span> 해외 기관 원본 →
        없으면 <span class="sk sk-other">기타 데이터</span> 다른 형식에서 변환한 샘플·개인 자료 →
        <span class="sk sk-none">샘플 없음</span>. 공통 조건: 로그인 없이, 재배포 허용.
      </p>
      <nav class="jump small" aria-label="구분">
        <a v-for="g in groups" :key="g.scope" :href="`#g-${g.scope}`">{{ g.title }} <span class="muted">{{ g.list.length }}</span></a>
      </nav>
      <section v-for="g in groups" :key="g.scope" class="group" :aria-labelledby="`g-${g.scope}`">
        <h2 :id="`g-${g.scope}`">{{ g.title }} <span class="muted">{{ g.list.length }}</span></h2>
        <p class="small muted">{{ g.note }}</p>
        <ul class="rows">
          <li v-for="s in g.list" :key="s.id" class="row">
            <div>
              <a :href="s.url" target="_blank" rel="noopener"><strong>{{ s.name }}</strong></a>
              <p class="small badges">
                <span class="chip">{{ accessLabels[s.access] }}</span>
                <span class="chip" :class="s.redistribute">{{ redistLabels[s.redistribute] }}</span>
              </p>
            </div>
            <div>
              <p>{{ s.provides }}</p>
              <p class="small muted">라이선스: {{ s.license }}</p>
              <p v-if="s.note" class="small muted">{{ s.note }}</p>
            </div>
            <div class="small">
              <template v-if="formatsFromSource(s.id).length">
                <p v-for="u in formatsFromSource(s.id)" :key="u.format.category + u.format.id" :class="{ muted: u.format.closed }">
                  <NuxtLink :to="`/${u.format.category}/${u.format.id}`">{{ u.format.extensions[0] }} {{ u.format.name }}</NuxtLink>
                  <span v-if="u.used" class="sk use" :class="`sk-${sampleOf(u.format)}`" :title="sampleLabels[sampleOf(u.format)]">샘플</span>
                  <span v-else class="muted"> 다른 경로</span>
                </p>
              </template>
              <p v-else class="muted">연결된 확장자 없음.</p>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; }
.lead { margin-top: 8px; font-size: var(--fs-2); color: var(--ink-2); line-height: 1.55; }
.lead + p { margin-top: 10px; line-height: 1.9; }
.jump { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.jump a { padding: 4px 12px; border: 1px solid var(--rule); border-radius: 999px; background: var(--surface); color: var(--ink); text-decoration: none; }
.jump a:hover { border-color: var(--ink-2); }
.group { margin-top: 40px; }
.group h2 { font-size: var(--fs-3); margin-bottom: 4px; }
.rows { list-style: none; padding: 0; margin: 16px 0 0; border-top: 1px solid var(--rule); }
.row { display: grid; grid-template-columns: 15rem 1fr 13rem; gap: 24px; padding: 18px 4px; border-bottom: 1px solid var(--rule); }
.badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip.no { color: #A3262E; border-color: #E8C3C6; }
.chip.yes { color: var(--ok); }
.use { margin-left: 6px; }
@media (max-width: 900px) { .row { grid-template-columns: 1fr; gap: 8px; } }
</style>
