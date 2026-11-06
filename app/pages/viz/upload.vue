<script setup lang="ts">
import { sniff, type Sniff } from '#shared/sniff'
import { kindLabels, viewers } from '#shared/viewers'
import type { Form, FormatSpec, Priority, Recipe, ViewerId } from '#shared/types'
import { fileUploadRecipes, publishesService, SERVICE_HOURS } from '#shared/conversion'
import { deliveries, forms, priorities, readIntent, recommend, type Delivery, type Intent } from '#shared/recommend'

// 내 파일로 해 보기: ① 파일 넣기(형식 판별) → ② 형식 고르기 → ③ 대상 라이브러리·목적·제공 방식 → 추천 (고급 설정에서 다른 방식) → ④ 변환 시작
// → 그 확장자의 시각화 단계로 이동해 변환 진행(JobProgress)·결과 지도 (고른 라이브러리로 연다). 추천 규칙은 MCP와 같은 shared/recommend.ts
useHead({ title: '내 파일로 해 보기 | 공간 데이터 시각화 도구' })

const router = useRouter()
const route = useRoute()

// 조건: 주소(?viewer=&priority=&delivery=&form=, MCP 화면의 "웹 업로드"가 넘김)에서 시작
const asked = () => readIntent({ viewer: String(route.query.viewer ?? ''), priority: String(route.query.priority ?? ''), delivery: String(route.query.delivery ?? ''), form: String(route.query.form ?? '') }) ?? {}
const viewer = ref<ViewerId | 'auto'>(asked().viewer ?? 'auto')
const priority = ref<Priority>(asked().priority ?? 'balanced')
const delivery = ref<Delivery>(asked().delivery ?? 'file')

/** 파일 방식의 최종본 형태: 결과 파일 + 적용 코드 / 바로 열리는 HTML 지도 */
const form = ref<Form>(asked().form ?? 'files')

// 미리 그린 화면은 쿼리 없이 만들어져, 브라우저에 붙은 뒤에야 쿼리가 보인다 → 그때 다시 적용 (이 화면은 자기 쿼리를 바꾸지 않아 고른 값을 덮지 않는다)
watch(() => route.query, () => {
  const a = asked()

  viewer.value = a.viewer ?? 'auto'
  priority.value = a.priority ?? 'balanced'
  delivery.value = a.delivery ?? 'file'
  form.value = a.form ?? 'files'
})

/** 이 서버가 48시간 임시 서비스 발행을 허용하는지 (공개 배포는 false). 묻지 못하면 미제공으로 본다 */
const serviceOn = ref(false)

onMounted(() => $fetch<{ service: boolean }>('/api/jobs/capabilities').then(r => { serviceOn.value = r.service }, () => { serviceOn.value = false }))

/** 사용자가 고급 설정에서 방식을 직접 골랐는지. 조건을 바꿔도 그 방식이 맞으면 유지 */
const picked = ref(false)

const file = ref<File | null>(null)
const found = ref<Sniff | null>(null)

/** 차례로 보인 판별 단계 수 (4 = 판별 끝) */
const shown = ref(0)
const format = ref<FormatSpec>()

/** 고른 방식·도구 = 업로드 레시피 id */
const method = ref<string>()

/** 업로드 진행률 0~1 (null = 올리기 전) */
const sent = ref<number | null>(null)
const error = ref('')
const over = ref(false)

/** 파일에 좌표계가 없을 때 고른 원본 좌표계 */
const srs = ref('')
let run = 0
const LIMIT = 200 * 1024 ** 2

// 국내 파일에 흔한 좌표계. 목록 밖 값도 EPSG:번호로 입력 가능
const SRS_LIST = [
  ['EPSG:5186', '중부원점 (GRS80, 원점 북 600km) — 2010년 이후 국가 표준'],
  ['EPSG:5185', '서부원점 (GRS80, 원점 북 600km)'],
  ['EPSG:5187', '동부원점 (GRS80, 원점 북 600km)'],
  ['EPSG:5188', '동해원점 (GRS80, 원점 북 600km)'],
  ['EPSG:5181', '중부원점 (GRS80, 원점 북 500km) — 카카오 지도 등'],
  ['EPSG:5179', 'UTM-K (GRS80) — 도로명주소·네이버 지도 등'],
  ['EPSG:5174', '보정 중부원점 (Bessel) — 옛 지적·인허가 자료'],
  ['EPSG:2097', '중부원점 (Bessel) — 옛 자료'],
  ['EPSG:4326', '위경도 (WGS84)'],
]

const intent = computed<Intent>(() => ({ ...(viewer.value !== 'auto' && { viewer: viewer.value }), priority: priority.value, delivery: delivery.value }))

/** 서버와 같은 규칙의 추천 (서버는 변환 시작 때 다시 계산·확인) */
const plan = computed(() => format.value && file.value && found.value
  ? recommend(format.value, intent.value, { bytes: file.value.size, count: found.value.count, srs: found.value.srs ?? null, blocked: found.value.blocked ?? null, schema: found.value.schema ?? null }, serviceOn.value)
  : null)

// 고급 설정의 방식 목록: 고른 제공 방식 쪽 레시피
const recipes = computed<Recipe[]>(() => !format.value ? [] : delivery.value === 'service' && serviceOn.value && 'recipes' in format.value.upload
  ? format.value.upload.recipes.filter(publishesService)
  : fileUploadRecipes(format.value))

const recipe = computed(() => recipes.value.find(r => r.id === method.value))
const chosen = computed(() => plan.value?.candidates.find(c => c.method === method.value))

// 조건·형식이 바뀌면 추천 방식으로. 직접 고른 방식이 새 조건에도 맞으면 유지
watch(plan, p => {
  if (!picked.value || !chosen.value || chosen.value.fit === 'unsupported') { method.value = p?.recommended?.method; picked.value = false }
})

watch(format, () => { picked.value = false })

const viewerOptions = [{ id: 'auto' as const, name: '자동 추천' }, ...viewers.map(v => ({ id: v.id, name: v.id === 'maplibre' ? 'MapLibre GL JS' : v.id === 'deck' ? 'Deck.gl' : v.name }))]
const unsupported = (id: ViewerId | 'auto') => id !== 'auto' && !!plan.value && !plan.value.byViewer.find(b => b.viewer === id)?.method
const canStart = computed(() => !!chosen.value && chosen.value.fit !== 'unsupported' && !plan.value?.blocked && !(delivery.value === 'service' && !serviceOn.value))
const fitLabels = { recommended: '추천', alternative: '대안', limited: '제약 있음', unsupported: '미지원' }

const srsOk = computed(() => !found.value?.srs || /^EPSG:\d{4,6}$/.test(srs.value.trim()))
const kinds = computed(() => [...new Set(recipe.value?.outputs.map(o => kindLabels[o.kind]) ?? [])])

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const cat = (f: FormatSpec) => categoryOf(f.category)!

// 확장자가 같은 형식(GeoTIFF·COG·DEM .tif)이 있어 이름으로 부른다. 괄호 설명은 뺀다
const label = (f: FormatSpec) => `${cat(f).name} ${f.name.replace(/\s*\(.*\)$/, '')}`

const stages = computed(() => {
  const f = file.value, s = found.value

  if (!f) return []

  return [
    { label: '파일', text: `${f.name} · ${bytes(f.size)}` },
    { label: '확장자', text: s ? (s.byExt.length > 3 ? `${s.ext} → 받는 형식 ${s.byExt.length}개 (내용으로 구분)` : s.byExt.length ? `${s.ext} → 후보 ${s.byExt.map(label).join(', ')}` : s.ext || '없음') : '' },
    { label: '내용', text: s ? s.facts.join(' · ') || '확인할 내용 없음' : '' },
    { label: '형식', text: s ? (s.picks[0] ? `${cat(s.picks[0]).name} · ${s.picks[0].name} (${s.picks[0].extensions[0]})` : s.note ?? '') : '', bad: !!s && !s.picks.length },
  ]
})

async function take(f?: File | null) {
  if (!f || sent.value !== null) return
  const me = ++run
  file.value = f; found.value = null; format.value = undefined; error.value = ''; shown.value = 1
  const result = await sniff(f, f.name, formats).catch<Sniff>(error => ({ ext: '', byExt: [], facts: [], picks: [], warns: [], note: error instanceof Error ? `파일 읽기 실패: ${error.message}` : '파일을 읽지 못했습니다.' }))

  if (f.size > LIMIT) Object.assign(result, { picks: [], note: `${bytes(f.size)} — 업로드 상한 ${bytes(LIMIT)} 넘음` })
  srs.value = result.srs?.guess ?? ''

  // 판별은 수십 ms. 단계마다 잠깐 머물러 무엇을 보고 정했는지 보이게 한다 (새 파일을 놓으면 앞 판별 표시는 멈춤)
  for (let i = 2; i <= 4; i++) {
    await wait(420)

    if (me !== run) return
    found.value = result
    shown.value = i
  }

  format.value = result.picks[0]
}

// $fetch는 업로드 진행률을 주지 않아 XHR로 올린다
function send() {
  const f = file.value, spec = format.value

  if (!f || !spec || !recipe.value) return
  const body = new FormData()
  body.append('format', `${spec.category}/${spec.id}`)
  body.append('method', recipe.value.id)
  body.append('priority', priority.value)
  body.append('delivery', delivery.value)

  if (delivery.value === 'file') body.append('form', form.value)

  if (viewer.value !== 'auto') body.append('viewer', viewer.value)

  if (found.value?.srs) body.append('srs', srs.value.trim())
  body.append('file', f)
  const x = new XMLHttpRequest()
  x.open('POST', '/api/jobs')
  x.upload.onprogress = e => { if (e.lengthComputable) sent.value = e.loaded / e.total }

  x.onload = () => {
    let res: any = {}

    try { res = JSON.parse(x.responseText) } catch {}

    if (x.status === 200 && res.id) return router.push({ path: stepPath(spec, 'view'), query: { job: res.id, ...(viewer.value !== 'auto' && { viewer: viewer.value }) } })
    error.value = res.statusMessage ?? res.message ?? `업로드 실패 (${x.status})`
    sent.value = null
  }

  x.onerror = () => { error.value = '업로드 실패. 서버 실행 여부 확인.'; sent.value = null }

  sent.value = 0
  x.send(body)
}

function drop(e: DragEvent) {
  over.value = false
  take(e.dataTransfer?.files?.[0])
}
</script>

<template>
  <div>
    <FlowSteps />
    <main class="wrap body">
      <header class="head">
        <h1>내 파일로 해 보기</h1>
        <p class="lead">파일을 넣으면 형식 판별 → 쓸 웹 지도 라이브러리·목적에 맞는 변환 추천 → 변환 과정 실시간 표시 → 지도·적용 코드. 최대 200MB, 한 번에 한 파일을 변환합니다. 서버의 원본·결과 파일은 운영자가 정리할 때까지 보관되며(기간 보장 없음) 결과 링크를 아는 사용자가 열 수 있습니다. 지원하는 대화 호스트에서도 사용할 수 있습니다: <NuxtLink to="/ai">MCP Apps 연결 (베타)</NuxtLink>.</p>
      </header>

      <ol class="flow">
        <li class="step" :class="{ done: shown >= 4 && !!found?.picks.length }">
          <h2>파일 넣기</h2>
          <div class="upload" :class="{ over }" @dragenter.prevent="over = true" @dragover.prevent="over = true" @dragleave.self="over = false" @drop.prevent="drop">
            <label class="drop">
              <input type="file" class="sr-only" :disabled="sent !== null" @change="take(($event.target as HTMLInputElement).files?.[0])">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
              <span><strong>파일 끌어 놓기</strong> 또는 <span class="pick">고르기</span></span>
              <span class="small muted">SHP는 zip으로(폴더째 가능), 타일셋은 zip 하나로. 받는 형식: 홈의 유형 카드</span>
            </label>
          </div>
          <ol v-if="file" class="sniff" aria-live="polite">
            <li v-for="(s, i) in stages" :key="`${run}-${i}`" :class="{ done: i < shown && !s.bad, bad: i < shown && s.bad, now: i === shown && shown < 4 }">
              <span class="dot" aria-hidden="true" />
              <span class="lab small">{{ s.label }}</span>
              <span class="txt">{{ i < shown ? s.text : i === shown ? '확인 중…' : '' }}</span>
            </li>
          </ol>
          <ul v-if="shown >= 4 && found?.warns.length" class="warns small">
            <li v-for="w in found.warns" :key="w">{{ w }}</li>
          </ul>
        </li>

        <li v-if="shown >= 4 && found?.picks.length" class="step" :class="{ done: !!format }">
          <h2>형식 고르기 <span class="sub small muted">{{ found.picks.length > 1 ? `후보 ${found.picks.length}개 — 판별 결과가 맞는지 확인` : '판별된 형식' }}</span></h2>
          <div class="formats" role="radiogroup" aria-label="형식">
            <button
              v-for="(f, i) in found.picks" :key="f.category + f.id" type="button" role="radio" class="fmt"
              :aria-checked="f === format" :disabled="sent !== null" :style="{ '--c': cat(f).color }" @click="format = f"
            >
              <span class="row">
                <span class="chip"><span class="chip-dot" />{{ cat(f).name }}</span>
                <span class="pill">{{ f.extensions[0] }}</span>
                <span v-if="origins[f.id]" class="origin" :class="origins[f.id]!.kind">{{ originLabels[origins[f.id]!.kind] }}</span>
                <span v-if="i === 0 && found.picks.length > 1" class="best small">판별 결과</span>
              </span>
              <strong class="name">{{ f.name }}</strong>
              <span class="summary small">{{ f.summary }}</span>
              <span v-if="'note' in f.upload" class="note small">올리기: {{ f.upload.note }}</span>
            </button>
          </div>
        </li>

        <li v-if="format && plan" class="step" :class="{ done: !!plan.recommended }" :style="{ '--c': cat(format).color }">
          <h2>라이브러리·목적 <span class="sub small muted">조건에 맞는 변환을 서버 규칙으로 추천</span></h2>
          <div class="conds">
            <div class="field">
              <span class="small">대상 웹 지도 라이브러리</span>
              <div class="seg" role="radiogroup" aria-label="대상 웹 지도 라이브러리">
                <button v-for="v in viewerOptions" :key="v.id" type="button" role="radio" :aria-checked="viewer === v.id" :disabled="sent !== null" @click="viewer = v.id">
                  {{ v.name }}<span v-if="unsupported(v.id)" class="sep">미지원</span>
                </button>
              </div>
            </div>
            <div class="field">
              <span class="small">목적</span>
              <div class="seg" role="radiogroup" aria-label="목적">
                <button v-for="p in priorities" :key="p.id" type="button" role="radio" :aria-checked="priority === p.id" :title="p.text" :disabled="sent !== null" @click="priority = p.id">{{ p.name }}</button>
              </div>
            </div>
            <div class="field">
              <span class="small">제공 방식</span>
              <div class="ways" role="radiogroup" aria-label="제공 방식">
                <button v-for="d in deliveries" :key="d.id" type="button" role="radio" class="fmt" :aria-checked="delivery === d.id" :disabled="sent !== null" @click="delivery = d.id">
                  <strong class="name">{{ d.title }}</strong>
                  <span class="summary small">{{ d.text }}</span>
                  <span v-if="d.id === 'service' && !serviceOn" class="small err">이 서버는 서비스 발행 미제공 (파일만)</span>
                </button>
              </div>
            </div>
            <div v-if="delivery === 'file'" class="field">
              <span class="small">최종본 형태</span>
              <div class="seg" role="radiogroup" aria-label="최종본 형태">
                <button v-for="f in forms" :key="f.id" type="button" role="radio" :aria-checked="form === f.id" :title="f.text" :disabled="sent !== null" @click="form = f.id">{{ f.title }}</button>
              </div>
              <span class="small muted">{{ forms.find(f => f.id === form)?.text }}</span>
            </div>
          </div>

          <section class="rec" aria-label="추천">
            <template v-if="plan.recommended && chosen">
              <p class="rec-head">
                <span class="small muted">{{ chosen === plan.recommended ? '추천 변환 방식' : `선택한 방식 (추천: ${plan.recommended.title})` }}</span>
                <span class="fit" :class="chosen.fit">{{ fitLabels[chosen.fit] }}</span>
              </p>
              <strong class="name">{{ chosen.title }} · {{ chosen.way === 'service' ? `서비스 (${SERVICE_HOURS}시간 임시)` : '파일' }}</strong>
              <p v-if="chosen.primary">
                {{ viewer === 'auto' ? '' : `${viewerOptions.find(v => v.id === viewer)?.name}에서 쓸 ` }}주력 결과물: <strong>{{ kindLabels[chosen.primary.kind] }}</strong> ({{ chosen.primary.label }})
                <span v-if="chosen.extras.length" class="small muted"> · 함께: {{ chosen.extras.map(e => kindLabels[e.kind]).join('·') }}</span>
              </p>
              <p v-if="viewer === 'auto'" class="small muted">대상 미지정 — 뷰어별: {{ plan.byViewer.map(b => `${b.name} ${b.output ? kindLabels[b.output.kind] : '미지원'}`).join(' · ') }}</p>
              <ul class="small">
                <li v-for="r in chosen.reasons" :key="r">{{ r }}</li>
              </ul>
              <ul v-if="chosen.warnings.length || plan.notes.length" class="small warn-list">
                <li v-for="w in [...chosen.warnings, ...plan.notes]" :key="w">{{ w }}</li>
              </ul>
              <p v-if="chosen.fit === 'unsupported'" class="small err">{{ chosen.reasons[0] }}</p>
            </template>
            <template v-else>
              <p class="small"><strong>추천 없음</strong> — 조건을 채우는 방식이 없음</p>
              <p class="small err">{{ plan.conflict }}</p>
            </template>
            <p v-if="plan.blocked" class="small err">변환 불가: {{ plan.blocked }}</p>
          </section>

          <details v-if="recipes.length" class="adv">
            <summary>다른 방식 보기 (고급 설정)</summary>
            <DeliveryGuide :key="format.category + format.id + delivery" :spec="format" :recipes :current="method" @select="method = $event; picked = true" />
            <ul class="small fits">
              <li v-for="c in plan.candidates" :key="c.method"><span class="fit" :class="c.fit">{{ fitLabels[c.fit] }}</span> {{ c.title }} — {{ c.reasons[0] }}</li>
            </ul>
          </details>
        </li>

        <li v-if="format && recipe" class="step go" :style="{ '--c': cat(format).color }">
          <h2>변환 시작</h2>
          <p class="choice">
            <strong>{{ label(format) }}</strong> · {{ isService(recipe) ? `서비스 (${SERVICE_HOURS}시간 임시)` : '파일' }} · {{ recipe.title }}
            <span class="arrow" aria-hidden="true">→</span>
            <span v-for="k in kinds" :key="k" class="pill">{{ k }}</span>
          </p>
          <p class="small muted">{{ delivery === 'service' ? `서비스는 발행 완료 후 ${SERVICE_HOURS}시간 뒤 자동 만료되고 같은 URL은 더 쓸 수 없음. 프로젝트에 계속 쓰려면 파일로 변환해 내려받기.` : form === 'html' ? '결과 화면에서 지도 페이지(index.html)·라이브러리·결과를 한 폴더 zip으로 받기. 정적 호스팅에 폴더째 올리면 그대로 열림.' : '결과 파일을 내려받아 자신의 웹 서버·애플리케이션에서 사용. 결과 화면에 적용 코드·호스팅 조건 표시.' }}</p>
          <div v-if="found?.srs" class="srs">
            <label class="small" for="srs-in"><strong>좌표계 선택</strong> — {{ found.srs.why }}</label>
            <input id="srs-in" v-model="srs" list="srs-list" placeholder="EPSG:5186" autocomplete="off" spellcheck="false" :disabled="sent !== null">
            <datalist id="srs-list">
              <option v-for="[code, desc] in SRS_LIST" :key="code" :value="code">{{ desc }}</option>
            </datalist>
            <span class="small muted">틀리면 지도의 엉뚱한 곳에 그려짐 → 다른 값으로 다시 올리기</span>
          </div>
          <button class="btn start" type="button" :disabled="sent !== null || !srsOk || !canStart" @click="send">변환 시작</button>
          <template v-if="sent !== null">
            <div class="bar" role="progressbar" aria-label="업로드" :aria-valuenow="Math.round(sent * 100)" aria-valuemin="0" aria-valuemax="100">
              <span :style="{ width: `${sent * 100}%` }" />
            </div>
            <p class="small muted">{{ sent < 1 ? `올리는 중 ${Math.round(sent * 100)}%` : '변환 작업 만드는 중…' }}</p>
          </template>
          <p v-if="error" class="small err" role="alert">{{ error }}</p>
        </li>
      </ol>
    </main>
  </div>
</template>

<style scoped>
.body { padding-top: 32px; padding-bottom: 64px; max-width: 64rem; }
.head { margin-bottom: 28px; }
.head h1 { font-size: var(--fs-4); }
.lead { margin-top: 4px; color: var(--ink-2); }

/* 단계: 번호 원 + 세로 줄. 끝난 단계는 체크 */
.flow { list-style: none; margin: 0; padding: 0; counter-reset: step; }
.step { position: relative; padding: 0 0 40px 52px; counter-increment: step; animation: rise 0.35s ease-out; }
.step::before {
  content: counter(step); position: absolute; left: 0; top: 0; width: 32px; height: 32px; border-radius: 50%;
  display: grid; place-items: center; background: var(--surface); border: 2px solid var(--rule); font-weight: 700; color: var(--ink-2);
  transition: background-color 0.2s, border-color 0.2s;
}
.step.done::before { content: '✓'; background: var(--ink); border-color: var(--ink); color: #fff; }
.step:not(:last-child)::after { content: ''; position: absolute; left: 15px; top: 36px; bottom: 4px; width: 2px; background: var(--rule); }
.step > h2 { font-size: var(--fs-2); line-height: 32px; margin-bottom: 12px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.sub { font-weight: 400; }

.upload { max-width: 40rem; }
.drop {
  display: grid; justify-items: center; gap: 4px; padding: 28px 16px; text-align: center; cursor: pointer;
  border: 1.5px dashed var(--rule); border-radius: var(--r-panel); background: var(--surface);
  transition: border-color 0.15s, background-color 0.15s;
}
.drop:hover, .drop:focus-within, .over .drop { border-color: var(--link); background: color-mix(in srgb, var(--link) 5%, var(--surface)); }
/* 끌고 있는 동안 자식 요소가 dragleave를 일으키지 않게 */
.over * { pointer-events: none; }
.icon { width: 32px; height: 32px; fill: none; stroke: var(--link); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.2s; }
.over .icon { transform: translateY(-3px); }
.pick { color: var(--link); text-decoration: underline; text-underline-offset: 3px; }

/* 판별 단계: 점 + 세로 줄. 끝난 단계는 줄이 차오르고 다음 점이 깜박인다 */
.sniff { list-style: none; margin: 16px 0 0; padding: 0; display: grid; max-width: 40rem; }
.sniff li { position: relative; display: grid; grid-template-columns: 14px 3.5rem minmax(0, 1fr); gap: 0 10px; align-items: baseline; padding-bottom: 10px; min-height: 30px; }
.sniff li:not(:last-child)::before {
  content: ''; position: absolute; left: 6px; top: 16px; bottom: -2px; width: 2px;
  background: var(--rule) linear-gradient(var(--ink-2), var(--ink-2)) top / 100% 0 no-repeat;
  transition: background-size 0.4s ease;
}
.sniff li.done:not(:last-child)::before { background-size: 100% 100%; }
.dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--rule); background: var(--surface); align-self: start; margin-top: 5px; position: relative; }
.now .dot { border-color: var(--link); animation: ping 1s ease-out infinite; }
.done .dot { border-color: var(--ink-2); background: var(--ink-2); animation: pop 0.25s ease-out; }
.done .dot::after { content: ''; position: absolute; left: 3px; top: 0; width: 3px; height: 6px; border: solid #fff; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
.bad .dot { border-color: #B42318; background: #B42318; }
.lab { color: var(--ink-2); font-weight: 600; }
.txt { min-width: 0; overflow-wrap: anywhere; font-size: var(--fs-0); }
.done .txt, .bad .txt { animation: rise 0.3s ease-out; }
.now .txt { color: var(--ink-2); }
.bad .txt { color: #B42318; }
.warns { margin: 4px 0 0; padding: 0 0 0 1.1rem; color: #8A5300; display: grid; gap: 2px; max-width: 40rem; animation: rise 0.3s ease-out; }

/* 형식 카드: 유형 색. 고른 카드는 테두리 + 옅은 배경 */
.formats { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); gap: 12px; }
.fmt {
  font: inherit; color: var(--ink); text-align: left; cursor: pointer; display: grid; gap: 6px; align-content: start;
  padding: 14px 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel);
}
.fmt:hover:not(:disabled) { border-color: var(--c); }
.fmt[aria-checked='true'] { border-color: var(--c); box-shadow: inset 0 0 0 1px var(--c); background: color-mix(in srgb, var(--c) 5%, var(--surface)); }
.fmt[aria-checked='true'] .name::after { content: ' ✓'; color: var(--c); }
.fmt:disabled { cursor: default; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.best { margin-left: auto; color: var(--c); font-weight: 700; }
.name { font-size: var(--fs-1); }
.summary { color: var(--ink-2); line-height: 1.55; }
.note { color: var(--ink-2); line-height: 1.5; padding-top: 6px; border-top: 1px dashed var(--rule); }

.go { display: grid; gap: 10px; justify-items: start; }
.choice { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.choice .arrow { color: var(--c); font-weight: 700; }
.start { background: var(--c); border-color: var(--c); color: #fff; font-weight: 600; padding: 8px 22px; font-size: var(--fs-1); }
.start:hover { border-color: var(--ink); }
.start:disabled { opacity: 0.6; cursor: default; }
.bar { width: min(100%, 40rem); height: 6px; border-radius: 3px; background: var(--stage); overflow: hidden; }
.bar span {
  display: block; height: 100%; background: var(--c); transition: width 0.2s;
  background-image: repeating-linear-gradient(-45deg, transparent 0 6px, rgb(255 255 255 / 0.3) 6px 12px); background-size: 17px 17px; animation: slide 0.6s linear infinite;
}
.err { color: #B42318; }
.seg button[aria-checked='true'] { background: var(--ink); color: #fff; }
.conds { display: grid; gap: 12px; margin-bottom: 14px; }
.field { display: grid; gap: 4px; }
.field > .small { font-weight: 600; color: var(--ink-2); }
.ways { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); gap: 10px; }
.rec { display: grid; gap: 6px; padding: 14px 16px; background: var(--surface); border: 1px solid var(--c); border-radius: var(--r-panel); max-width: 48rem; }
.rec ul { margin: 0; padding-left: 1.1rem; display: grid; gap: 2px; }
.rec-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.warn-list { color: #8A5300; }
.fit { font-size: 0.75rem; font-weight: 700; padding: 0 7px; border-radius: 99px; border: 1px solid currentColor; }
.fit.recommended { color: #067647; }
.fit.alternative, .fit.limited { color: #8A5300; }
.fit.unsupported { color: #B42318; }
.adv { margin-top: 14px; }
.adv summary { cursor: pointer; color: var(--ink-2); font-size: var(--fs-0); margin-bottom: 10px; }
.fits { margin: 0; padding-left: 1.1rem; display: grid; gap: 2px; color: var(--ink-2); }
.srs { display: grid; gap: 4px; width: min(100%, 40rem); }
.srs input { font: inherit; font-family: var(--mono); font-size: var(--fs-0); padding: 5px 8px; border: 1px solid var(--rule); border-radius: var(--r-control); max-width: 16rem; }
.srs input:focus { outline: 2px solid var(--c); outline-offset: 0; border-color: var(--c); }

@keyframes ping { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--link) 45%, transparent); } 100% { box-shadow: 0 0 0 8px transparent; } }
@keyframes pop { 0% { transform: scale(0.6); } 100% { transform: scale(1); } }
@keyframes rise { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: none; } }
@keyframes slide { to { background-position: 17px 0; } }
</style>
