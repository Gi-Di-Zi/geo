// 독립 HTML 지도: 결과 파일 + 지도 페이지(index.html) + 라이브러리를 한 폴더로 (qgis2web처럼 정적 호스팅에 올리면 그대로 열림).
// 페이지 코드는 적용 코드(snippets.ts) 그대로 → 사이트의 코드와 결과 zip의 페이지가 같은 코드. 배경지도 자리(basemap·baseStyle)만 OSM으로 채운다.
// 라이브러리: OpenLayers·MapLibre·Deck.gl은 적용 코드에 나오는 모듈만 묶어 lib/에 (scripts/standalone-lib.ts), CesiumJS는 수십 MB라 CDN
import { usage } from './snippets.ts'
import type { Output, ViewerId } from './types.ts'

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_CREDIT = '© OpenStreetMap contributors'

/** 적용 코드가 비워 둔 배경지도 자리. 라이브러리 묶음(scripts/standalone-lib.ts)도 여기 나오는 모듈을 함께 넣는다 */
export const basemapCode: Record<ViewerId, string> = {
  ol: "import TileLayer_ from 'ol/layer/Tile'\nimport OSM_ from 'ol/source/OSM'\n\n// 배경지도: OpenStreetMap (실제 서비스는 이용 조건에 맞는 배경지도로 바꾸기)\nconst basemap = new TileLayer_({ source: new OSM_() })\n",
  maplibre: `// 배경지도: OpenStreetMap (실제 서비스는 이용 조건에 맞는 배경지도로 바꾸기)\nconst baseStyle = { version: 8, sources: { osm: { type: 'raster', tiles: [${JSON.stringify(OSM)}], tileSize: 256, maxzoom: 19, attribution: ${JSON.stringify(OSM_CREDIT)} } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] }\n`,
  deck: `// 배경지도: OpenStreetMap (실제 서비스는 이용 조건에 맞는 배경지도로 바꾸기)\nconst baseStyle = { version: 8, sources: { osm: { type: 'raster', tiles: [${JSON.stringify(OSM)}], tileSize: 256, maxzoom: 19, attribution: ${JSON.stringify(OSM_CREDIT)} } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] }\nconst basemapTileUrl = ${JSON.stringify(OSM)}\n`,
  cesium: '',
}

// Cesium: 적용 코드는 배경지도 없이(baseLayer: false) 만든다 → 맨 아래(0번)에 OSM
const after: Record<ViewerId, string> = {
  ol: '', maplibre: '', deck: '',
  cesium: "\n// 배경지도: OpenStreetMap을 맨 아래에 (실제 서비스는 이용 조건에 맞는 배경지도로 바꾸기)\nviewer.imageryLayers.addImageryProvider(new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }), 0)\n",
}

/** 라이브러리 묶음 정보 (scripts/standalone-lib.ts가 만든 manifest.json) */
export interface StandaloneLib {
  /** 뷰어별 importmap: 모듈 이름 → lib/ 안 파일 */
  imports: Partial<Record<ViewerId, Record<string, string>>>
  /** 뷰어별 lib/ 파일 목록 (zip에 넣을 것) */
  files: Partial<Record<ViewerId, string[]>>
  versions: Record<string, string>
}

const cesiumCdn = (version: string) => `https://cdn.jsdelivr.net/npm/cesium@${version}/Build/Cesium/`

const css: Record<ViewerId, (lib: StandaloneLib) => string> = {
  ol: () => '<link rel="stylesheet" href="./lib/ol.css">',
  maplibre: () => '<link rel="stylesheet" href="./lib/maplibre-gl.css">',
  deck: () => '<link rel="stylesheet" href="./lib/maplibre-gl.css">',
  cesium: lib => `<link rel="stylesheet" href="${cesiumCdn(lib.versions.cesium ?? '')}Widgets/widgets.css">\n<script>window.CESIUM_BASE_URL = ${JSON.stringify(cesiumCdn(lib.versions.cesium ?? ''))}</script>`,
}

// 데이터 주소는 페이지 위치 기준 절대 주소로: 상대 주소면 MapLibre가 타일을 워커 파일(lib/) 기준으로 찾는다
const DATA_LINE = "// 결과 폴더: 이 페이지 옆 data/\nconst DATA = new URL('./data/', location.href).href\n"
const MARK = '__GEO_DATA__/'

/** 결과 하나를 지도에 띄우는 독립 페이지 */
export function standalonePage(viewer: ViewerId, o: Output, view: { center: [number, number]; zoom: number } | undefined, lib: StandaloneLib, title: string) {
  const imports = viewer === 'cesium' ? { cesium: `${cesiumCdn(lib.versions.cesium ?? '')}index.js` } : lib.imports[viewer] ?? {}
  const code = `${DATA_LINE}${basemapCode[viewer]}\n${usage(viewer, o, MARK + o.path, view).code.replaceAll(MARK, '" + DATA + "').replaceAll('"" + DATA', 'DATA')}\n${after[viewer]}`
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${css[viewer](lib)}
<style>html, body, #map { margin: 0; width: 100%; height: 100%; }</style>
<script type="importmap">${JSON.stringify({ imports }).replace(/</g, '\\u003c')}</script>
</head>
<body>
<div id="map"></div>
<!-- 만든 곳: geo-web-bridge (https://geospatial.kro.kr). 데이터는 data/, 라이브러리는 lib/ -->
<script type="module">
${code.replace(/<\/script/gi, '<\\/script')}
</script>
</body>
</html>
`
}

/** 결과 폴더의 안내문 */
export function standaloneReadme(viewer: ViewerId, viewerName: string, hosting: string, lib: StandaloneLib) {
  return `geo-web-bridge가 만든 ${viewerName} 지도 페이지입니다.

[여는 방법]
이 폴더에서 정적 웹 서버를 띄운 뒤 브라우저로 엽니다.
  npx serve          (Node.js. PMTiles·COG처럼 범위(Range) 요청이 필요한 결과도 됩니다)
  python -m http.server  (GeoJSON·타일 폴더·3D Tiles)
index.html을 파일로 바로 열면(file://) 브라우저가 데이터 읽기를 막습니다.

[올리는 방법]
폴더 전체를 정적 호스팅(GitHub Pages, Netlify, S3, 사내 웹 서버 등)에 그대로 올리면 됩니다.
호스팅 조건: ${hosting}

[구성]
index.html  지도 페이지. 코드는 사이트의 "적용 코드"와 같습니다
data/       변환 결과 (원본 데이터의 이용 조건을 따릅니다)
${viewer === 'cesium' ? `CesiumJS ${lib.versions.cesium}은 CDN(jsDelivr)에서 불러옵니다 → 인터넷 연결 필요` : `lib/        라이브러리 (${Object.entries(lib.versions).filter(([name]) => name !== 'cesium').map(([name, version]) => `${name} ${version}`).join(', ')}). 각 라이브러리의 라이선스를 따릅니다`}

[배경지도]
OpenStreetMap 타일(${OSM_CREDIT})을 씁니다. 실제 서비스에서는 배경지도 제공자의 이용 조건을 확인하고 index.html의 배경지도 줄을 바꾸세요.
`
}
