<script setup lang="ts">
const access = { auto: '로그인 없이', key: '인증키', login: '로그인', approval: '승인' }
const redist = { yes: '재배포 가능', conditional: '조건부 (출처표시 등)', no: '재배포 불가' }
// 샘플은 국내 기관 원본만. 해외 출처는 닫힌 확장자를 다시 열 때 참고용으로 남긴다
const groups = [
  { id: 'domestic', title: '국내 기관', note: '샘플 출처와 같은 종류 데이터의 국내 수급처.', list: sources.filter(s => s.domestic) },
  { id: 'abroad', title: '해외 (참고)', note: '국내 원본이 없어 닫힌 확장자의 이전 샘플 출처. 현재 미사용.', list: sources.filter(s => !s.domestic) },
]
useHead({ title: '데이터 수급처 | 공간 데이터 웹 처리' })
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <h1>데이터 수급처</h1>
      <p class="prose lead">샘플: 국내 기관이 그 형식 그대로 배포하는 원본만. 로그인 없이, 재배포 허용.</p>
      <section v-for="g in groups" :key="g.id" class="group" :aria-labelledby="`g-${g.id}`">
        <h2 :id="`g-${g.id}`">{{ g.title }}</h2>
        <p class="small muted">{{ g.note }}</p>
        <ul class="rows">
          <li v-for="s in g.list" :key="s.id" class="row">
            <div>
              <a :href="s.url" target="_blank" rel="noopener"><strong>{{ s.name }}</strong></a>
              <p class="small badges">
                <span class="chip">{{ access[s.access] }}</span>
                <span class="chip" :class="s.redistribute">{{ redist[s.redistribute] }}</span>
              </p>
            </div>
            <div>
              <p>{{ s.provides }}</p>
              <p class="small muted">라이선스: {{ s.license }}</p>
              <p v-if="s.note" class="small muted">{{ s.note }}</p>
            </div>
            <div class="small">
              <template v-if="formatsFromSource(s.id).length">
                <p v-for="(u, i) in formatsFromSource(s.id)" :key="i" :class="{ muted: u.format.closed }">
                  <NuxtLink :to="`/${u.format.category}/${u.format.id}`">{{ u.format.extensions[0] }} {{ u.format.name }}</NuxtLink>
                  <span class="muted">{{ u.format.closed ? ' 샘플 없음' : u.used ? ' 샘플 출처' : ' 다른 경로' }}</span>
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
.group { margin-top: 40px; }
.group h2 { font-size: var(--fs-3); margin-bottom: 4px; }
.rows { list-style: none; padding: 0; margin: 16px 0 0; border-top: 1px solid var(--rule); }
.row { display: grid; grid-template-columns: 15rem 1fr 13rem; gap: 24px; padding: 18px 4px; border-bottom: 1px solid var(--rule); }
.badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip.no { color: #A3262E; border-color: #E8C3C6; }
.chip.yes { color: var(--ok); }
@media (max-width: 900px) { .row { grid-template-columns: 1fr; gap: 8px; } }
</style>
