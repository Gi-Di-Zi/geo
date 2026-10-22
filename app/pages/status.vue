<script setup lang="ts">
import { engine, engineOutput, viewers } from '#shared/viewers'
import type { FormatSpec, StatusEntry, ViewerId } from '#shared/types'
import type { SampleKind } from '~/utils/catalog'

// 실측 현황은 public/ 정적 파일이라 브라우저에서 받는다
const { data: status } = useFetch<StatusEntry[]>(`${useRuntimeConfig().app.baseURL}data/status.json`, { server: false, default: () => [] })
const entryOf = (f: FormatSpec) => status.value.find(s => s.format === `${f.category}/${f.id}`)
const recipeState = (f: FormatSpec, id: string) => entryOf(f)?.recipes.find(r => r.id === id)
/** 엔진 렌더러 상태: 대상(3D Tiles·지형 결과) 아니면 null. 레시피 하나라도 성공하면 확인 */
function engineOf(f: FormatSpec) {
  const rs = f.recipes.filter(r => engineOutput(r))
  if (!rs.length) return null
  const states = rs.map(r => recipeState(f, r.id)?.engine)
  return states.includes('done') ? { cls: 'lv-direct', label: '엔진 확인' } : states.includes('failed') ? { cls: 'bad', label: '실패' } : { cls: 'lv-untested', label: '미확인' }
}
/** 뷰어마다 레시피 중 가장 좋은 처리 수준 */
const levelOf = (f: FormatSpec, v: ViewerId) => supportOrder.find(l => f.recipes.some(r => supportOf(f, r, v, recipeState(f, r.id)?.state === 'done') === l))!

const groups = computed(() => categories.map(c => ({ cat: c, list: formatsOf(c.id) })).filter(g => g.list.length))
// 닫힌 확장자(샘플 없음)는 세지 않는다
const openFormats = formats.filter(f => !f.closed)
const openIds = new Set(openFormats.map(f => `${f.category}/${f.id}`))
const recipes = computed(() => status.value.filter(s => openIds.has(s.format)).flatMap(s => s.recipes))
const done = computed(() => recipes.value.filter(r => r.state === 'done').length)
const uploadable = openFormats.filter(f => 'recipe' in f.upload).length
/** 샘플 분류별 확장자 수 */
const kinds = (Object.keys(sampleLabels) as SampleKind[]).map(k => ({ k, n: formats.filter(f => sampleOf(f) === k).length })).filter(x => x.n)

/** 과정 보기 링크: 그 도구를 고른 확장자의 변환 단계 */
const processLink = (f: FormatSpec, id: string) => ({ path: stepPath(f, 'convert'), query: id === f.recipes[0]!.id ? {} : { tool: id } })

// 아직 페이지가 없는 확장자
const planned = [
  { ext: '.indoorgml', note: '실내 공간 표준(IndoorGML). 재배포 가능한 공개 샘플 탐색 중.' },
]
const candidates = 'KML, GPX, DXF, ECW, ASC, HGT, E57, PLY, OBJ, FBX, OSM PBF, COPC'

useHead({ title: '확장자별 현황 | 공간 데이터 웹 처리' })
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <h1>확장자별 현황</h1>
      <p class="prose lead">
        확장자별 샘플 출처, 원본 보관 여부, 도구별 변환 결과.
        성공한 변환 클릭 → 단계별 명령·로그.
      </p>
      <p v-if="status.length" class="prose summary">
        샘플 있는 확장자 {{ openFormats.length }}개 —
        <template v-for="(x, i) in kinds" :key="x.k"><template v-if="i">, </template><span class="sk" :class="`sk-${x.k}`">{{ sampleLabels[x.k] }}</span> {{ x.n }}개</template>.
        변환 성공: 레시피 {{ recipes.length }}개 중 {{ done }}개. 파일 업로드 지원: {{ uploadable }}개 확장자.
      </p>
      <p class="prose small muted">
        샘플 기준: 국내 기관 원본(국내 공공) → 없으면 해외 기관 원본(해외) → 없으면 다른 형식에서 변환한 샘플·개인 자료(기타) → 샘플 없음. 공통: 로그인 없이, 재배포 허용. 사이트 목록: <NuxtLink to="/sources">데이터 받는 곳</NuxtLink>.
        뷰어 칸: 레시피 중 가장 좋은 처리 수준. 직접 처리(원본 형식 그대로), 변환 후 처리, 일부 기능만, 미검증(성공한 실행 기록 없음), 미지원.
        DEM(수치표고모델)은 확장자가 아닌 데이터 종류. 대표 형식: <NuxtLink to="/terrain/tif">GeoTIFF(.tif)</NuxtLink>, ERDAS IMG(.img, 국내 공개DEM은 로그인 필요 → 해외 샘플).
      </p>

      <section v-for="g in groups" :key="g.cat.id" class="group" :style="{ '--c': g.cat.color }" :aria-labelledby="`g-${g.cat.id}`">
        <h2 :id="`g-${g.cat.id}`"><NuxtLink :to="{ path: '/', query: { type: g.cat.id } }">{{ g.cat.name }}</NuxtLink></h2>
        <div class="head-row small muted" aria-hidden="true">
          <span>확장자</span><span>샘플 출처</span><span>원본</span><span>변환</span><span>뷰어</span><span>업로드</span>
        </div>
        <ul class="rows">
          <li v-for="f in g.list" :key="f.id" class="row">
            <div>
              <NuxtLink :to="`/${f.category}/${f.id}`" class="ext">{{ f.extensions.join(' ') }}</NuxtLink>
              <p class="small muted">{{ f.name }}</p>
            </div>

            <div class="small">
              <span class="lbl">샘플 출처</span>
              <p class="sk" :class="`sk-${sampleOf(f)}`">{{ sampleLabels[sampleOf(f)] }}</p>
              <p><a :href="f.collect.url" target="_blank" rel="noopener">{{ f.collect.dataset }}</a></p>
              <p class="muted">{{ sourceOf(f.collect.source)?.name }}, {{ sourceOf(f.collect.source)?.license }}</p>
              <p v-if="f.closed" class="derived">샘플 없음: {{ f.closed }}</p>
              <p v-else-if="f.collect.derived" class="muted">잘라 낸 범위: {{ f.collect.derived }}</p>
              <p v-if="f.collect.converted" class="derived">변환: {{ f.collect.converted }}</p>
              <p v-if="f.noDomestic" class="muted">국내 원본: {{ f.noDomestic }}</p>
              <p v-if="f.otherSources.length" class="muted">다른 경로</p>
              <ul v-if="f.otherSources.length" class="others muted">
                <li v-for="o in f.otherSources" :key="o.source + o.dataset" :title="o.note">
                  <a :href="sourceOf(o.source)?.url" target="_blank" rel="noopener">{{ sourceOf(o.source)?.name }}</a>&nbsp;{{ o.dataset }}
                </li>
              </ul>
            </div>

            <div class="small">
              <span class="lbl">원본</span>
              <template v-if="entryOf(f)?.raw">
                <p class="ok">받음&nbsp;<span class="muted">{{ bytes(entryOf(f)!.raw!.bytes) }}<template v-if="entryOf(f)!.raw!.files > 1">, {{ entryOf(f)!.raw!.files.toLocaleString() }}개 파일</template></span></p>
                <p v-if="entryOf(f)!.published"><NuxtLink :to="stepPath(f, 'collect')">원본 받기</NuxtLink></p>
                <p v-else class="muted">출처에서 직접 다운로드 (용량·재배포 조건)</p>
              </template>
              <p v-else-if="status.length" class="no">아직 안 받음</p>
            </div>

            <div class="small">
              <span class="lbl">변환</span>
              <ul class="recipes">
                <li v-for="r in f.recipes" :key="r.id">
                  <template v-if="recipeState(f, r.id)?.state === 'done'">
                    <span class="ok" aria-label="성공">✓</span>
                    <span><NuxtLink :to="processLink(f, r.id)">{{ r.title }}</NuxtLink>&nbsp;<span class="muted">{{ seconds(recipeState(f, r.id)!.totalMs!) }}, {{ bytes(recipeState(f, r.id)!.bytes!) }}</span></span>
                  </template>
                  <template v-else-if="recipeState(f, r.id)?.state === 'failed'">
                    <span class="bad" aria-label="실패">✗</span>
                    <span><NuxtLink :to="processLink(f, r.id)">{{ r.title }}</NuxtLink>&nbsp;<span class="bad">{{ recipeState(f, r.id)!.failedStep ?? '출력 확인' }} 단계에서 멈춤</span></span>
                  </template>
                  <template v-else>
                    <span class="no" aria-label="안 돌림">–</span>
                    <span>{{ r.title }}&nbsp;<span class="muted">아직 안 돌림</span></span>
                  </template>
                </li>
              </ul>
            </div>

            <div class="small">
              <span class="lbl">뷰어</span>
              <ul class="viewers">
                <li v-for="v in viewers" :key="v.id">
                  {{ v.name }} <span :class="`lv-${levelOf(f, v.id)}`">{{ supportLabels[levelOf(f, v.id)] }}</span>
                </li>
                <li v-if="engineOf(f)" class="engine-row">{{ engine.name }} <span :class="engineOf(f)!.cls">{{ engineOf(f)!.label }}</span></li>
              </ul>
            </div>

            <div class="small">
              <span class="lbl">업로드</span>
              <p v-if="'accept' in f.upload" class="ok">지원&nbsp;<span class="muted">{{ f.upload.accept.join(' ') }}</span></p>
              <template v-else>
                <p class="no">미지원</p>
                <p class="muted">{{ f.upload.unsupported }}</p>
              </template>
            </div>
          </li>
        </ul>
      </section>

      <section class="group" aria-labelledby="g-planned">
        <h2 id="g-planned">페이지 없는 확장자</h2>
        <ul class="planned">
          <li v-for="p in planned" :key="p.ext"><strong>{{ p.ext }}</strong> <span class="muted">{{ p.note }}</span></li>
          <li><strong>추가 후보</strong> <span class="muted">{{ candidates }}. 확장자당 파일 하나 — 필요 시 추가.</span></li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; }
.lead { margin-top: 8px; font-size: var(--fs-2); color: var(--ink-2); line-height: 1.55; }
.summary { margin-top: 16px; }
.group { margin-top: 48px; }
.group h2 { font-size: var(--fs-2); padding-left: 12px; border-left: 4px solid var(--c, var(--ink)); }
.group h2 a { color: inherit; text-decoration: none; }
.head-row, .row { display: grid; grid-template-columns: 9rem minmax(0, 1fr) 9rem 15rem 13rem 9rem; gap: 20px; }
.head-row { margin-top: 16px; padding: 0 4px 8px; border-bottom: 1px solid var(--rule); }
.rows { list-style: none; padding: 0; margin: 0; }
.row { padding: 16px 4px; border-bottom: 1px solid var(--rule); align-items: start; }
.row p { margin: 0; }
.row p + p { margin-top: 2px; }
.ext { font-size: var(--fs-2); font-weight: 600; color: var(--c); text-decoration: none; }
.derived { color: #8A5A00; }
.others { list-style: none; margin: 0; padding: 0; }
.others a { color: inherit; }
.recipes, .viewers { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.recipes li { display: grid; grid-template-columns: 1em 1fr; gap: 4px; }
.bad { color: #B42318; }
.engine-row { padding-top: 4px; border-top: 1px dashed var(--rule); }
.lbl { display: none; }
.planned { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 8px; }
@media (max-width: 1100px) {
  .head-row { display: none; }
  .row { grid-template-columns: 1fr 1fr; gap: 14px 20px; }
  .row > :first-child, .row > :nth-child(2) { grid-column: 1 / -1; }
  .lbl { display: block; color: var(--ink-2); font-weight: 600; margin-bottom: 2px; }
}
@media (max-width: 560px) {
  .row { grid-template-columns: 1fr; }
}
</style>
