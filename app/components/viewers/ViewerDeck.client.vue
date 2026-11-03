<script lang="ts">
import { Tile3DLayer } from '@deck.gl/geo-layers'

// deck.gl 9.4.0 Tile3DLayer: 타일셋 JSON이 첫 화면보다 늦게 오면 이미 비운 activeViewports로 타일을 고르고 끝나, 지도를 움직이기 전까지 타일을 안 받는다 → 비었으면 마지막 뷰포트로
const tile3dProto = Tile3DLayer.prototype as any
const updateTileset = tile3dProto._updateTileset
tile3dProto._updateTileset = function (v: any) { updateTileset.call(this, Object.keys(v ?? {}).length ? v : this.state.lastUpdatedViewports) }
</script>

<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css'
import type * as maplibregl from 'maplibre-gl'
import { MapLibreOverlay } from '@deck.gl/maplibre'
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers'
import { MVTLayer, TerrainLayer, TileLayer } from '@deck.gl/geo-layers'
import { ScenegraphLayer } from '@deck.gl/mesh-layers'
import { Tiles3DLoader } from '@loaders.gl/3d-tiles'
import { parse } from '@loaders.gl/core'
import { MVTLoader } from '@loaders.gl/mvt'
import { PMTiles } from 'pmtiles'
import type { Output } from '#shared/types'
import type { Picked } from '~/utils/pick'

const props = defineProps<{ output: Output; url: string; color: string }>()
const emit = defineEmits<{ ready: []; pick: [Picked] }>()
const el = ref<HTMLDivElement>()
const { tiles } = useBasemap()
const { camera, follow } = useCamera()
let map: maplibregl.Map | undefined
const ready = () => emit('ready')

function dataLayer() {
  const o = props.output
  const url = props.url
  const [r, g, b] = rgbOf(props.color)
  const h = o.style?.height
  const vector = {
    id: 'data',
    pickable: true,
    filled: true,
    stroked: true,
    // 면은 옅게, 점은 꽉 채운다 (OpenLayers·MapLibre와 같은 모양)
    getFillColor: (f: any) => [r, g, b, h || /Point/.test(f.geometry?.type ?? '') ? 220 : 30] as [number, number, number, number],
    getLineColor: [r, g, b, 255] as [number, number, number, number],
    lineWidthMinPixels: h ? 0.5 : 2,
    pointRadiusMinPixels: 4,
    extruded: !!h,
    getElevation: (f: any) => (h ? Number(f.properties?.[h]) || 0 : 0),
  }
  const range = { minZoom: o.minzoom, maxZoom: o.maxzoom, ...(o.bounds && { extent: o.bounds }) }
  // GDAL MVT 폴더는 빈 칸 타일을 만들지 않는다 → 404는 빈 타일로 넘긴다 (deck 기본 처리는 매번 console.error)
  const onTileError = (e: unknown) => { if (!(e instanceof Error && 'response' in e && e.response instanceof Response && e.response.status === 404)) console.error(e) }
  switch (o.kind) {
    case 'geojson':
      return new GeoJsonLayer({ ...vector, data: url, onDataLoad: ready })
    case 'mvt':
      // binary: false — 피처를 GeoJSON 객체로 받아야 점/면에 따라 채움을 다르게 줄 수 있다 (샘플 타일은 작아서 성능 차이가 없다)
      return new MVTLayer({ ...vector, data: url, ...range, binary: false, onViewportLoad: ready, onTileError, loadOptions: o.layer ? { mvt: { layers: [o.layer] } } : undefined })
    case 'pmtiles': {
      // MVTLayer는 z/x/y 주소로 타일을 받는다. 가짜 주소를 주고, 받아오는 fetch만 PMTiles 아카이브(Range 요청)로 바꿔 끼운다
      const archive = new PMTiles(url)
      return new MVTLayer({
        ...vector, data: 'pmtiles://{z}/{x}/{y}', ...range, binary: false, onViewportLoad: ready,
        loadOptions: o.layer ? { mvt: { layers: [o.layer] } } : undefined,
        fetch: async (u: string, { loadOptions, signal }: any) => {
          const [z, x, y] = u.slice('pmtiles://'.length).split('/').map(Number)
          const tile = await archive.getZxy(z!, x!, y!, signal)
          return tile ? parse(tile.data, MVTLoader, loadOptions) : null
        },
      } as any)
    }
    case 'xyz-raster':
      return new TileLayer({
        id: 'data', data: url, tileSize: 256, ...range, onViewportLoad: ready,
        renderSubLayers: (p: any) => {
          const { west, south, east, north } = p.tile.bbox
          return new BitmapLayer(p, { data: undefined, image: p.data, bounds: [west, south, east, north] })
        },
      })
    case 'image':
      return new BitmapLayer({ id: 'data', image: url, bounds: o.bounds! })
    case 'terrain-rgb':
      return new TerrainLayer({
        // 지형은 시점에 따라 화면 밖 먼 타일까지 기다리느라 onViewportLoad가 오지 않을 때가 있어, 첫 타일이 그려지면 표시로 본다
        id: 'data', elevationData: url, texture: tiles.value.url, ...range, onViewportLoad: ready, onTileLoad: ready,
        elevationDecoder: { rScaler: 6553.6 * EXAGGERATION, gScaler: 25.6 * EXAGGERATION, bScaler: 0.1 * EXAGGERATION, offset: -10000 * EXAGGERATION },
      })
    case '3dtiles':
      // 뷰어 타일이 작아(높이 ~300px) 기본 기준(8px)이면 거친 단계에서 멈춘다. 양자화된 점 좌표(16비트)는 풀어서 넘긴다
      return new Tile3DLayer({ id: 'data', pickable: true, data: url, loader: Tiles3DLoader, pointSize: 2, onTilesetLoad: ready, loadOptions: { tileset: { maximumScreenSpaceError: 2 }, '3d-tiles': { decodeQuantizedPositions: true } } } as any)
    case 'glb':
      // instances가 있으면 점마다 같은 모델을 세운다(Deck.gl 방식의 인스턴싱). glTF는 Y가 위라 X축으로 90° 세운다
      return new ScenegraphLayer({
        id: 'data', pickable: true, scenegraph: url, sizeScale: 1, _lighting: 'pbr',
        data: o.instances ? fetch(url.replace(o.path, o.instances)).then(r => r.json()).then(fc => fc.features) : [{ geometry: { coordinates: o.anchor } }],
        getPosition: (f: any) => f.geometry.coordinates,
        getOrientation: (f: any) => [0, -(f.properties?.heading ?? 0), 90],
        getScale: (f: any) => { const s = f.properties?.scale ?? 1; return [s, s, s] },
      } as any)
    default:
      throw new Error(`Deck.gl 뷰어에 없는 출력 종류: ${o.kind}`)
  }
}

const { emit: emitCamera, watchInput } = follow('deck', c => map && jumpTo(map, c))

onMounted(() => {
  const m = map = createBaseMap(el.value!, tiles.value, camera.value)
  m.on('load', () => {
    // 선택: 레이어가 아니라 Deck 전체의 클릭으로 받는다 → 아무것도 안 맞힌 곳(래스터·지형·빈 곳)도 위치와 함께. 모델·3D Tiles는 속성이 없으면 모델 선택
    const overlay = new MapLibreOverlay({
      interleaved: true, layers: [dataLayer()],
      onClick: (info: any) => {
        const attrs = info.object?.properties ?? null

        emit('pick', pickOf(props.output, attrs, !!info.picked && !attrs && ['3dtiles', 'glb'].includes(props.output.kind), info.coordinate ?? null))
      },
    })
    m.addControl(overlay as any)
    // 타일·데이터 로드 콜백이 없는 레이어(이미지, 모델)는 지도가 한숨 돌릴 때를 표시 시점으로 본다
    if (['image', 'glb'].includes(props.output.kind)) m.once('idle', ready)
  })
  watchInput(el.value!)
  m.on('moveend', () => emitCamera(cameraOf(m)))
  watch(tiles, t => setBaseTiles(m, t))
})

onBeforeUnmount(() => map?.remove())
</script>

<template>
  <div ref="el" class="map" role="img" aria-label="MapLibre + Deck.gl 지도" />
</template>

<style scoped>
.map { position: absolute; inset: 0; }
</style>
