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

/** MapLibre 뷰어와 Deck.gl 뷰어가 같이 쓰는 배경지도 + 카메라 연결 */
export function createBaseMap(container: HTMLElement, tiles: { url: string; minzoom: number; maxzoom: number; attribution: string }, c: Camera) {
  return new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: { base: { type: 'raster', tiles: [tiles.url], tileSize: 256, minzoom: tiles.minzoom, maxzoom: tiles.maxzoom, attribution: tiles.attribution } },
      layers: [{ id: 'base', type: 'raster', source: 'base', paint: { 'raster-saturation': -0.75 } }],
    },
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

export const setBaseTiles = (map: maplibregl.Map, url: string) =>
  (map.getSource('base') as maplibregl.RasterTileSource | undefined)?.setTiles([url])
