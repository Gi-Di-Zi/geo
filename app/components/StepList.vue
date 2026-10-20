<script setup lang="ts">
import type { Report, Step } from '#shared/types'

defineProps<{ steps: Step[]; records?: Report['steps'] }>()
// 실행 결과는 검사 단계(무결성 확인)와 실패한 단계만 보인다. 변환 단계의 진행 로그는 군더더기
const showLog = (s: Step, r?: Report['steps'][number]) => !!r?.log && (s.title.startsWith('무결성 확인') || r.code !== 0)
</script>

<template>
  <ol class="steps">
    <li v-for="(s, i) in steps" :key="i">
      <p class="title">
        <span class="no">{{ i + 1 }}</span>
        <strong>{{ s.title }}</strong>
        <ToolChip :id="s.tool" />
        <span v-if="records?.[i]" class="small muted">{{ seconds(records[i].ms) }}</span>
        <span v-if="records?.[i] && records[i].code !== 0" class="small failed">실패 (종료 코드 {{ records[i].code }})</span>
      </p>
      <pre class="cmd"><code>{{ s.run }}</code></pre>
      <p class="why"><TermText :text="s.why" /></p>
      <div v-if="showLog(s, records?.[i])" class="result">
        <span class="small muted">결과</span>
        <pre class="log"><code>{{ records![i]!.log }}</code></pre>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 22px; }
/* 주소처럼 끊을 곳 없는 긴 낱말이 좁은 화면을 밀어내지 않게 한다 */
.steps > li { min-width: 0; overflow-wrap: anywhere; display: grid; gap: 6px; }
.title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.no {
  width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none;
  background: var(--ink); color: #fff; font-size: 0.75rem; font-weight: 600;
}
.cmd { font-size: 0.8125rem; }
.why { color: var(--ink-2); font-size: var(--fs-0); }
.result { display: grid; gap: 2px; }
.log { background: #2A3540; max-height: 220px; overflow: auto; font-size: 0.75rem; }
.failed { color: #B42318; font-weight: 600; }
</style>
