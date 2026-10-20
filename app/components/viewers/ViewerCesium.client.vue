<script setup lang="ts">
import type { Output } from '#shared/types'

const props = defineProps<{ output: Output; url: string; color: string }>()
const emit = defineEmits<{ ready: []; pick: [Record<string, unknown> | null] }>()
const el = ref<HTMLDivElement>()
const { tiles } = useBasemap()
const { camera, follow } = useCamera()
const deg = Math.PI / 180
let viewer: any
let C: typeof import('cesium')

function baseProvider(t: typeof tiles.value) {
  const vworld = t.url.includes('vworld')
  return new C.UrlTemplateImageryProvider({
    url: t.url,
    maximumLevel: t.maxzoom,
    minimumLevel: vworld ? t.minzoom : 0,
    rectangle: vworld ? C.Rectangle.fromDegrees(124, 33, 132, 39) : undefined,
    credit: t.attribution,
  })
}

/** 데이터를 올리고, 처음 다 그려졌을 때 resolve되는 Promise를 돌려준다 */
async function addData(): Promise<unknown> {
  const o = props.output
  const url = props.url
  const color = C.Color.fromCssColorString(props.color)
  const rect = o.bounds && C.Rectangle.fromDegrees(...o.bounds)
  switch (o.kind) {
    case 'geojson': {
      const ds = await C.GeoJsonDataSource.load(url, { stroke: color, fill: color.withAlpha(0.12), strokeWidth: 2, markerColor: color })
      // 점은 기본 핀(billboard) 대신 다른 뷰어처럼 작은 원으로 그린다
      for (const e of ds.entities.values) {
        if (e.billboard) {
          e.billboard = undefined
          e.point = new C.PointGraphics({ pixelSize: 7, color, outlineColor: C.Color.WHITE, outlineWidth: 1 })
        }
      }
      const h = o.style?.height
      if (h) {
        for (const e of ds.entities.values) {
          if (e.polygon) e.polygon.extrudedHeight = new C.ConstantProperty(Number(e.properties?.[h]?.getValue()) || 0)
          if (e.polygon) e.polygon.material = new C.ColorMaterialProperty(color.withAlpha(0.85))
        }
      }
      return viewer.dataSources.add(ds)
    }
    case 'xyz-raster':
      viewer.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url, minimumLevel: o.minzoom, maximumLevel: o.maxzoom, rectangle: rect }))
      return
    case 'image':
      viewer.imageryLayers.addImageryProvider(await C.SingleTileImageryProvider.fromUrl(url, { rectangle: rect }))
      return
    case 'wms':
      viewer.imageryLayers.addImageryProvider(new C.WebMapServiceImageryProvider({ url, layers: o.layer!, rectangle: rect, parameters: { transparent: true, format: 'image/png' } }))
      return
    case 'quantized-mesh':
      // 있는 타일은 layer.json의 available로만 판단한다. 일부만 받아 온 타일셋에서 타일 안 metadata(하위 타일 목록)를 읽으면 없는 타일을 찾아 실패한다
      viewer.terrainProvider = await C.CesiumTerrainProvider.fromUrl(url, { requestVertexNormals: true, requestMetadata: false })
      viewer.scene.verticalExaggeration = EXAGGERATION
      viewer.scene.globe.enableLighting = true
      viewer.scene.globe.dynamicAtmosphereLighting = false
      // 음영기복도 관례(북서쪽 45° 높이)로 비추는 고정 조명. 정오 해는 머리 위라 산세가 잘 안 보인다
      {
        const c = camera.value
        const enu = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(c.lon, c.lat))
        const toScene = new C.Cartesian3(0.5, -0.5, -Math.SQRT1_2) // 북서·위에서 남동·아래로
        viewer.scene.light = new C.DirectionalLight({ direction: C.Cartesian3.normalize(C.Matrix4.multiplyByPointAsVector(enu, toScene, new C.Cartesian3()), new C.Cartesian3()), intensity: 3 })
      }
      return
    case '3dtiles': {
      const ts = await C.Cesium3DTileset.fromUrl(url)
      ts.pointCloudShading.attenuation = true
      ts.pointCloudShading.maximumAttenuation = 3
      viewer.scene.primitives.add(ts)
      return new Promise(r => ts.initialTilesLoaded.addEventListener(r))
    }
    case 'glb': {
      const [lon, lat, h] = o.anchor!
      const model = await C.Model.fromGltfAsync({ url, modelMatrix: C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(lon, lat, h)) })
      viewer.scene.primitives.add(model)
      return new Promise(r => model.readyEvent.addEventListener(r))
    }
    default:
      throw new Error(`Cesium 뷰어에 없는 출력 종류: ${o.kind}`)
  }
}

/** 세로 화각. Cesium의 fov(60°)는 화면이 가로로 넓으면 가로 기준이라, 뷰어 생성 직후에도 맞도록 캔버스 비율로 직접 계산한다 */
function fovy() {
  const { clientWidth: w, clientHeight: h } = viewer.canvas
  const fov = viewer.camera.frustum.fov
  return w > h ? 2 * Math.atan(Math.tan(fov / 2) * h / w) : fov
}

function lookAt(c: { lon: number; lat: number; zoom: number; bearing: number; pitch: number; height: number }) {
  const range = zoomToRange(c.zoom, c.lat, viewer.canvas.clientHeight, fovy())
  viewer.camera.lookAt(C.Cartesian3.fromDegrees(c.lon, c.lat, c.height), new C.HeadingPitchRange(c.bearing * deg, (c.pitch - 90) * deg, range))
  viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)
}

/** 바라보는 높이만큼 부풀린 타원체. 화면 가운데가 가리키는 지점을 그 높이에서 찾아야 다른 뷰어와 위치가 맞는다 */
function targetEllipsoid() {
  const h = camera.value.height
  const e = C.Ellipsoid.WGS84
  return h ? new C.Ellipsoid(e.radii.x + h, e.radii.y + h, e.radii.z + h) : e
}

function pickedProps(p: any): Record<string, unknown> | null {
  if (p?.id?.properties) return p.id.properties.getValue(viewer.clock.currentTime)
  if (p instanceof C.Cesium3DTileFeature) return Object.fromEntries(p.getPropertyIds().map((k: string) => [k, p.getProperty(k)]))
  return null
}

const { emit: emitCamera, watchInput } = follow('cesium', c => viewer && lookAt(c))

onMounted(async () => {
  ;(window as any).CESIUM_BASE_URL = `${useRuntimeConfig().app.baseURL}cesium/`
  C = await import('cesium')
  await import('cesium/Build/Cesium/Widgets/widgets.css')
  viewer = new C.Viewer(el.value!, {
    baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
    infoBox: false, selectionIndicator: false, requestRenderMode: true, maximumRenderTimeChange: Infinity,
  })
  // 지형 음영이 늘 보이도록 서울 정오로 시계를 고정한다
  viewer.clock.currentTime = C.JulianDate.fromIso8601('2026-05-31T03:00:00Z')
  viewer.clock.shouldAnimate = false
  // 배경 타일을 한 단계 더 촘촘히 받아 다른 뷰어와 같은 선명도로 맞춘다 (기본 2)
  viewer.scene.globe.maximumScreenSpaceError = 1
  viewer.imageryLayers.addImageryProvider(baseProvider(tiles.value)).saturation = 0.25
  lookAt(camera.value)
  await addData()
  viewer.scene.requestRender()
  viewer.scene.postRender.addEventListener(function once() {
    viewer.scene.postRender.removeEventListener(once)
    emit('ready')
  })

  watchInput(el.value!)
  viewer.camera.moveEnd.addEventListener(() => {
    const canvas = viewer.canvas
    const ellipsoid = targetEllipsoid()
    const center = viewer.camera.pickEllipsoid(new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2), ellipsoid)
    if (!center) return
    const carto = C.Cartographic.fromCartesian(center, ellipsoid)
    const lat = carto.latitude / deg
    const range = C.Cartesian3.distance(viewer.camera.positionWC, center)
    emitCamera({
      lon: carto.longitude / deg, lat,
      zoom: rangeToZoom(range, lat, canvas.clientHeight, fovy()),
      bearing: viewer.camera.heading / deg,
      pitch: Math.min(85, Math.max(0, viewer.camera.pitch / deg + 90)),
    })
  })

  new C.ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction((m: any) => {
    emit('pick', pickedProps(viewer.scene.pick(m.position)))
  }, C.ScreenSpaceEventType.LEFT_CLICK)

  watch(tiles, t => {
    viewer.imageryLayers.remove(viewer.imageryLayers.get(0))
    viewer.imageryLayers.addImageryProvider(baseProvider(t), 0).saturation = 0.25
  })
})

onBeforeUnmount(() => viewer?.destroy())
</script>

<template>
  <div ref="el" class="map" role="img" aria-label="Cesium 3D 지도" />
</template>

<style scoped>
.map { position: absolute; inset: 0; }
/* 왼쪽 아래는 뷰어 이름표 자리라 출처 표시를 오른쪽으로 옮긴다 */
.map :deep(.cesium-viewer-bottom) { font-size: 11px; left: auto; right: 0; }
</style>
