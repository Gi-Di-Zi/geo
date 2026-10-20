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

// 실측 기록은 public/ 정적 파일이라 브라우저에서 받는다 (SSR 내부 요청은 public/을 못 본다)
const dir = `${useRuntimeConfig().app.baseURL}data/${spec.category}/${spec.id}`
const { data: report } = useFetch<Report>(() => `${dir}/${recipe.value.id}/report.json`, { server: false, immediate: !spec.closed, default: () => null as any })
const { data: collected } = useFetch<CollectReport>(`${dir}/collect.json`, { server: false, immediate: !spec.closed, default: () => null as any })

// 내 파일 모드 (?job=작업 id). 정적으로 미리 그린 화면과 어긋나지 않게 브라우저에 붙은 뒤에만 읽는다
const mounted = ref(false)
const jobId = computed(() => (mounted.value && typeof route.query.job === 'string' ? route.query.job : ''))
const mine = computed(() => !!jobId.value)
const job = ref<{ job: Job; report: Report | null } | null>(null)
const jobError = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
async function poll() {
  clearTimeout(timer)
  if (!jobId.value) { job.value = null; return }
  try {
    job.value = await $fetch<{ job: Job; report: Report | null }>(`/api/jobs/${jobId.value}`)
    jobError.value = ''
    if (job.value.job.state === 'running') timer = setTimeout(poll, 2000)
  } catch (e: any) {
    job.value = null
    jobError.value = e?.data?.statusMessage ?? '작업 없음. 업로드는 서버 실행 중에만 가능.'
  }
}
onMounted(() => { mounted.value = true; watch(jobId, poll, { immediate: true }) })
onBeforeUnmount(() => clearTimeout(timer))

const uploadRecipe = 'recipe' in spec.upload ? spec.upload.recipe : undefined
const shown = computed<Recipe>(() => (mine.value && uploadRecipe ? job.value?.job.recipe ?? uploadRecipe : recipe.value))
const shownReport = computed(() => (mine.value ? job.value?.report ?? null : report.value))
const steps = computed(() => `${job.value?.report?.steps.length ?? 0}/${uploadRecipe ? uploadRecipe.preprocess.length + uploadRecipe.convert.length : 0}`)
const stepLink = (id: FlowStep) => ({ path: stepPath(spec, id), query: route.query })

useHead(() => ({ title: `${spec.extensions[0]} ${spec.name} · ${flow[at.value]!.name} | 공간 데이터 웹 처리` }))
</script>

<template>
  <div class="format-page" :class="{ 'map-step': step === 'view' }" :style="{ '--c': cat.color }">
    <FlowSteps :spec="spec.closed ? undefined : spec" :step>
      <div v-if="spec.recipes.length > 1 || mine" class="seg" role="group" aria-label="변환 도구 선택">
        <button v-for="r in spec.recipes" :key="r.id" type="button" :aria-pressed="!mine && r.id === recipe.id" @click="recipeId = r.id">{{ r.title }}</button>
        <button v-if="mine" type="button" aria-pressed="true">내 파일</button>
      </div>
      <NuxtLink v-if="step === 'view'" to="/" class="btn back">← 다른 데이터 보기</NuxtLink>
    </FlowSteps>

    <div v-if="spec.closed" class="wrap body">
      <h1>{{ spec.extensions[0] }} 샘플 없음</h1>
      <p class="lead">{{ spec.closed }}</p>
      <p class="pager"><NuxtLink :to="{ path: '/', query: { type: cat.id } }" class="btn">← 확장자 다시 고르기</NuxtLink></p>
    </div>
    <template v-else-if="step === 'view'">
      <CompareStage
        v-if="!mine || job?.job.state === 'done'"
        :spec :recipe="shown" :color="cat.color" :base="mine ? `/api/jobs/${jobId}/files/` : undefined"
      />
      <section v-else class="pending" aria-live="polite">
        <div class="prose">
          <p v-if="jobError">{{ jobError }}</p>
          <p v-else-if="job?.job.state === 'failed'"><strong>변환 실패.</strong> {{ job.job.error }} 로그: <NuxtLink :to="stepLink('convert')">변환 단계</NuxtLink></p>
          <p v-else>{{ job?.job.name }} 변환 중 — {{ steps }} 단계 완료. 끝나면 지도 표시.</p>
          <p class="small"><NuxtLink :to="{ query: {} }">샘플 보기</NuxtLink></p>
        </div>
      </section>
    </template>

    <div v-else class="wrap body">
      <header class="head">
        <p class="kicker small">{{ at + 1 }}단계<template v-if="step !== 'collect'"> · {{ mine ? '내 파일' : recipe.title }} 레시피</template></p>
        <h1>{{ flow[at]!.name }}</h1>
        <p class="lead">{{ flow[at]!.text }}</p>
      </header>
      <StepRoute :step :spec :recipe="shown" :report="shownReport" :collected :upload="mine ? job?.job : undefined" />
      <ToolCompare v-if="step === 'convert' && !mine && spec.recipes.length > 1" :spec :current="recipe.id" @select="recipeId = $event" />
      <nav class="pager" aria-label="단계 이동">
        <NuxtLink v-if="prev" :to="stepLink(prev.id)" class="btn">← {{ prev.name }}</NuxtLink>
        <NuxtLink v-else :to="{ path: '/', query: { type: cat.id } }" class="btn">← 확장자 다시 고르기</NuxtLink>
        <NuxtLink v-if="next" :to="stepLink(next.id)" class="btn next">다음: {{ next.name }} →</NuxtLink>
      </nav>
    </div>
  </div>
</template>

<style scoped>
/* 화면 비교 단계는 단계 막대 아래를 지도가 다 채운다 */
.map-step { height: 100dvh; display: flex; flex-direction: column; }
.body { padding-top: 32px; }
.head { margin-bottom: 28px; }
.kicker { color: var(--c); font-weight: 600; }
.lead { margin-top: 4px; font-size: var(--fs-2); color: var(--ink-2); }
.pager { display: flex; gap: 12px; justify-content: space-between; margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--rule); }
.pager .btn { text-decoration: none; padding: 8px 16px; }
.pager .next { margin-left: auto; background: var(--ink); border-color: var(--ink); color: #fff; font-weight: 600; }
.back { text-decoration: none; white-space: nowrap; }
.pending { flex: 1; display: grid; place-items: center; padding: 24px var(--gutter); background: var(--stage); }
</style>
