<script setup lang="ts">
// 푸터: 사이트 공통(만든 사람·저장소)과, 공간 데이터 시각화 도구(/viz) 안에서만 그 프로젝트의 출처·링크
const route = useRoute()
const inViz = computed(() => route.path.startsWith('/viz'))
</script>

<template>
  <div class="shell">
    <main>
      <slot />
    </main>
    <footer class="foot">
      <div class="wrap small muted">
        <template v-if="inViz">
          <p>샘플 출처·라이선스: 각 확장자의 수집 단계(샘플 데이터는 각 출처 라이선스). 배경지도: VWorld, © OpenStreetMap contributors.</p>
          <p class="links"><NuxtLink to="/viz/why">처음이라면</NuxtLink><NuxtLink to="/viz/tools">뷰어·도구</NuxtLink><NuxtLink to="/viz/sources">데이터 받는 곳</NuxtLink><NuxtLink to="/viz/status">현황</NuxtLink></p>
        </template>
        <p>만든 사람: Gi-Di-Zi · <a href="https://github.com/Gi-Di-Zi/geo">GitHub 저장소</a> · 코드 MIT</p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; display: flex; flex-direction: column; }
main { flex: 1; }
.foot { border-top: 1px solid var(--rule); padding: 24px 0 40px; margin-top: 80px; }
.foot .wrap { display: grid; gap: 4px; }
.links { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.links a { color: var(--ink-2); }
</style>
