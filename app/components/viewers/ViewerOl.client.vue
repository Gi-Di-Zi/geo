<script setup lang="ts">
import 'ol/ol.css'
import Map from 'ol/Map'
import View from 'ol/View'
import { defaults as defaultControls } from 'ol/control'
import ImageLayer from 'ol/layer/Image'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import VectorTileLayer from 'ol/layer/VectorTile'
import WebGLTileLayer from 'ol/layer/WebGLTile'
import GeoTIFF from 'ol/source/GeoTIFF'
import ImageStatic from 'ol/source/ImageStatic'
import ImageWMS from 'ol/source/ImageWMS'
import VectorSource from 'ol/source/Vector'
import VectorTileSource from 'ol/source/VectorTile'
import XYZ from 'ol/source/XYZ'
import GeoJSON from 'ol/format/GeoJSON'
import MVT from 'ol/format/MVT'
import { Circle, Fill, Stroke, Style } from 'ol/style'
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj'
import { PMTilesVectorSource } from 'ol-pmtiles'
import type { Output } from '#shared/types'

const props = defineProps<{ output: Output; url: string; color: string }>()
const emit = defineEmits<{ ready: []; pick: [Record<string, unknown> | null] }>()
const el = ref<HTMLDivElement>()
const { tiles } = useBasemap()
const { camera, follow } = useCamera()
let map: Map | undefined

const deg = Math.PI / 180
const style = new Style({
  fill: new Fill({ color: rgba(props.color, 0.12) }),
  stroke: new Stroke({ color: props.color, width: 2 }),
  image: new Circle({ radius: 4, fill: new Fill({ color: props.color }) }),
})

function dataLayer() {
  const o = props.output
  const url = props.url
  const mvt = () => new MVT({ layers: o.layer ? [o.layer] : undefined })
  switch (o.kind) {
    case 'geojson':
      return new VectorLayer({ source: new VectorSource({ url, format: new GeoJSON() }), style })
    case 'mvt':
      return new VectorTileLayer({ source: new VectorTileSource({ url, format: mvt(), minZoom: o.minzoom, maxZoom: o.maxzoom }), style })
    case 'pmtiles':
      return new VectorTileLayer({ source: new PMTilesVectorSource({ url, format: mvt() } as any), style })
    case 'cog':
      return new WebGLTileLayer({ source: new GeoTIFF({ sources: [{ url }] }) })
    case 'xyz-raster':
      return new TileLayer({ source: new XYZ({ url, minZoom: o.minzoom, maxZoom: o.maxzoom, crossOrigin: 'anonymous' }) })
    case 'image':
      return new ImageLayer({ source: new ImageStatic({ url, imageExtent: transformExtent(o.bounds!, 'EPSG:4326', 'EPSG:3857') }) })
    case 'wms':
      // 지도를 움직일 때마다 화면 범위 그림 한 장을 서버에 요청한다
      return new ImageLayer({
        extent: o.bounds && transformExtent(o.bounds, 'EPSG:4326', 'EPSG:3857'),
        source: new ImageWMS({ url, params: { LAYERS: o.layer, TRANSPARENT: true }, crossOrigin: 'anonymous' }),
      })
    default:
      throw new Error(`OpenLayers 뷰어에 없는 출력 종류: ${o.kind}`)
  }
}

const { emit: emitCamera, watchInput } = follow('ol', c => {
  const v = map?.getView()
  if (!v) return
  v.setCenter(fromLonLat([c.lon, c.lat]))
  v.setZoom(c.zoom + 1)
  v.setRotation(-c.bearing * deg)
})

onMounted(() => {
  const c = camera.value
  const base = new XYZ({ url: tiles.value.url, maxZoom: tiles.value.maxzoom, attributions: tiles.value.attribution, crossOrigin: 'anonymous' })
  map = new Map({
    target: el.value,
    // 확대·축소는 화면 오른쪽의 공통 지도 도구로 한다
    controls: defaultControls({ zoom: false }),
    layers: [new TileLayer({ source: base, className: 'ol-base' }), dataLayer()],
    view: new View({ center: fromLonLat([c.lon, c.lat]), zoom: c.zoom + 1, rotation: -c.bearing * deg }),
  })
  watchInput(el.value!)
  map.once('rendercomplete', () => emit('ready'))
  map.on('moveend', () => {
    const v = map!.getView()
    const [lon, lat] = toLonLat(v.getCenter()!)
    emitCamera({ lon, lat, zoom: v.getZoom()! - 1, bearing: -v.getRotation() / deg, pitch: camera.value.pitch })
  })
  map.on('singleclick', e => {
    const f = map!.forEachFeatureAtPixel(e.pixel, f => f)
    const { geometry, ...rest } = (f?.getProperties() ?? {}) as Record<string, unknown>
    emit('pick', f ? rest : null)
  })
  watch(tiles, t => base.setUrl(t.url))
})

onBeforeUnmount(() => map?.setTarget(undefined))
</script>

<template>
  <div ref="el" class="map" role="img" aria-label="OpenLayers 지도" />
</template>

<style scoped>
.map { position: absolute; inset: 0; }
.map :deep(.ol-base) { filter: saturate(0.25); }
</style>
