<script setup lang="ts">
import { viewers } from '#shared/viewers'
import type { FormatSpec, Report, ViewerUse } from '#shared/types'

const props = defineProps<{ spec: FormatSpec; current: string }>()
const emit = defineEmits<{ select: [id: string] }>()
const dir = `${useRuntimeConfig().app.baseURL}data/${props.spec.category}/${props.spec.id}`

const { data: reports } = useAsyncData(`compare-${props.spec.category}-${props.spec.id}`, () =>
  Promise.all(props.spec.recipes.map(r => $fetch<Report>(`${dir}/${r.id}/report.json`).catch(() => null))), { server: false, default: () => [] })

const rows = computed(() => props.spec.recipes.map((r, i) => {
  const rep = reports.value[i]
  return {
    recipe: r,
    svc: isService(r),
    ms: rep?.totalMs ?? 0,
    bytes: rep?.outputs.reduce((a, o) => a + o.bytes, 0) ?? 0,
    files: rep?.outputs.reduce((a, o) => a + o.files, 0) ?? 0,
    level: Object.fromEntries(viewers.map(v => [v.id, supportOf(props.spec, r, v.id, succeeded(r, rep))])),
  }
}))
const hint = (u: ViewerUse) => ('unsupported' in u ? u.unsupported : u.caution ?? u.note ?? '')
// 측정 조건: 기록마다 같은 기계에서 돌지만, 마지막에 돈 기록 기준으로 보인다
const env = computed(() => reports.value.filter(r => r?.env).sort((a, b) => b!.ranAt.localeCompare(a!.ranAt))[0]?.env)
const maxMs = computed(() => Math.max(1, ...rows.value.map(r => r.ms)))
const maxBytes = computed(() => Math.max(1, ...rows.value.filter(r => !r.svc).map(r => r.bytes)))
</script>

<template>
  <section class="compare" aria-labelledby="compare-title">
    <h2 id="compare-title">도구별 비교</h2>
    <p class="muted small">같은 원본의 도구별 실측 기록. 행 선택 시 해당 도구로 전환.</p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">도구</th>
            <th scope="col">걸린 시간</th>
            <th scope="col">결과 용량</th>
            <th scope="col">파일 수</th>
            <th v-for="v in viewers" :key="v.id" scope="col" class="v">{{ v.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.recipe.id" :class="{ on: row.recipe.id === current }" @click="emit('select', row.recipe.id)">
            <th scope="row">
              <button type="button" :aria-pressed="row.recipe.id === current">{{ row.recipe.title }}</button>
            </th>
            <td><span class="bar" :style="{ width: `${(row.ms / maxMs) * 100}%` }" />{{ row.ms ? seconds(row.ms) : '-' }}</td>
            <td v-if="row.svc" colspan="2" class="muted">서버가 요청마다 생성</td>
            <template v-else>
              <td><span class="bar" :style="{ width: `${(row.bytes / maxBytes) * 100}%` }" />{{ row.bytes ? bytes(row.bytes) : '-' }}</td>
              <td>{{ row.files ? row.files.toLocaleString() : '-' }}</td>
            </template>
            <td v-for="v in viewers" :key="v.id" class="v" :class="`lv-${row.level[v.id]}`" :title="hint(row.recipe.viewers[v.id])">
              {{ supportLabels[row.level[v.id]!] }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small muted">
      직접 처리: 원본과 같은 형식을 그대로 읽음. 변환 후 처리: 바꾼 결과물을 읽음. 일부 기능만: 그리지만 빠지는 기능 있음(위 "뷰어별 처리"). 미검증: 성공한 실행 기록 없음.
    </p>
    <p v-if="env" class="small muted">
      측정 조건: 레시피당 1회 실행, 도구 이미지 받아 둔 상태, 서버 기동 시간 제외. 걸린 시간 = 단계 컨테이너 실행 시간 합.
      {{ env.cpu }}, Docker {{ env.docker }} ({{ env.cores }}코어·메모리 {{ env.memGB }}GB), {{ env.os }}.
    </p>
  </section>
</template>

<style scoped>
.compare { padding-top: 40px; }
.compare h2 { font-size: var(--fs-3); }
.scroll { overflow-x: auto; margin-top: 14px; }
table { width: 100%; border-collapse: collapse; min-width: 640px; font-size: var(--fs-0); }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--rule); white-space: nowrap; }
thead th { color: var(--ink-2); font-weight: 500; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: var(--surface); }
tbody tr.on { background: var(--surface); box-shadow: inset 3px 0 0 var(--ink); }
th button { font: inherit; font-weight: 600; border: 0; background: none; padding: 0; cursor: pointer; color: var(--ink); }
td { position: relative; min-width: 110px; }
.bar { display: block; height: 4px; border-radius: 2px; background: var(--ink-2); opacity: 0.35; margin-bottom: 4px; }
.v { text-align: center; min-width: 0; }
.compare > p + p { margin-top: 4px; }
</style>
