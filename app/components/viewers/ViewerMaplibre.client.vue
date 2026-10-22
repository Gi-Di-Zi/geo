<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css'
import type * as maplibregl from 'maplibre-gl'
import type { Output } from '#shared/types'

const props = defineProps<{ output: Output; url: string; color: string }>()
const emit = defineEmits<{ ready: []; pick: [Record<string, unknown> | null] }>()
const el = ref<HTMLDivElement>()
const { tiles } = useBasemap()
const { camera, follow } = useCamera()
let map: maplibregl.Map | undefined

const isPoly = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]] as any
const isPoint = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]] as any

/** 벡터 레이어 세 개(면·선·점)를 올리고 그 id를 돌려준다 */
function addVector(m: maplibregl.Map, src: object, suffix = ''): string[] {
  const c = props.color
  const h = props.output.style?.height
  const ids = ['fill', 'line', 'point'].map(k => k + suffix)
  m.addLayer(h
    ? { id: ids[0], type: 'fill-extrusion', source: 'data', ...src, filter: isPoly, paint: { 'fill-extrusion-color': c, 'fill-extrusion-height': ['to-number', ['get', h]], 'fill-extrusion-opacity': 0.85 } } as any
    : { id: ids[0], type: 'fill', source: 'data', ...src, filter: isPoly, paint: { 'fill-color': c, 'fill-opacity': 0.12 } } as any)
  m.addLayer({ id: ids[1], type: 'line', source: 'data', ...src, paint: { 'line-color': c, 'line-width': h ? 0.5 : 2 } } as any)
  m.addLayer({ id: ids[2], type: 'circle', source: 'data', ...src, filter: isPoint, paint: { 'circle-color': c, 'circle-radius': 4 } } as any)
  return ids
}

/** 데이터 레이어를 올리고, 클릭으로 속성을 볼 레이어 id를 돌려준다 (나중에 채워질 수 있다) */
function addData(m: maplibregl.Map): string[] {
  const o = props.output
  const url = props.url
  // 없는 값은 넘기지 않는다 (maxzoom: undefined가 기본값 22를 덮어쓰면 타일 계산이 멈춘다. 줌 제한 없는 서버 타일)
  const range = Object.fromEntries(Object.entries({ minzoom: o.minzoom, maxzoom: o.maxzoom, bounds: o.bounds }).filter(([, v]) => v !== undefined))
  switch (o.kind) {
    case 'geojson':
      m.addSource('data', { type: 'geojson', data: url })
      break
    case 'mvt':
      m.addSource('data', { type: 'vector', tiles: [url], ...range })
      break
    case 'pmtiles':
      m.addSource('data', { type: 'vector', url: `pmtiles://${url}` })
      break
    case 'xyz-raster':
      m.addSource('data', { type: 'raster', tiles: [url], tileSize: 256, ...range })
      m.addLayer({ id: 'raster', type: 'raster', source: 'data' })
      return []
    case 'image': {
      const [w, s, e, n] = o.bounds!
      m.addSource('data', { type: 'image', url, coordinates: [[w, n], [e, n], [e, s], [w, s]] })
      m.addLayer({ id: 'raster', type: 'raster', source: 'data' })
      return []
    }
    case 'terrain-rgb':
      m.addSource('dem', { type: 'raster-dem', tiles: [url], tileSize: 256, encoding: 'mapbox', ...range })
      m.setTerrain({ source: 'dem', exaggeration: EXAGGERATION })
      m.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-shadow-color': '#3B3022', 'hillshade-exaggeration': 0.4 } })
      return []
    default:
      throw new Error(`MapLibre 뷰어에 없는 출력 종류: ${o.kind}`)
  }
  if (o.kind === 'geojson') return addVector(m, {})
  if (o.layer) return addVector(m, { 'source-layer': o.layer })
  // 레이어 이름을 모르는 벡터타일(올린 PMTiles)은 파일 안 목록(vector_layers)의 레이어를 모두 그린다
  const ids: string[] = []
  const onData = (e: maplibregl.MapSourceDataEvent) => {
    const layers = (m.getSource('data') as maplibregl.Source | undefined)?.vectorLayerIds
    if (e.sourceId !== 'data' || !layers) return
    m.off('sourcedata', onData)
    for (const l of layers) ids.push(...addVector(m, { 'source-layer': l }, `-${l}`))
  }
  m.on('sourcedata', onData)
  return ids
}

const { emit: emitCamera, watchInput } = follow('maplibre', c => map && jumpTo(map, c))

onMounted(() => {
  const m = map = createBaseMap(el.value!, tiles.value, camera.value)
  m.on('load', () => {
    const pickable = addData(m)
    m.once('idle', () => emit('ready'))
    if (props.output.kind !== 'xyz-raster' && props.output.kind !== 'image' && props.output.kind !== 'terrain-rgb') {
      m.on('click', e => {
        const f = m.queryRenderedFeatures(e.point, { layers: pickable })[0]
        emit('pick', f ? { ...f.properties } : null)
      })
    }
  })
  watchInput(el.value!)
  m.on('moveend', () => emitCamera(cameraOf(m)))
  watch(tiles, t => setBaseTiles(m, t.url))
})

onBeforeUnmount(() => map?.remove())
</script>

<template>
  <div ref="el" class="map" role="img" aria-label="MapLibre 지도" />
</template>

<style scoped>
.map { position: absolute; inset: 0; }
</style>
