<script setup lang="ts">
import { kindLabels, viewers } from '#shared/viewers'
import type { CollectReport, FormatSpec, Output, Recipe, Report, ViewerId } from '#shared/types'

/** 한 단계(수집·전처리·웹 형태 변환)의 내용. upload: 올린 파일로 돌린 경우라 수집 대신 올린 파일을 보여 준다 */
const props = defineProps<{ step: FlowStep; spec: FormatSpec; recipe: Recipe; report: Report | null; collected: CollectReport | null; upload?: { name: string; bytes: number } }>()
const base = useRuntimeConfig().app.baseURL
const dataDir = computed(() => `${base}data/${props.spec.category}/${props.spec.id}`)
const outDir = computed(() => `${dataDir.value}/${props.recipe.id}/`)
const source = computed(() => sourceOf(props.spec.collect.source))
const origin = computed(() => origins[props.spec.id])
const kind = computed(() => sampleOf(props.spec))
const where = computed(() => sourcesByScope(props.spec))
const free = computed(() => props.spec.otherSources.filter(o => accessOf(o) === 'auto').length)
const total = computed(() => props.collected?.files.reduce((a, f) => a + f.bytes, 0) ?? 0)
const records = (stage: 'preprocess' | 'convert') => props.report?.steps.filter(s => s.stage === stage)
const statOf = (id: string) => props.report?.outputs.find(o => o.id === id)
const sameFormat = (o: Output) => nativeKind[props.spec.id] === o.kind

// 선택한 레시피 요약 (서버 방식은 용량 대신 확인 요청의 첫 응답 시간)
const svc = computed(() => isService(props.recipe))
const outBytes = computed(() => props.report?.outputs.reduce((a, o) => a + o.bytes, 0) ?? 0)
const outFiles = computed(() => props.report?.outputs.reduce((a, o) => a + o.files, 0) ?? 0)
const firstMs = computed(() => {
  const ms = props.report?.outputs.flatMap(o => o.ms ?? []) ?? []
  const lo = Math.min(...ms), hi = Math.max(...ms)
  return !ms.length ? '-' : lo === hi ? `${lo}ms` : `${lo}–${hi}ms`
})

// 뷰어마다: 쓰는 결과물, 그 결과물을 읽는 API, 메모, 최소 코드 (코드 속 주소는 브라우저 주소 기준이라 붙은 뒤에 만든다)
const mounted = ref(false)
onMounted(() => { mounted.value = true })
const perViewer = computed(() => viewers.map(v => {
  const use = props.recipe.viewers[v.id as ViewerId]
  const output = 'output' in use ? props.recipe.outputs.find(o => o.id === use.output) : undefined
  return {
    v,
    output,
    level: supportOf(props.spec, props.recipe, v.id, succeeded(props.recipe, props.report)),
    api: output && viewerApi[v.id][output.kind],
    note: ('caution' in use && use.caution) || ('note' in use && use.note) || '',
    caution: 'caution' in use && !!use.caution,
    unsupported: 'unsupported' in use ? use.unsupported : '',
    code: output && mounted.value ? snippet(v.id, output, location.origin + outPath(outDir.value, output)) : '',
  }
}))
</script>

<template>
  <div class="route">
    <!-- 1 수집: 포맷 소개 + 샘플 원본(또는 올린 파일) + 데이터 받는 곳(국내·해외·개인) + 내 파일 올리기 -->
    <div v-if="step === 'collect'" class="cols">
      <section class="about" aria-labelledby="about-title">
        <p class="exts">{{ spec.extensions.join(' ') }}</p>
        <h2 id="about-title">{{ spec.name }}</h2>
        <p v-if="origin" class="origin-line">
          <span class="origin" :class="origin.kind">{{ originLabels[origin.kind] }}</span>
          <strong>{{ origin.by }}</strong>
          <span class="muted small">{{ origin.note }}</span>
        </p>
        <p class="summary">{{ spec.summary }}</p>
        <p class="prose"><TermText :text="spec.description" /></p>
        <template v-if="spec.anatomy">
          <h3>구성</h3>
          <dl class="anatomy">
            <template v-for="a in spec.anatomy" :key="a.name">
              <dt><code>{{ a.name }}</code></dt><dd>{{ a.role }}</dd>
            </template>
          </dl>
        </template>
      </section>

      <div class="side">
        <section v-if="upload" class="card">
          <h3>올린 파일</h3>
          <p class="small muted">업로드용 레시피 — 속성 이름·범위 가정 없음.</p>
          <ul class="files small">
            <li><span>{{ upload.name }}</span><span class="muted">{{ bytes(upload.bytes) }}</span></li>
          </ul>
        </section>
        <template v-else>
          <section class="card">
            <h3 class="sample-head">샘플 원본 <span class="sk" :class="`sk-${kind}`">{{ sampleLabels[kind] }}</span></h3>
            <p><a :href="spec.collect.url" target="_blank" rel="noopener">{{ spec.collect.dataset }}</a></p>
            <dl class="facts small">
              <dt>출처 표시</dt><dd>{{ spec.collect.attribution ?? source?.attribution ?? source?.name }}</dd>
              <dt>라이선스</dt><dd>{{ spec.collect.license ?? source?.license }}</dd>
              <template v-if="spec.collect.derived">
                <dt>범위</dt><dd>{{ spec.collect.derived }}</dd>
              </template>
              <template v-if="spec.collect.converted">
                <dt>변환</dt><dd>{{ spec.collect.converted }}</dd>
              </template>
              <template v-if="spec.noDomestic">
                <dt>국내 원본</dt><dd>{{ spec.noDomestic }}</dd>
              </template>
            </dl>
            <template v-if="collected?.published">
              <a v-if="collected.files.length > 6" class="dl" :href="`${dataDir}/raw.zip`" download>
                샘플 전체 받기 (zip) <span>파일 {{ collected.files.length.toLocaleString() }}개, {{ bytes(total) }}</span>
              </a>
              <ul v-else class="dls">
                <li v-for="f in collected.files" :key="f.name">
                  <a class="dl" :href="`${dataDir}/raw/${f.name}`" download>{{ f.name }} <span>{{ bytes(f.bytes) }}</span></a>
                </li>
              </ul>
            </template>
            <p v-else-if="collected" class="small muted">용량·재배포 조건상 출처에서 직접 받기.</p>
          </section>
          <!-- 다른 수급처는 많으면 20곳 넘음 → 접어 두고 샘플 원본을 먼저 보이게 -->
          <details class="card where-box">
            <summary>
              <h3>데이터 받는 곳</h3>
              <span class="small muted">{{ spec.otherSources.length ? `같은 형식 ${spec.otherSources.length}곳 · 로그인 없이 ${free}곳` : '없음' }}</span>
            </summary>
            <!-- 줄마다: 받는 조건 | 데이터셋 / 수급처 · 메모. 묶음 안은 받기 쉬운 순 -->
            <template v-for="g in where" :key="g.scope">
              <h4 class="scope small">{{ scopeLabels[g.scope] }} <span class="muted">{{ g.list.length }}</span></h4>
              <ul class="where">
                <li v-for="o in g.list" :key="o.source + o.dataset">
                  <span class="acc small" :class="accessOf(o)">{{ accessLabels[accessOf(o)] }}</span>
                  <span class="ds">{{ o.dataset }}</span>
                  <span class="small muted src"><a :href="sourceOf(o.source)!.url" target="_blank" rel="noopener">{{ sourceOf(o.source)!.name }}</a> · {{ o.note }}</span>
                </li>
              </ul>
            </template>
            <p v-if="!where.length" class="small muted">같은 형식의 다른 공개 데이터 없음.</p>
            <p class="small more"><NuxtLink to="/sources">사이트 모음 전체 →</NuxtLink></p>
          </details>
        </template>
        <section class="card mine">
          <h3>내 파일로 해 보기</h3>
          <p class="small muted">{{ 'note' in spec.upload ? `이 확장자: ${spec.upload.note}` : spec.upload.unsupported }}</p>
          <NuxtLink to="/upload" class="btn mine-go">파일 올리러 가기 →</NuxtLink>
        </section>
      </div>
    </div>

    <!-- 2 전처리 -->
    <StepList v-else-if="step === 'preprocess'" :steps="recipe.preprocess" :records="records('preprocess')" class="narrow" />

    <!-- 3 웹 형태 변환: 요약 → 변환 단계 → 결과물 → 뷰어별 처리 -->
    <template v-else-if="step === 'convert'">
      <section class="card summary" aria-labelledby="summary-title">
        <h2 id="summary-title">{{ recipe.title }} 요약 <span class="chip">{{ svc ? '서버 방식' : '파일 방식' }}</span></h2>
        <dl class="stats">
          <div><dt>걸린 시간</dt><dd>{{ report ? seconds(report.totalMs) : '-' }}</dd></div>
          <div v-if="svc"><dt>첫 응답</dt><dd>{{ firstMs }}</dd></div>
          <template v-else>
            <div><dt>결과 용량</dt><dd>{{ report ? bytes(outBytes) : '-' }}</dd></div>
            <div><dt>파일 수</dt><dd>{{ report ? outFiles.toLocaleString() : '-' }}</dd></div>
          </template>
          <div><dt>그릴 수 있는 뷰어</dt><dd>{{ perViewer.filter(p => p.output).length }} / {{ viewers.length }}</dd></div>
        </dl>
        <p v-if="report?.env" class="small muted">
          측정 조건: 1회 실행, 도구 이미지 받아 둔 상태, 서버 기동 시간 제외. 걸린 시간 = 단계 컨테이너 실행 시간 합.<template v-if="svc"> 첫 응답 = 결과물마다 확인 요청 1회.</template>
          {{ report.env.cpu }}, Docker {{ report.env.docker }} ({{ report.env.cores }}코어·메모리 {{ report.env.memGB }}GB), {{ report.env.os }}.
        </p>
      </section>

      <div class="cols">
        <section aria-labelledby="process-title">
          <h2 id="process-title">변환 단계</h2>
          <StepList :steps="recipe.convert" :records="records('convert')" />
        </section>
        <section aria-labelledby="outputs-title">
          <h2 id="outputs-title">결과물</h2>
          <ul class="outputs">
            <li v-for="o in recipe.outputs" :key="o.id" class="card">
              <p class="out-head">
                <strong>{{ o.label }}</strong>
                <span class="chip">{{ kindLabels[o.kind] }}</span>
                <span v-if="sameFormat(o)" class="chip same">원본과 같은 형식</span>
              </p>
              <p v-if="statOf(o.id)" class="small muted">
                <template v-if="statOf(o.id)!.ms !== undefined">첫 요청 {{ statOf(o.id)!.ms }}ms<template v-if="statOf(o.id)!.cachedMs !== undefined">, 같은 요청 다시 {{ statOf(o.id)!.cachedMs }}ms</template>, </template>{{ bytes(statOf(o.id)!.bytes) }}<template v-if="statOf(o.id)!.files > 1">, 파일 {{ statOf(o.id)!.files.toLocaleString() }}개</template><template v-if="statOf(o.id)!.features">, 피처 {{ statOf(o.id)!.features }}개</template>
              </p>
              <p class="small"><TermText :text="o.why" /></p>
            </li>
          </ul>
        </section>
      </div>

      <section aria-labelledby="per-viewer-title">
        <h2 id="per-viewer-title">뷰어별 처리 <span class="muted">· {{ recipe.title }}</span></h2>
        <ul class="viewers">
          <li v-for="p in perViewer" :key="p.v.id" class="card" :class="{ off: !p.output }">
            <p class="v-head">
              <strong>{{ p.v.name }}</strong> <span class="muted small">{{ p.v.dims }}</span>
              <span class="lv small" :class="`lv-${p.level}`">{{ supportLabels[p.level] }}</span>
            </p>
            <template v-if="p.output">
              <dl class="facts small">
                <dt>결과물</dt><dd>{{ p.output.label }} <span class="muted">({{ p.output.path }})</span></dd>
                <dt>처리</dt><dd><code>{{ p.api }}</code></dd>
                <template v-if="p.note">
                  <dt>{{ p.caution ? '주의' : '메모' }}</dt><dd :class="{ caution: p.caution }">{{ p.note }}</dd>
                </template>
              </dl>
              <pre v-if="p.code" class="code"><code>{{ p.code }}</code></pre>
            </template>
            <p v-else class="small no">{{ p.unsupported }}</p>
          </li>
        </ul>
        <p class="small muted legend">
          직접 처리: 원본과 같은 형식을 그대로 읽음. 변환 후 처리: 바꾼 결과물을 읽음. 일부 기능만: 그리지만 빠지는 기능 있음(카드의 주의). 미검증: 성공한 실행 기록 없음.
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.route h2 { font-size: var(--fs-2); margin-bottom: 12px; }
.route > section, .route > .cols + section { margin-top: 36px; }
.cols { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 32px 48px; align-items: start; }
.card { display: block; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); padding: 16px 18px; }
.side { display: grid; gap: 16px; }
.mine p { margin-bottom: 10px; }
.mine-go { text-decoration: none; background: var(--ink); border-color: var(--ink); color: #fff; font-weight: 600; padding: 6px 14px; }
.mine-go:hover { background: #2A3540; }
.side h3 { margin-bottom: 8px; }
.side .card > p { margin-bottom: 10px; }

.exts { font-size: var(--fs-2); font-weight: 700; color: var(--c); }
.about h2 { font-size: var(--fs-4); margin-bottom: 10px; }
.about h3 { font-size: var(--fs-1); margin: 24px 0 8px; }
.origin-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin-bottom: 14px; }
.summary { font-size: var(--fs-2); line-height: 1.55; color: var(--ink-2); margin-bottom: 12px; }
.anatomy { display: grid; grid-template-columns: minmax(4.5rem, max-content) 1fr; gap: 4px 16px; margin: 0; }
.anatomy dd { margin: 0; }

.facts { display: grid; grid-template-columns: 5.5rem 1fr; gap: 2px 12px; margin: 0 0 12px; }
.facts dt { color: var(--ink-2); }
.facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.files { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 2px; }
.files li { display: flex; gap: 10px; }
.dls { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.dl {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px;
  background: var(--ink); color: #fff; text-decoration: none; font-size: var(--fs-0); font-weight: 600;
}
.dl::before { content: ''; width: 12px; height: 12px; background: currentColor; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M6 1v7M3 5l3 3 3-3M1.5 11h9' stroke='black' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E") center / contain no-repeat; }
.dl span { font-weight: 400; opacity: 0.75; }
.dl:hover { background: color-mix(in srgb, var(--ink) 85%, var(--c)); }
.sample-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.where-box > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; color: var(--ink); font-size: inherit; }
.where-box > summary::before { align-self: center; }
.where-box > summary h3 { margin: 0; }
.where-box[open] > summary { margin-bottom: 12px; }
.scope { margin: 14px 0 4px; padding-bottom: 4px; border-bottom: 1px solid var(--rule); color: var(--ink-2); font-weight: 600; }
.scope:first-of-type { margin-top: 0; }
/* 한 줄 = 받는 조건 칸 + 내용 칸 (데이터셋 / 수급처 · 메모) */
.where { list-style: none; padding: 0; margin: 0; display: grid; }
.where li { display: grid; grid-template-columns: 5.5rem minmax(0, 1fr); gap: 0 10px; padding: 7px 0; }
.where li + li { border-top: 1px dashed var(--rule); }
.acc { grid-row: span 2; align-self: start; justify-self: start; padding: 0 7px; border-radius: 999px; border: 1px solid var(--rule); color: var(--ink-2); white-space: nowrap; }
.acc.auto { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, transparent); }
.ds { font-weight: 600; overflow-wrap: anywhere; }
.src { overflow-wrap: anywhere; }
.more { margin-top: 12px; }
.narrow { max-width: 56rem; }

.summary { margin-bottom: 36px; }
.summary h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 0; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px 24px; margin: 14px 0 10px; }
.stats dt { font-size: var(--fs-0); color: var(--ink-2); }
.stats dd { margin: 0; font-size: var(--fs-3); font-weight: 600; line-height: 1.3; }
.outputs { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.outputs .card { display: grid; gap: 4px; }
.out-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.same { border-color: var(--c); color: var(--c); }
.viewers { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.viewers .card { display: grid; gap: 8px; align-content: start; min-width: 0; }
.viewers .off { background: var(--paper); }
.v-head { display: flex; align-items: baseline; gap: 8px; }
.v-head .lv { margin-left: auto; font-weight: 600; }
.legend { margin-top: 10px; }
.viewers .facts { margin: 0; }
.code { max-height: 240px; overflow: auto; font-size: 0.75rem; white-space: pre; }
.caution { color: #8A5300; }
@media (max-width: 900px) {
  .cols, .viewers { grid-template-columns: minmax(0, 1fr); }
}
</style>
