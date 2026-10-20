<script setup lang="ts">
import type { Output, ViewerUse } from '#shared/types'

const props = defineProps<{
  meta: { id: string; name: string; dims: string }
  use: ViewerUse
  output?: Output
  path?: string
  color: string
  elsewhere: string[]
  active: boolean
}>()

const comps: Record<string, any> = {
  ol: resolveComponent('LazyViewersViewerOl'),
  maplibre: resolveComponent('LazyViewersViewerMaplibre'),
  deck: resolveComponent('LazyViewersViewerDeck'),
  cesium: resolveComponent('LazyViewersViewerCesium'),
}

const url = computed(() => (props.path && import.meta.client ? location.origin + props.path : ''))
const picked = ref<Record<string, unknown> | null>(null)
const error = ref('')
onErrorCaptured(e => { error.value = (e as Error).message; return false })
</script>

<template>
  <figure class="tile">
    <template v-if="output && 'output' in use">
      <p v-if="error" class="error small">불러오기 실패: {{ error }}</p>
      <component :is="comps[meta.id]" v-else-if="active && url" :output :url :color @pick="picked = $event" />
      <div v-if="picked" class="pick card small">
        <button class="close" aria-label="속성 닫기" @click="picked = null">×</button>
        <dl>
          <template v-for="(v, k) in picked" :key="k">
            <dt>{{ k }}</dt><dd>{{ v }}</dd>
          </template>
        </dl>
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
.card { background: var(--surface); border: 1px solid var(--rule); border-radius: 10px; box-shadow: 0 4px 16px rgb(22 32 42 / 0.16); }
.none { position: absolute; inset: 0; display: grid; place-content: center; gap: 4px; text-align: center; padding: 24px; }
.none p { max-width: 28rem; background: var(--stage); padding: 0 6px; justify-self: center; }
.pick {
  position: absolute; left: 10px; bottom: 10px; z-index: 4; max-width: min(320px, 80%); max-height: 50%; overflow: auto;
  padding: 8px 28px 8px 10px;
}
.pick dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0 10px; }
.pick dt { color: var(--ink-2); }
.pick dd { margin: 0; }
.close { position: absolute; top: 2px; right: 4px; border: 0; background: none; font-size: 18px; cursor: pointer; color: var(--ink-2); }
.error { padding: 16px; color: #A3262E; }
</style>
