<script setup lang="ts">
import type { CollectReport, Job, Recipe, Report } from '#shared/types'

const route = useRoute()
const router = useRouter()
const spec = formatOf(String(route.params.category), String(route.params.format))
if (!spec) throw createError({ statusCode: 404, message: '아직 없는 확장자예요' })
const cat = categoryOf(spec.category)!

// 단계는 주소의 마지막 칸 (/유형/확장자[/preprocess|convert|view]). 없으면 첫 단계(수집)
const step = computed(() => (route.params.step || 'collect') as FlowStep)
if (!flow.some(s => s.id === step.value)) throw createError({ statusCode: 404, message: '없는 단계예요' })
const at = computed(() => flow.findIndex(s => s.id === step.value))
const prev = computed(() => flow[at.value - 1])
const next = computed(() => flow[at.value + 1])

const recipeId = computed({
  get: () => String(route.query.tool ?? spec.recipes[0]!.id),
  set: tool => router.replace({ query: tool === spec.recipes[0]!.id ? {} : { tool } }),
})
const recipe = computed(() => spec.recipes.find(r => r.id === recipeId.value) ?? spec.recipes[0]!)
// 전처리 도구 고르기: 지금 레시피가 이미 그 전처리를 쓰면 그대로, 아니면 그 전처리를 쓰는 첫 레시피로
const preGroups = preprocessGroups(spec)
const preGroup = computed(() => preGroups.find(g => g.recipes.includes(recipe.value)))
const pickPre = (g: (typeof preGroups)[number]) => { if (!g.recipes.includes(recipe.value)) recipeId.value = g.recipes[0]!.id }

// 실측 기록은 public/ 정적 파일이라 브라우저에서 받는다 (SSR 내부 요청은 public/을 못 본다)
const dir = `${useRuntimeConfig().app.baseURL}data/${spec.category}/${spec.id}`
const { data: report } = useFetch<Report>(() => `${dir}/${recipe.value.id}/report.json`, { server: false, immediate: !spec.closed, default: () => null as any })
const { data: collected } = useFetch<CollectReport>(`${dir}/collect.json`, { server: false, immediate: !spec.closed, default: () => null as any })

// 내 파일 모드 (?job=작업 id). 정적으로 미리 그린 화면과 어긋나지 않게 브라우저에 붙은 뒤에만 읽는다
const mounted = ref(false)
const jobId = computed(() => (mounted.value && typeof route.query.job === 'string' ? route.query.job : ''))
const mine = computed(() => !!jobId.value)
// ?embed=1: 다른 화면 안에 넣어 보일 때(MCP App 결과 지도) 위쪽 단계 막대를 숨긴다
const embed = computed(() => mounted.value && route.query.embed === '1')
type JobState = { job: Job; report: Report | null; live: string; now: number }
const job = ref<JobState | null>(null)
const jobError = ref('')
/** 지도로 바꿔도 되는지. 도는 걸 보던 중 끝나면 완료 표시를 잠깐 보인 뒤 */
const mapReady = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
async function poll() {
  clearTimeout(timer)
  if (!jobId.value) { job.value = null; return }
  try {
    const next = await $fetch<JobState>(`/api/jobs/${jobId.value}`)
    const prev = job.value?.job.id === next.job.id ? job.value : null
    // 기록 파일을 쓰는 순간 읽으면 null → 앞서 받은 기록 유지
    if (!next.report && prev) next.report = prev.report
    if (next.job.state !== 'done') mapReady.value = false
    else if (prev?.job.state === 'running') setTimeout(() => { mapReady.value = true }, 1500)
    else mapReady.value = true
    job.value = next
    jobError.value = ''
    if (next.job.state === 'running') timer = setTimeout(poll, 1000)
  } catch (e: any) {
    job.value = null
    jobError.value = e?.data?.statusMessage ?? '작업 없음. 업로드는 서버 실행 중에만 가능.'
  }
}
onMounted(() => { mounted.value = true; watch(jobId, poll, { immediate: true }) })
onBeforeUnmount(() => clearTimeout(timer))

// 내 파일: 업로드 때 고른 방식·도구(레시피). 끝나면 범위·시점을 채운 작업의 레시피
const uploadRecipes = 'recipes' in spec.upload ? spec.upload.recipes : []
const uploadRecipe = computed(() => uploadRecipes.find(r => r.id === job.value?.job.method) ?? uploadRecipes[0])
const shown = computed<Recipe>(() => (mine.value && uploadRecipe.value ? job.value?.job.recipe ?? uploadRecipe.value : recipe.value))
const shownReport = computed(() => (mine.value ? job.value?.report : report.value) ?? null)
const stepLink = (id: FlowStep) => ({ path: stepPath(spec, id), query: route.query })

useHead(() => ({ title: `${spec.extensions[0]} ${spec.name} · ${flow[at.value]!.name} | 공간 데이터 시각화 도구` }))
</script>

<template>
  <div class="format-page" :class="{ 'map-step': step === 'view' }" :style="{ '--c': cat.color }">
    <!-- 도구(레시피)는 전처리·변환 단계 본문 카드, 시각화 단계 지도 위 도구 메뉴에서 고른다 -->
    <FlowSteps v-if="!embed" :spec="spec.closed ? undefined : spec" :step>
      <span v-if="mine" class="chip">내 파일</span>
      <NuxtLink v-if="step === 'view'" to="/viz" class="btn back">← 다른 데이터</NuxtLink>
    </FlowSteps>

    <div v-if="spec.closed" class="wrap body">
      <h1>{{ spec.extensions[0] }} 샘플 없음</h1>
      <p class="lead">{{ spec.closed }}</p>
      <p class="pager"><NuxtLink :to="{ path: '/', query: { type: cat.id } }" class="btn">← 확장자 다시 고르기</NuxtLink></p>
    </div>
    <template v-else-if="step === 'view'">
      <CompareStage
        v-if="!mine || mapReady"
        :spec :recipe="shown" :color="cat.color" :base="mine ? `/api/jobs/${jobId}/files/` : undefined"
        @select="recipeId = $event"
      />
      <section v-else class="pending">
        <JobProgress v-if="job" :spec :job="job.job" :report="job.report" :live="job.live" :now="job.now" />
        <p v-else-if="jobError" class="prose">{{ jobError }}</p>
        <p v-else class="small muted">작업 불러오는 중…</p>
        <p class="small"><NuxtLink to="/viz/upload">다른 파일 올리기</NuxtLink> · <NuxtLink :to="{ query: {} }">샘플 보기</NuxtLink></p>
      </section>
    </template>

    <div v-else class="wrap body">
      <header class="head">
        <p class="kicker small">{{ at + 1 }}단계<template v-if="step !== 'collect'"> · {{ mine ? '내 파일' : recipe.title }} 레시피</template></p>
        <h1>{{ flow[at]!.name }}</h1>
        <p class="lead">{{ flow[at]!.text }}</p>
      </header>
      <DeliveryGuide v-if="step === 'convert' && !mine" :spec :current="recipe.id" @select="recipeId = $event" />
      <DeliveryGuide v-else-if="step === 'convert'" :spec :recipes="uploadRecipes" :current="uploadRecipe?.id" readonly />
      <section v-if="step === 'preprocess' && !mine && preGroups.length > 1" class="pre-pick" aria-labelledby="pre-pick-title">
        <h2 id="pre-pick-title">전처리 도구</h2>
        <div class="seg" role="group" aria-label="전처리 도구">
          <button v-for="g in preGroups" :key="g.label" type="button" :aria-pressed="g === preGroup" @click="pickPre(g)">{{ g.label }}</button>
        </div>
        <p v-if="preGroup" class="small muted">이 전처리 뒤 변환 도구: {{ preGroup.recipes.map(r => r.title).join(' · ') }}</p>
      </section>
      <StepRoute :step :spec :recipe="shown" :report="shownReport" :collected="collected ?? null" :upload="mine ? job?.job : undefined" />
      <nav class="pager" aria-label="단계 이동">
        <NuxtLink v-if="prev" :to="stepLink(prev.id)" class="btn">← {{ prev.name }}</NuxtLink>
        <NuxtLink v-else :to="{ path: '/', query: { type: cat.id } }" class="btn">← 확장자 다시 고르기</NuxtLink>
        <NuxtLink v-if="next" :to="stepLink(next.id)" class="btn next">다음: {{ next.name }} →</NuxtLink>
      </nav>
    </div>
  </div>
</template>

<style scoped>
/* 시각화·렌더링 단계는 단계 막대 아래를 지도가 다 채운다 */
.map-step { height: 100dvh; display: flex; flex-direction: column; }
.body { padding-top: 32px; }
.head { margin-bottom: 28px; }
.kicker { color: var(--c); font-weight: 600; }
.lead { margin-top: 4px; font-size: var(--fs-2); color: var(--ink-2); }
.pager { display: flex; gap: 12px; justify-content: space-between; margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--rule); }
.pager .btn { text-decoration: none; padding: 8px 16px; }
.pager .next { margin-left: auto; background: var(--ink); border-color: var(--ink); color: #fff; font-weight: 600; }
.back { text-decoration: none; white-space: nowrap; }
.pre-pick { display: grid; gap: 8px; justify-items: start; margin-bottom: 28px; }
.pre-pick h2 { font-size: var(--fs-2); }
.pending { flex: 1; min-height: 0; overflow: auto; display: grid; justify-items: center; align-content: start; gap: 12px; padding: 32px var(--gutter); background: var(--stage); }
</style>
