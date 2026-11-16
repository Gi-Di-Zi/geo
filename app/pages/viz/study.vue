<script setup lang="ts">
const query = ref('')
const category = ref('')
const matches = (text: string) => text.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
const listedFormats = computed(() => formats.filter(f => (!category.value || f.category === category.value) && matches([f.name, ...f.extensions, f.summary, f.description].join(' '))))
const listedTools = computed(() => tools.filter(t => matches([t.name, t.summary, t.description, t.io].join(' '))))

useSeoMeta({ title: '공간 데이터 학습 정리 | geo', description: '확장자별 특징과 변환 도구, DEM·DSM 차이, 타원체·투영 좌표계와 면접 질문을 한 페이지에서 공부합니다.' })
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <h1>공간 데이터 학습 정리</h1>
      <p class="prose">확장자·변환 도구를 비교하고, 지형과 좌표계의 차이를 면접 질문으로 복습하세요.</p>
      <nav class="links" aria-label="학습 목차"><a href="#formats">확장자 비교</a><a href="#tools">변환 도구</a><a href="#dem-dsm">DEM·DSM</a><a href="#ellipsoidal-projected">좌표계·높이 기준</a><a href="#interview">면접 복습</a></nav>
      <label for="study-search">확장자·도구 검색</label>
      <input id="study-search" v-model="query" type="search" placeholder="예: GeoTIFF, GDAL">
      <label for="study-category">데이터 유형</label>
      <select id="study-category" v-model="category"><option value="">모든 유형</option><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option></select>
      <section id="formats">
        <h2>확장자 비교 ({{ listedFormats.length }})</h2>
        <p v-if="!listedFormats.length" role="status">일치하는 확장자가 없습니다.</p>
        <article v-for="f in listedFormats" :key="`${f.category}/${f.id}`">
          <h3><NuxtLink :to="stepPath(f, 'collect')">{{ f.name }}</NuxtLink> <span class="small">{{ f.extensions.join(' · ') }}</span></h3>
          <p>{{ f.summary }}</p><p>{{ f.description }}</p>
          <ul v-if="f.anatomy"><li v-for="a in f.anatomy" :key="a.name"><strong>{{ a.name }}</strong>: {{ a.role }}</li></ul>
          <p v-if="f.closed">{{ f.closed }}</p>
          <ul><li v-for="r in f.recipes" :key="r.id">{{ r.title }}: {{ r.convert.map(s => toolOf(s.tool)?.name ?? s.tool).join(' → ') }} → {{ r.outputs.map(o => o.label).join(' · ') }}</li></ul>
        </article>
      </section>
      <section id="tools">
        <h2>변환 도구 ({{ listedTools.length }})</h2>
        <p v-if="!listedTools.length" role="status">일치하는 도구가 없습니다.</p>
        <article v-for="t in listedTools" :key="t.id">
          <h3><NuxtLink :to="`/viz/tools/${t.id}`">{{ t.name }}</NuxtLink></h3>
          <p>{{ t.summary }}</p><p>{{ t.description }}</p><p>{{ t.io }}</p><pre><code>{{ t.example }}</code></pre>
        </article>
      </section>
      <StudyConcepts />
      <StudyReview />
      <p><NuxtLink to="/viz/concepts">타일·COG·LOD 등 기본 개념 더 보기</NuxtLink></p>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; }
.links { display: flex; flex-wrap: wrap; gap: 16px; margin: 24px 0; }
label { display: block; margin-top: 12px; }
input, select { max-width: 100%; padding: 8px; font: inherit; }
section { margin-top: 36px; }
article { border-top: 1px solid var(--rule); padding: 20px 0; }
p, ul, pre { margin-top: 10px; }
pre { overflow-x: auto; padding: 12px; }
h3 .small { font-weight: 400; }
</style>
