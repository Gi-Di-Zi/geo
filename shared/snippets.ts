// 코드 서랍에 보여 줄 최소 코드. 각 뷰어 컴포넌트(components/viewers)가 실제로 하는 일을 줄인 것이다
import type { Output, OutputKind, ViewerId } from './types.ts'

const j = (v: unknown) => JSON.stringify(v)

function ol(o: Output, url: string) {
  const head = `import Map from 'ol/Map'\nimport View from 'ol/View'\nimport { fromLonLat${o.kind === 'image' ? ', transformExtent' : ''} } from 'ol/proj'\n`
  const layer: Partial<Record<Output['kind'], string>> = {
    geojson: `import VectorLayer from 'ol/layer/Vector'\nimport VectorSource from 'ol/source/Vector'\nimport GeoJSON from 'ol/format/GeoJSON'\n\nconst layer = new VectorLayer({\n  source: new VectorSource({ url: ${j(url)}, format: new GeoJSON() }),\n})`,
    mvt: `import VectorTileLayer from 'ol/layer/VectorTile'\nimport VectorTileSource from 'ol/source/VectorTile'\nimport MVT from 'ol/format/MVT'\n\nconst layer = new VectorTileLayer({\n  source: new VectorTileSource({\n    url: ${j(url)},\n    format: new MVT(${o.layer ? `{ layers: [${j(o.layer)}] }` : ''}),\n    maxZoom: ${o.maxzoom ?? 14}, // 이보다 가까우면 이 줌 타일 확대\n  }),\n})`,
    pmtiles: `import VectorTileLayer from 'ol/layer/VectorTile'\nimport MVT from 'ol/format/MVT'\nimport { PMTilesVectorSource } from 'ol-pmtiles'\n\n// 파일 하나에서 필요한 타일만 Range 요청\nconst layer = new VectorTileLayer({\n  source: new PMTilesVectorSource({ url: ${j(url)}, format: new MVT() }),\n})`,
    cog: `import WebGLTileLayer from 'ol/layer/WebGLTile'\nimport GeoTIFF from 'ol/source/GeoTIFF'\n\n// COG 직접 읽기. 화면에 보이는 블록만 Range 요청\nconst layer = new WebGLTileLayer({\n  source: new GeoTIFF({ sources: [{ url: ${j(url)} }] }),\n})`,
    'xyz-raster': `import TileLayer from 'ol/layer/Tile'\nimport XYZ from 'ol/source/XYZ'\n\nconst layer = new TileLayer({\n  source: new XYZ({ url: ${j(url)}, maxZoom: ${o.maxzoom ?? 18} }),\n})`,
    image: `import ImageLayer from 'ol/layer/Image'\nimport ImageStatic from 'ol/source/ImageStatic'\n\nconst layer = new ImageLayer({\n  source: new ImageStatic({\n    url: ${j(url)},\n    imageExtent: transformExtent(${j(o.bounds)}, 'EPSG:4326', 'EPSG:3857'),\n  }),\n})`,
    wms: `import ImageLayer from 'ol/layer/Image'\nimport ImageWMS from 'ol/source/ImageWMS'\n\n// 지도를 움직일 때마다 화면 범위 그림 한 장 요청 (GetMap)\nconst layer = new ImageLayer({\n  source: new ImageWMS({ url: ${j(url)}, params: { LAYERS: ${j(o.layer)}, TRANSPARENT: true } }),\n})`,
  }
  return `${head}${layer[o.kind]}\n\nnew Map({\n  target: 'map',\n  layers: [basemap, layer],\n  view: new View({ center: fromLonLat([lon, lat]), zoom }),\n})`
}

function maplibre(o: Output, url: string) {
  const src = o.layer ? `, 'source-layer': ${j(o.layer)}` : ''
  const vec = (h = o.style?.height) => h
    ? `map.addLayer({ id: 'buildings', type: 'fill-extrusion', source: 'data'${src},\n    paint: { 'fill-extrusion-height': ['get', ${j(h)}], 'fill-extrusion-color': '#DD7A1F' } })`
    : `map.addLayer({ id: 'fill', type: 'fill', source: 'data'${src}, paint: { 'fill-opacity': 0.12 } })\n  map.addLayer({ id: 'line', type: 'line', source: 'data'${src} })`
  const body: Partial<Record<Output['kind'], string>> = {
    geojson: `map.addSource('data', { type: 'geojson', data: ${j(url)} })\n  ${vec()}`,
    mvt: `map.addSource('data', { type: 'vector', tiles: [${j(url)}], maxzoom: ${o.maxzoom ?? 14} })\n  ${vec()}`,
    pmtiles: `map.addSource('data', { type: 'vector', url: ${j(`pmtiles://${url}`)} })\n  ${o.layer ? vec() : '// 레이어 이름: 파일 안 목록(vector_layers)에서 읽어 레이어마다 addLayer'}`,
    'xyz-raster': `map.addSource('data', { type: 'raster', tiles: [${j(url)}], tileSize: 256 })\n  map.addLayer({ id: 'raster', type: 'raster', source: 'data' })`,
    image: `const [w, s, e, n] = ${j(o.bounds)}\n  map.addSource('data', { type: 'image', url: ${j(url)}, coordinates: [[w, n], [e, n], [e, s], [w, s]] })\n  map.addLayer({ id: 'raster', type: 'raster', source: 'data' })`,
    'terrain-rgb': `// 높이를 RGB로 담은 타일 → 지형 (높이 = -10000 + (R×65536 + G×256 + B) × 0.1)\n  map.addSource('dem', { type: 'raster-dem', tiles: [${j(url)}], encoding: 'mapbox', tileSize: 256 })\n  map.setTerrain({ source: 'dem', exaggeration: 1.5 })\n  map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem' })`,
  }
  return `import maplibregl from 'maplibre-gl'\n${o.kind === 'pmtiles' ? "import { Protocol } from 'pmtiles'\n\nmaplibregl.addProtocol('pmtiles', new Protocol({ metadata: true }).tile)\n" : ''}\nconst map = new maplibregl.Map({ container: 'map', style: baseStyle /* 배경지도 */, center: [lon, lat], zoom })\nmap.on('load', () => {\n  ${body[o.kind]}\n})`
}

function deck(o: Output, url: string) {
  const h = o.style?.height
  const layer: Partial<Record<Output['kind'], string>> = {
    geojson: `import { GeoJsonLayer } from '@deck.gl/layers'\n\nconst layer = new GeoJsonLayer({\n  id: 'data', data: ${j(url)}, filled: true, stroked: true,${h ? `\n  extruded: true, getElevation: f => f.properties.${h},` : ''}\n})`,
    mvt: `import { MVTLayer } from '@deck.gl/geo-layers'\n\nconst layer = new MVTLayer({ id: 'data', data: ${j(url)}, maxZoom: ${o.maxzoom ?? 14} })`,
    pmtiles: `import { MVTLayer } from '@deck.gl/geo-layers'\nimport { MVTLoader } from '@loaders.gl/mvt'\nimport { parse } from '@loaders.gl/core'\nimport { PMTiles } from 'pmtiles'\n\n// MVTLayer는 z/x/y 주소로 타일 요청 → fetch만 PMTiles 읽기로 교체\nconst archive = new PMTiles(${j(url)})\nconst layer = new MVTLayer({\n  id: 'data', data: 'pmtiles://{z}/{x}/{y}',\n  fetch: async (u, { loadOptions, signal }) => {\n    const [z, x, y] = u.slice(10).split('/').map(Number)\n    const tile = await archive.getZxy(z, x, y, signal)\n    return tile ? parse(tile.data, MVTLoader, loadOptions) : null\n  },\n})`,
    'xyz-raster': `import { TileLayer } from '@deck.gl/geo-layers'\nimport { BitmapLayer } from '@deck.gl/layers'\n\nconst layer = new TileLayer({\n  id: 'data', data: ${j(url)}, tileSize: 256,\n  renderSubLayers: p => {\n    const { west, south, east, north } = p.tile.bbox\n    return new BitmapLayer(p, { data: undefined, image: p.data, bounds: [west, south, east, north] })\n  },\n})`,
    image: `import { BitmapLayer } from '@deck.gl/layers'\n\nconst layer = new BitmapLayer({ id: 'data', image: ${j(url)}, bounds: ${j(o.bounds)} })`,
    'terrain-rgb': `import { TerrainLayer } from '@deck.gl/geo-layers'\n\nconst layer = new TerrainLayer({\n  id: 'data', elevationData: ${j(url)}, texture: basemapTileUrl,\n  elevationDecoder: { rScaler: 6553.6, gScaler: 25.6, bScaler: 0.1, offset: -10000 },\n})`,
    '3dtiles': `import { Tile3DLayer } from '@deck.gl/geo-layers'\nimport { Tiles3DLoader } from '@loaders.gl/3d-tiles'\n\nconst layer = new Tile3DLayer({ id: 'data', data: ${j(url)}, loader: Tiles3DLoader })`,
    glb: `import { ScenegraphLayer } from '@deck.gl/mesh-layers'\n\n// glb에는 위치 없음 → 세울 곳 별도 지정. glTF는 Y가 위 → X축 90° 회전\nconst layer = new ScenegraphLayer({\n  id: 'data', scenegraph: ${j(url)},\n  data: ${o.instances ? `await fetch(${j(url.replace(o.path, o.instances))}).then(r => r.json()).then(fc => fc.features)` : `[{ position: ${j(o.anchor)} }]`},\n  getPosition: ${o.instances ? 'f => f.geometry.coordinates' : 'd => d.position'},\n  getOrientation: [0, 0, 90],\n})`,
  }
  return `import maplibregl from 'maplibre-gl'\nimport { MapLibreOverlay } from '@deck.gl/maplibre'\n${layer[o.kind]}\n\nconst map = new maplibregl.Map({ container: 'map', style: baseStyle /* 배경지도 */, center: [lon, lat], zoom })\nmap.addControl(new MapLibreOverlay({ interleaved: true, layers: [layer] }))`
}

function cesium(o: Output, url: string) {
  const body: Partial<Record<Output['kind'], string>> = {
    geojson: `const ds = await Cesium.GeoJsonDataSource.load(${j(url)})\n${o.style?.height ? `for (const e of ds.entities.values) {\n  if (e.polygon) e.polygon.extrudedHeight = e.properties.${o.style.height}.getValue()\n}\n` : ''}viewer.dataSources.add(ds)`,
    'xyz-raster': `viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({\n  url: ${j(url)},\n  rectangle: Cesium.Rectangle.fromDegrees(...${j(o.bounds)}),\n}))`,
    image: `viewer.imageryLayers.addImageryProvider(await Cesium.SingleTileImageryProvider.fromUrl(${j(url)}, {\n  rectangle: Cesium.Rectangle.fromDegrees(...${j(o.bounds)}),\n}))`,
    wms: `// 타일 칸마다 GetMap 요청\nviewer.imageryLayers.addImageryProvider(new Cesium.WebMapServiceImageryProvider({\n  url: ${j(url)}, layers: ${j(o.layer)},\n  parameters: { transparent: true, format: 'image/png' },\n}))`,
    'quantized-mesh': `// layer.json이 있는 폴더 주소\nviewer.terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(${j(url)}, { requestVertexNormals: true })`,
    '3dtiles': `viewer.scene.primitives.add(await Cesium.Cesium3DTileset.fromUrl(${j(url)}))`,
    glb: `// glb에는 위치 없음 → 세울 곳의 동·북·위 좌표계를 모델 행렬로 지정\nconst model = await Cesium.Model.fromGltfAsync({\n  url: ${j(url)},\n  modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(${(o.anchor ?? []).join(', ')})),\n})\nviewer.scene.primitives.add(model)`,
  }
  return `import * as Cesium from 'cesium'\n\n// Cesium ion 미사용 → 배경지도 직접 지정\nconst viewer = new Cesium.Viewer('map', { baseLayer: false, baseLayerPicker: false, geocoder: false })\n${body[o.kind]}`
}

export const snippet = (viewer: ViewerId, o: Output, url: string) => ({ ol, maplibre, deck, cesium })[viewer](o, url)

/** 뷰어가 결과물 종류마다 쓰는 API (components/viewers의 실제 코드와 같다) */
export const viewerApi: Record<ViewerId, Partial<Record<OutputKind, string>>> = {
  ol: {
    'geojson': 'VectorLayer + VectorSource(GeoJSON)',
    'mvt': 'VectorTileLayer + VectorTileSource(MVT)',
    'pmtiles': 'VectorTileLayer + PMTilesVectorSource (ol-pmtiles)',
    'cog': 'WebGLTileLayer + GeoTIFF 소스 — 블록 Range 요청',
    'xyz-raster': 'TileLayer + XYZ',
    'image': 'ImageLayer + ImageStatic — 네 모서리 범위',
    'wms': 'ImageLayer + ImageWMS — 화면 범위 GetMap',
  },
  maplibre: {
    'geojson': 'geojson 소스 + fill·line·circle (높이 있으면 fill-extrusion)',
    'mvt': 'vector 소스 + fill·line·circle',
    'pmtiles': 'pmtiles:// 프로토콜 + vector 소스',
    'xyz-raster': 'raster 소스',
    'image': 'image 소스 — 네 모서리 좌표',
    'terrain-rgb': 'raster-dem 소스 + setTerrain + hillshade',
  },
  deck: {
    'geojson': 'GeoJsonLayer (높이 있으면 extruded)',
    'mvt': 'MVTLayer',
    'pmtiles': 'MVTLayer + PMTiles getZxy (fetch 교체)',
    'xyz-raster': 'TileLayer + BitmapLayer',
    'image': 'BitmapLayer — 네 모서리 범위',
    'terrain-rgb': 'TerrainLayer — RGB → 높이 디코딩',
    '3dtiles': 'Tile3DLayer (loaders.gl Tiles3DLoader)',
    'glb': 'ScenegraphLayer',
  },
  cesium: {
    'geojson': 'GeoJsonDataSource',
    'xyz-raster': 'UrlTemplateImageryProvider',
    'image': 'SingleTileImageryProvider',
    'quantized-mesh': 'CesiumTerrainProvider',
    '3dtiles': 'Cesium3DTileset',
    'glb': 'Model.fromGltfAsync',
    'wms': 'WebMapServiceImageryProvider — 타일 단위 GetMap',
  },
}

/** 결과물의 좌표계·형태 (업로드 레시피가 만드는 것 기준) */
export const kindCrs: Record<OutputKind, string> = {
  'geojson': 'EPSG:4326 위경도 (RFC 7946)',
  'mvt': 'EPSG:3857 타일 격자 z/x/y (타일 안 좌표는 4096칸 정수)',
  'pmtiles': 'EPSG:3857 타일 격자 (MVT 타일을 한 파일에)',
  'image': 'EPSG:3857 재투영 그림 + 네 모서리 위경도(bounds)',
  'cog': 'EPSG:3857 (GoogleMapsCompatible 블록)',
  'xyz-raster': 'EPSG:3857 타일 격자 z/x/y',
  'terrain-rgb': 'EPSG:3857 타일 격자 z/x/y, 높이 = -10000 + (R×65536 + G×256 + B) × 0.1',
  'quantized-mesh': 'EPSG:4326 지리 타일(TMS) + layer.json',
  '3dtiles': '지구 중심 좌표 EPSG:4978 (tileset.json 변환 행렬·경계 볼륨)',
  'glb': '모델 좌표(m, Y 위) — 지도 위치는 별도 지정(anchor)',
  'wms': '요청 때 지정 (EPSG:3857·4326 등)',
}

/** 정적 호스팅 조건: 내려받아 자기 웹 서버에 올릴 때 필요한 것 (모든 형식 공통: 다른 도메인 페이지에서 읽으면 CORS 허용) */
export const kindHosting: Record<OutputKind, string> = {
  'geojson': '파일 하나. Content-Type application/geo+json 또는 application/json',
  'mvt': 'z/x/y 폴더 구조 그대로. .pbf → application/x-protobuf (gzip으로 저장된 타일이면 Content-Encoding: gzip)',
  'pmtiles': '파일 하나. HTTP Range 요청(206) 지원 필수, CORS에 Range 요청 헤더 허용 + Content-Range·ETag 노출',
  'image': '파일 하나. 이미지 MIME. 위치(네 모서리)는 코드에서 지정',
  'cog': '파일 하나. HTTP Range 요청(206) 지원 필수, CORS에 Range 허용',
  'xyz-raster': 'z/x/y 폴더 구조 그대로. 타일 확장자 MIME (WebP: image/webp)',
  'terrain-rgb': 'z/x/y 폴더 구조 그대로. image/png',
  'quantized-mesh': 'layer.json과 타일 폴더 구조 그대로. .terrain → application/vnd.quantized-mesh (gzip으로 저장된 타일이면 Content-Encoding: gzip)',
  '3dtiles': 'tileset.json과 타일(b3dm·pnts·glb) 폴더 구조 그대로 (상대 경로 참조). JSON·바이너리 MIME',
  'glb': '파일 하나. model/gltf-binary',
  'wms': '서버 서비스 — 정적 호스팅 대상 아님',
}

/**
 * 결과 하나를 뷰어에 붙이는 코드 + 시점 값. url = 결과 주소(내려받아 올린 곳 주소로 바꾸면 그대로 동작), view = 결과 시점
 * ponytail: 배경지도(basemap·baseStyle)는 자리만 둔다 — 쓰는 곳의 배경지도가 다 달라서
 */
export function usage(viewer: ViewerId, o: Output, url: string, view?: { center: [number, number]; zoom: number }) {
  const at = view ? `// 결과 위치 (이 변환 결과의 시점)\nconst [lon, lat] = ${JSON.stringify(view.center.map(v => Math.round(v * 1e6) / 1e6))}\nconst zoom = ${Math.round(view.zoom * 10) / 10}\n\n` : ''

  return { api: viewerApi[viewer][o.kind] ?? '', code: at + snippet(viewer, o, url), hosting: kindHosting[o.kind], crs: kindCrs[o.kind] }
}
