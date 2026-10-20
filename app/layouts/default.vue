<template>
  <div class="shell">
    <main>
      <slot />
    </main>
    <footer class="foot">
      <div class="wrap small muted">
        <p>샘플 출처·라이선스: 각 확장자의 수집 단계. 배경지도: VWorld, © OpenStreetMap contributors.</p>
        <p class="links"><NuxtLink to="/tools">뷰어·도구</NuxtLink><NuxtLink to="/sources">수급처</NuxtLink><NuxtLink to="/status">현황</NuxtLink></p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; display: flex; flex-direction: column; }
main { flex: 1; }
.foot { border-top: 1px solid var(--rule); padding: 24px 0 40px; margin-top: 80px; }
.foot .wrap { display: grid; gap: 4px; }
.links { display: flex; gap: 14px; }
.links a { color: var(--ink-2); }
</style>
