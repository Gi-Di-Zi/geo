import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Protocol } from 'pmtiles'
import type { Camera } from '~/composables/useCamera'

// MapLibre 6은 워커 경로를 자기 파일 기준으로 계산하는데, 번들러가 파일을 옮기면 어긋나서 직접 알려 준다
maplibregl.setWorkerUrl(workerUrl)
// pmtiles://… 주소를 Range 요청으로 읽게 한다
maplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile)

/** 지형 높이를 과장하는 배율. MapLibre, Deck.gl, Cesium이 같은 값을 써서 나란히 비교한다 */
export const EXAGGERATION = 1.5

type BaseTiles = { url: string; minzoom: number; maxzoom: number; attribution: string }
const baseSource = (t: BaseTiles): maplibregl.RasterSourceSpecification =>
  ({ type: 'raster', tiles: [t.url], tileSize: 256, minzoom: t.minzoom, maxzoom: t.maxzoom, attribution: t.attribution })
const baseLayer = (): maplibregl.RasterLayerSpecification => ({ id: 'base', type: 'raster', source: 'base', paint: { 'raster-saturation': -0.75 } })

/** MapLibre 뷰어와 Deck.gl 뷰어가 같이 쓰는 배경지도 + 카메라 연결 */
export function createBaseMap(container: HTMLElement, tiles: BaseTiles, c: Camera) {
  return new maplibregl.Map({
    container,
    style: { version: 8, sources: { base: baseSource(tiles) }, layers: [baseLayer()] },
    center: [c.lon, c.lat],
    zoom: c.zoom,
    bearing: c.bearing,
    pitch: c.pitch,
    // 높이를 정한 시점만 바라보는 지점을 그 높이에 고정. 아니면 MapLibre 기본(지형 표면에 붙임)
    // (높이 0을 넘기면 지형이 있을 때 매 프레임 표면으로 되돌리느라 지도가 멈추지 않는다)
    ...(c.height ? { elevation: c.height, centerClampedToGround: false } : {}),
    maxPitch: 85,
    attributionControl: { compact: true },
  })
}

export const cameraOf = (map: maplibregl.Map) => {
  const c = map.getCenter()
  return { lon: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
}

export const jumpTo = (map: maplibregl.Map, c: Camera) =>
  map.jumpTo({ center: [c.lon, c.lat], zoom: c.zoom, bearing: c.bearing, pitch: c.pitch, ...(c.height ? { elevation: c.height } : {}) })

/** 배경지도 바꾸기. 주소만 바꾸면(setTiles) 출처 표기·줌 범위(VWorld 6~, OSM 0~)가 처음 것으로 남아 소스째 바꾸고 맨 아래에 다시 넣는다.
 *  맨 아래 = getLayersOrder()[0] (getStyle().layers에는 Deck.gl 사용자 레이어가 빠져 배경이 데이터를 덮는다) */
export function setBaseTiles(map: maplibregl.Map, t: BaseTiles) {
  map.removeLayer('base')
  map.removeSource('base')
  map.addSource('base', baseSource(t))
  map.addLayer(baseLayer(), map.getLayersOrder()[0])
}
