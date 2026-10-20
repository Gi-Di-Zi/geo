<script setup lang="ts">
import { viewers } from '#shared/viewers'
import type { FormatSpec, Report } from '#shared/types'

const props = defineProps<{ spec: FormatSpec; current: string }>()
const emit = defineEmits<{ select: [id: string] }>()
const dir = `${useRuntimeConfig().app.baseURL}data/${props.spec.category}/${props.spec.id}`

const { data: reports } = useAsyncData(`compare-${props.spec.category}-${props.spec.id}`, () =>
  Promise.all(props.spec.recipes.map(r => $fetch<Report>(`${dir}/${r.id}/report.json`).catch(() => null))), { server: false, default: () => [] })

const rows = computed(() => props.spec.recipes.map((r, i) => {
  const rep = reports.value[i]
  return {
    recipe: r,
    ms: rep?.totalMs ?? 0,
    bytes: rep?.outputs.reduce((a, o) => a + o.bytes, 0) ?? 0,
    files: rep?.outputs.reduce((a, o) => a + o.files, 0) ?? 0,
  }
}))
const maxMs = computed(() => Math.max(1, ...rows.value.map(r => r.ms)))
const maxBytes = computed(() => Math.max(1, ...rows.value.map(r => r.bytes)))
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
            <td><span class="bar" :style="{ width: `${(row.bytes / maxBytes) * 100}%` }" />{{ row.bytes ? bytes(row.bytes) : '-' }}</td>
            <td>{{ row.files ? row.files.toLocaleString() : '-' }}</td>
            <td v-for="v in viewers" :key="v.id" class="v">
              <span v-if="'output' in row.recipe.viewers[v.id]" class="ok" :title="(row.recipe.viewers[v.id] as any).caution">
                ✓<span v-if="(row.recipe.viewers[v.id] as any).caution" class="warn">*</span>
              </span>
              <span v-else class="no" :title="(row.recipe.viewers[v.id] as any).unsupported">✗</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="small muted">*: 표시 가능하나 주의점 있음 — 위 "뷰어별 처리" 참고.</p>
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
.warn { color: #9A5B00; }
</style>
