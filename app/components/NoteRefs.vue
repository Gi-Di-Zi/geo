<script setup lang="ts">
// 개념 정리노트(/notes) 푸터의 참고 자료: 링크를 누르면 팝업(popover — 바깥 누르기·Esc 닫기는 브라우저 몫). 내용은 면접 문서(interview.txt)의 소개·학습 순서·출처
</script>

<template>
  <p>
    <button type="button" class="open" popovertarget="note-refs">참고 자료</button>
    · 학습 순서 {{ interview.steps.length }}단계 · 자료 확인일 {{ interview.checked }}
  </p>
  <div id="note-refs" popover class="refs" aria-labelledby="note-refs-h">
    <div class="top">
      <h2 id="note-refs-h">참고 자료</h2>
      <button type="button" class="btn" popovertarget="note-refs" popovertargetaction="hide">닫기</button>
    </div>
    <p v-for="p in interview.intro" :key="p" class="intro">{{ p }}</p>
    <ol class="steps">
      <li v-for="s in interview.steps" :key="s.title">
        <p><b>{{ s.title }}</b></p>
        <p class="intro">{{ s.text }}</p>
        <ul class="srcs">
          <li v-for="r in s.refs" :key="r"><a :href="interview.sources.get(r)?.url" target="_blank" rel="noopener" :title="interview.sources.get(r)?.text">{{ r }} {{ interview.sources.get(r)?.title }}</a></li>
        </ul>
        <p v-if="s.caution" class="caution">주의: {{ s.caution }}</p>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.open { padding: 0; font: inherit; color: var(--link); background: none; border: 0; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
/* 닫힌 popover에 display를 주면 계속 보인다 → 열렸을 때만 */
.refs:popover-open {
  display: grid; gap: 6px; width: min(44rem, calc(100vw - 32px)); max-height: min(80vh, 48rem); overflow: auto;
  padding: 20px 24px; font-size: var(--fs-0); line-height: 1.6; color: var(--ink);
  background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); box-shadow: 0 12px 40px rgb(0 0 0 / 0.25);
}
.refs::backdrop { background: rgb(22 32 42 / 0.35); }
.top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.top h2 { font-size: var(--fs-2); }
.intro { color: var(--ink-2); }
.steps { display: grid; gap: 14px; margin: 10px 0 0; padding-left: 1.4em; }
.srcs { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 4px 0 0; padding: 0; list-style: none; }
.srcs a { color: var(--link); }
.caution { margin-top: 4px; color: #8A5300; }
</style>
