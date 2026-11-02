<script setup lang="ts">
import type { Output, ViewerUse } from '#shared/types'
import { kindLabels } from '#shared/viewers'
import type { Picked } from '~/utils/pick'

/** selecting = 지도 도구의 "선택"이 켜져 있음 → 누른 피처·모델·레이어 정보를 띄운다 */
const props = defineProps<{
  meta: { id: string; name: string; dims: string }
  use: ViewerUse
  output?: Output
  path?: string
  color: string
  elsewhere: string[]
  active: boolean
  selecting: boolean
}>()

const comps: Record<string, any> = {
  ol: resolveComponent('LazyViewersViewerOl'),
  maplibre: resolveComponent('LazyViewersViewerMaplibre'),
  deck: resolveComponent('LazyViewersViewerDeck'),
  cesium: resolveComponent('LazyViewersViewerCesium'),
}

const url = computed(() => (props.path && import.meta.client ? location.origin + props.path : ''))
const picked = ref<Picked | null>(null)
const error = ref('')
onErrorCaptured(e => { error.value = (e as Error).message; return false })

// 선택을 끄면 정보 상자도 닫는다
watch(() => props.selecting, on => { if (!on) picked.value = null })

const hitLabels = { feature: '피처', model: '모델·타일셋', layer: '레이어' }

/** 레이어(결과물) 정보: 모델·래스터·지형처럼 피처 속성이 없는 것을 눌렀을 때 */
const layerInfo = computed(() => {
  const o = props.output
  const rows: [string, string][] = []

  if (!o) return rows
  rows.push(['결과물', `${o.label} · ${kindLabels[o.kind]}`], ['경로', o.path])

  if (o.layer) rows.push(['레이어 이름', o.layer])

  if (o.anchor) rows.push(['놓은 위치', `${o.anchor.join(', ')} (경도, 위도, 높이)`])

  if (o.bounds) rows.push(['범위', o.bounds.map(v => v.toFixed(4)).join(', ')])

  if (o.minzoom !== undefined || o.maxzoom !== undefined) rows.push(['줌', `${o.minzoom ?? '-'} ~ ${o.maxzoom ?? '-'}`])

  return rows
})
</script>

<template>
  <figure class="tile" :class="{ selecting }">
    <template v-if="output && 'output' in use">
      <p v-if="error" class="error small">불러오기 실패: {{ error }}</p>
      <component :is="comps[meta.id]" v-else-if="active && url" :output :url :color @pick="picked = selecting ? $event : null" />
      <div v-if="picked" class="pick card small" role="dialog" aria-label="선택한 정보">
        <button class="close" aria-label="선택 정보 닫기" @click="picked = null">×</button>
        <p class="head"><strong>{{ picked.hit ? hitLabels[picked.hit] : '선택 없음' }}</strong> <span class="muted">· {{ output.label }}</span></p>
        <p v-if="picked.at" class="muted">
          경도 {{ picked.at[0]?.toFixed(6) }} · 위도 {{ picked.at[1]?.toFixed(6) }}<template v-if="picked.at[2] !== undefined"> · 높이 {{ picked.at[2].toFixed(1) }}m</template>
        </p>
        <dl v-if="picked.props">
          <template v-for="(v, k) in picked.props" :key="k">
            <dt>{{ k }}</dt><dd>{{ v }}</dd>
          </template>
        </dl>
        <p v-else-if="!picked.hit" class="muted">이 위치에 선택할 객체 없음</p>
        <dl v-if="picked.hit && picked.hit !== 'feature'" class="meta">
          <template v-for="[k, v] in layerInfo" :key="k">
            <dt>{{ k }}</dt><dd>{{ v }}</dd>
          </template>
        </dl>
        <p v-if="picked.hit === 'model'" class="muted">속성 정보 없는 모델·타일 — 결과물 정보만</p>
      </div>
    </template>
    <div v-else class="hatch none">
      <p><strong>표시 불가</strong></p>
      <p>{{ 'unsupported' in use ? use.unsupported : '' }}</p>
      <p v-if="elsewhere.length" class="muted small">{{ elsewhere.join(", ") }}에서 확인 가능</p>
    </div>
  </figure>
</template>

<style scoped>
.tile { position: relative; margin: 0; min-height: 0; min-width: 0; overflow: hidden; background: var(--surface); }
/* 선택 중: 지도 위 십자 커서 (뷰어마다 캔버스에 커서를 따로 정해 두어 덮어쓴다) */
.selecting :deep(canvas) { cursor: crosshair !important; }
.card { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; box-shadow: 0 4px 16px rgb(22 32 42 / 0.16); }
.none { position: absolute; inset: 0; display: grid; place-content: center; gap: 4px; text-align: center; padding: 24px; }
.none p { max-width: 28rem; background: var(--stage); padding: 0 6px; justify-self: center; }
.pick {
  position: absolute; left: 10px; bottom: 10px; z-index: 4; max-width: min(340px, 80%); max-height: 55%; overflow: auto;
  padding: 8px 28px 8px 10px; display: grid; gap: 4px;
}
.pick p { margin: 0; }
.pick dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0 10px; }
.pick dt { color: var(--ink-2); }
.pick dd { margin: 0; overflow-wrap: anywhere; }
.pick .meta { padding-top: 4px; border-top: 1px dashed var(--rule); }
.close { position: absolute; top: 2px; right: 4px; border: 0; background: none; font-size: 18px; cursor: pointer; color: var(--ink-2); }
.error { padding: 16px; color: #A3262E; }
</style>
