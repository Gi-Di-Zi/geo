<script setup lang="ts">
import { UPLOAD_LAYER } from '#shared/catalog/_server'
import type { FormatSpec, Job, Report } from '#shared/types'

// 내 파일 변환 진행. 단계마다 대기 → 실행(경과 시간·명령·실시간 출력) → 완료(시간·로그). 페이지가 1초마다 받은 상태를 넘긴다
const props = defineProps<{ spec: FormatSpec; job: Job; report: Report | null; live: string; now: number }>()
const cat = computed(() => categoryOf(props.spec.category)!)
// 고른 방식·도구(업로드 레시피). 서버 방식의 레이어 이름 자리는 이 작업의 이름으로 보인다
const recipes = 'recipes' in props.spec.upload ? props.spec.upload.recipes : []
const recipe = recipes.find(r => r.id === props.job.method) ?? recipes[0]
const named = (run: string) => (props.job.layer ? run.replaceAll(UPLOAD_LAYER, props.job.layer) : run)
const steps = recipe ? [...recipe.preprocess.map(s => ({ ...s, run: named(s.run), stage: '전처리' })), ...recipe.convert.map(s => ({ ...s, run: named(s.run), stage: '변환' }))] : []
const records = computed(() => props.report?.steps ?? [])
const running = computed(() => props.job.state === 'running')
/** 지금 도는 단계 (기록이 남은 단계 수 = 다음 단계 번호) */
const at = computed(() => (running.value ? records.value.length : -1))
const doneCount = computed(() => records.value.filter(r => r.code === 0).length)
const pct = computed(() => props.job.state === 'done' ? 100 : steps.length ? (doneCount.value + (running.value ? 0.4 : 0)) / steps.length * 100 : 0)

// 초는 서버 시계 기준 (단계 시작 = 기록 시작 시각 + 끝난 단계 시간 합)
const skew = ref(0)
watch(() => props.now, n => { skew.value = n - Date.now() }, { immediate: true })
const tick = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { tick.value = Date.now() }, 200) })
onBeforeUnmount(() => clearInterval(timer))
const serverNow = computed(() => tick.value + skew.value)
const stepStart = computed(() => (props.report ? Date.parse(props.report.ranAt) + props.report.totalMs : Date.parse(props.job.createdAt)))
const total = computed(() => (running.value ? serverNow.value - Date.parse(props.job.createdAt) : props.report?.totalMs ?? 0))

const state = (i: number) => {
  const r = records.value[i]
  return r ? (r.code === 0 ? 'done' : 'bad') : i === at.value ? 'now' : 'wait'
}
const time = (i: number) => {
  const r = records.value[i]
  return r ? seconds(r.ms) : i === at.value ? seconds(Math.max(0, serverNow.value - stepStart.value)) : ''
}
const status = computed(() => ({ running: '변환 중', done: '완료 — 지도 여는 중', failed: '실패' })[props.job.state])

// 실시간 출력은 새 줄이 오면 맨 아래로
const logBox = ref<HTMLElement | null>(null)
watch(() => props.live, async () => { await nextTick(); logBox.value?.scrollTo({ top: logBox.value.scrollHeight }) })
</script>

<template>
  <section class="job" :class="job.state" :style="{ '--c': cat.color }" aria-live="polite">
    <header>
      <p class="kicker small">내 파일 변환 · {{ cat.name }} {{ spec.extensions[0] }}<template v-if="recipe"> · {{ isService(recipe) ? '서버 방식' : '파일 방식' }} · {{ recipe.title }}</template></p>
      <h1>{{ job.name }}</h1>
      <p class="small muted">{{ bytes(job.bytes) }}<template v-if="job.srs"> · 좌표계 {{ job.srs }} (선택)</template> · <strong class="st">{{ status }}</strong> · {{ seconds(total) }}</p>
    </header>
    <div class="bar" role="progressbar" aria-label="변환 진행" :aria-valuenow="Math.round(pct)" aria-valuemin="0" aria-valuemax="100">
      <span :style="{ width: `${pct}%` }" />
    </div>

    <ol class="track">
      <li class="row done">
        <span class="dot" aria-hidden="true" />
        <p class="head"><span class="stage small">수집</span> <strong>업로드</strong> <span class="t small">{{ bytes(job.bytes) }}</span></p>
      </li>
      <li v-for="(s, i) in steps" :key="i" class="row" :class="state(i)">
        <span class="dot" aria-hidden="true" />
        <p class="head">
          <span class="stage small">{{ s.stage }}</span>
          <strong>{{ s.title }}</strong>
          <ToolChip :id="s.tool" />
          <span class="t small">{{ time(i) }}</span>
        </p>
        <div v-if="i === at" class="body">
          <p class="why small"><TermText :text="s.why" /></p>
          <pre class="cmd"><code>{{ s.run }}</code></pre>
          <pre :ref="el => { logBox = el as HTMLElement | null }" class="log"><code>{{ live || '아직 출력 없음 — 도구 실행 중' }}</code></pre>
        </div>
        <details v-else-if="records[i]?.log" class="body" :open="records[i]!.code !== 0">
          <summary>로그</summary>
          <pre class="log"><code>{{ records[i]!.log }}</code></pre>
        </details>
      </li>
      <li class="row" :class="job.state === 'done' ? 'now' : 'wait'">
        <span class="dot" aria-hidden="true" />
        <p class="head"><span class="stage small">시각화</span> <strong>지도 표시</strong></p>
      </li>
    </ol>
    <p v-if="job.state === 'failed'" class="err" role="alert"><strong>변환 실패.</strong> {{ job.error }}</p>
  </section>
</template>

<style scoped>
.job { width: min(100%, 46rem); display: grid; gap: 14px; padding: 24px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.kicker { color: var(--c); font-weight: 600; }
h1 { font-size: var(--fs-3); overflow-wrap: anywhere; }
.st { color: var(--c); }
.failed .st, .err { color: #B42318; }

.bar { height: 8px; border-radius: 4px; background: var(--stage); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--c); transition: width 0.6s ease; }
.running .bar span {
  background-image: repeating-linear-gradient(-45deg, transparent 0 7px, rgb(255 255 255 / 0.3) 7px 14px);
  background-size: 20px 20px; animation: slide 0.7s linear infinite;
}

/* 단계 줄: 점 + 세로 줄. 끝난 단계까지 줄이 유형 색으로 찬다 */
.track { list-style: none; margin: 0; padding: 0; display: grid; }
.row { position: relative; display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 4px 12px; padding-bottom: 14px; }
.row:not(:last-child)::before {
  content: ''; position: absolute; left: 7px; top: 20px; bottom: 0; width: 2px;
  background: var(--rule) linear-gradient(var(--c), var(--c)) top / 100% 0 no-repeat; transition: background-size 0.5s ease;
}
.row.done::before { background-size: 100% 100%; }
.dot { width: 16px; height: 16px; margin-top: 4px; border-radius: 50%; border: 2px solid var(--rule); background: var(--surface); position: relative; z-index: 1; }
.done .dot { border-color: var(--c); background: var(--c); animation: pop 0.3s ease-out; }
.done .dot::after { content: ''; position: absolute; left: 4px; top: 1px; width: 4px; height: 7px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.now .dot { border-color: var(--c); animation: ping 1.2s ease-out infinite; }
.now .dot::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--c); }
.bad .dot { border-color: #B42318; background: #B42318; }
.bad .dot::after { content: '!'; position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 0.6875rem; font-weight: 700; line-height: 1; }
.head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; }
.wait .head { color: var(--ink-2); }
.stage { color: var(--ink-2); min-width: 2.6rem; }
.t { margin-left: auto; font-family: var(--mono); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.now .t { color: var(--c); font-weight: 500; }
.body { grid-column: 2; display: grid; gap: 6px; min-width: 0; animation: rise 0.3s ease-out; }
.why { color: var(--ink-2); }
.cmd { font-size: 0.75rem; max-height: 6.5em; overflow: auto; }
.cmd code::before { content: '$ '; color: #8FA3B5; }
.log { font-size: 0.75rem; max-height: 200px; overflow: auto; background: #2A3540; }

@keyframes ping { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--c) 50%, transparent); } 100% { box-shadow: 0 0 0 10px transparent; } }
@keyframes pop { 0% { transform: scale(0.5); } 70% { transform: scale(1.15); } 100% { transform: scale(1); } }
@keyframes rise { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: none; } }
@keyframes slide { to { background-position: 20px 0; } }
</style>
