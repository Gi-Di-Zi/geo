// 코드 서랍에 보여 줄 최소 코드. 각 뷰어 컴포넌트(components/viewers)가 실제로 하는 일을 줄인 것이다
import type { Output, ViewerId } from '#shared/types'

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
