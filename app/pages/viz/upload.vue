<script setup lang="ts">
import { sniff, type Sniff } from '#shared/sniff'
import { kindLabels } from '#shared/viewers'
import type { FormatSpec, Recipe } from '#shared/types'
import { fileUploadRecipes } from '#shared/conversion'

// 내 파일로 해 보기: ① 파일 넣기(형식 판별) → ② 형식 고르기 → ③ 방식·도구 고르기 → ④ 변환 시작
// → 그 확장자의 시각화 단계로 이동해 변환 진행(JobProgress)·결과 지도
useHead({ title: '내 파일로 해 보기 | 공간 데이터 시각화 도구' })

const router = useRouter()

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

const recipes = computed<Recipe[]>(() => format.value ? fileUploadRecipes(format.value) : [])
const recipe = computed(() => recipes.value.find(r => r.id === method.value))

// 형식을 바꾸면 그 형식의 첫 방식·도구(기본값)로
watch(format, () => { method.value = recipes.value[0]?.id })

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

  if (found.value?.srs) body.append('srs', srs.value.trim())
  body.append('file', f)
  const x = new XMLHttpRequest()
  x.open('POST', '/api/jobs')
  x.upload.onprogress = e => { if (e.lengthComputable) sent.value = e.loaded / e.total }

  x.onload = () => {
    let res: any = {}

    try { res = JSON.parse(x.responseText) } catch {}

    if (x.status === 200 && res.id) return router.push({ path: stepPath(spec, 'view'), query: { job: res.id } })
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
        <p class="lead">파일을 넣으면 형식 판별 → 형식·방식·도구 고르기 → 변환 과정 실시간 표시 → 지도. 최대 200MB, 한 번에 한 파일을 변환합니다. 원본과 결과는 운영자가 정리할 때까지 보관되며 결과 링크를 아는 사용자가 열 수 있습니다. 지원하는 대화 호스트에서도 사용할 수 있습니다: <NuxtLink to="/ai">MCP Apps 연결 (베타)</NuxtLink>.</p>
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

        <li v-if="format && recipes.length" class="step" :class="{ done: !!recipe }">
          <DeliveryGuide :key="format.category + format.id" :spec="format" :recipes :current="method" @select="method = $event" />
        </li>

        <li v-if="format && recipe" class="step go" :style="{ '--c': cat(format).color }">
          <h2>변환 시작</h2>
          <p class="choice">
            <strong>{{ label(format) }}</strong> · {{ isService(recipe) ? '서버 방식' : '파일 방식' }} · {{ recipe.title }}
            <span class="arrow" aria-hidden="true">→</span>
            <span v-for="k in kinds" :key="k" class="pill">{{ k }}</span>
          </p>
          <p class="small muted">이 배포에서는 파일로 만드는 변환 경로를 제공합니다. 공유 공간 서버에 새 레이어를 발행하는 방식은 제공하지 않습니다.</p>
          <div v-if="found?.srs" class="srs">
            <label class="small" for="srs-in"><strong>좌표계 선택</strong> — {{ found.srs.why }}</label>
            <input id="srs-in" v-model="srs" list="srs-list" placeholder="EPSG:5186" autocomplete="off" spellcheck="false" :disabled="sent !== null">
            <datalist id="srs-list">
              <option v-for="[code, desc] in SRS_LIST" :key="code" :value="code">{{ desc }}</option>
            </datalist>
            <span class="small muted">틀리면 지도의 엉뚱한 곳에 그려짐 → 다른 값으로 다시 올리기</span>
          </div>
          <button class="btn start" type="button" :disabled="sent !== null || !srsOk" @click="send">변환 시작</button>
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
.srs { display: grid; gap: 4px; width: min(100%, 40rem); }
.srs input { font: inherit; font-family: var(--mono); font-size: var(--fs-0); padding: 5px 8px; border: 1px solid var(--rule); border-radius: var(--r-control); max-width: 16rem; }
.srs input:focus { outline: 2px solid var(--c); outline-offset: 0; border-color: var(--c); }

@keyframes ping { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--link) 45%, transparent); } 100% { box-shadow: 0 0 0 8px transparent; } }
@keyframes pop { 0% { transform: scale(0.6); } 100% { transform: scale(1); } }
@keyframes rise { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: none; } }
@keyframes slide { to { background-position: 17px 0; } }
</style>
