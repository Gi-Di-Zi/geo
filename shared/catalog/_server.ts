// 서버 레시피 도우미: 전처리 결과를 상시 PostGIS(벡터)·공유 폴더 /serve(래스터)에 두고 GeoServer·martin에 발행한다.
// GeoServer 단계는 curl로 REST API를 부른다. 단계 컨테이너가 서버 네트워크에서 도는 방식은 scripts/pipeline.ts
import { categories } from './categories.ts'
import type { Output, Recipe, Step } from '../types.ts'

type Bounds = [number, number, number, number]

const gs = (...lines: string[]) => ['set -e', 'GS=http://geoserver:8080/geoserver/rest', 'AUTH="-u admin:$GEOSERVER_ADMIN_PASSWORD"', ...lines].join('\n')
const send = (method: string, body: string, url: string) => `curl -sf $AUTH -X${method} -H 'Content-Type: text/xml' -d '${body}' ${url}`
const workspace = `curl -sf $AUTH $GS/workspaces/geo -o /dev/null || ${send('POST', '<workspace><name>geo</name></workspace>', '$GS/workspaces')}`
const defaultStyle = (name: string) => send('PUT', `<layer><defaultStyle><name>${name}</name><workspace>geo</workspace></defaultStyle></layer>`, `$GS/layers/geo:${name}`)

/** SLD 규칙(심볼라이저)을 스타일로 등록. 있으면 교체(PUT), 없으면 생성(POST) */
function style(name: string, rules: string, why: string): Step {
  const sld = `<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld">\n  <NamedLayer><Name>${name}</Name><UserStyle><FeatureTypeStyle><Rule>\n${rules}\n  </Rule></FeatureTypeStyle></UserStyle></NamedLayer>\n</StyledLayerDescriptor>`
  return {
    title: '스타일(SLD) 등록',
    why: `${why} PUT: 있으면 교체, 없으면 POST로 생성.`,
    tool: 'geoserver',
    run: gs(`SLD='${sld}'`, `curl -sf $AUTH -XPUT -H 'Content-Type: application/vnd.ogc.sld+xml' -d "$SLD" $GS/workspaces/geo/styles/${name} || curl -sf $AUTH -XPOST -H 'Content-Type: application/vnd.ogc.sld+xml' -d "$SLD" "$GS/workspaces/geo/styles?name=${name}"`),
  }
}

const wms = (name: string, bounds: Bounds): Output => ({
  id: 'wms', kind: 'wms', path: '/svc/geoserver/wms', layer: name, bounds, label: 'WMS',
  why: 'GetMap 요청마다 화면 범위 그림 생성(서버 렌더링, SLD 스타일). 국내 공공 지도 서비스의 기본 방식.',
})
const wmts = (name: string, bounds: Bounds, maxzoom: number): Output => ({
  id: 'wmts', kind: 'xyz-raster', maxzoom, bounds, label: 'WMTS 타일 (GeoWebCache)',
  path: `/svc/geoserver/gwc/service/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${name}&STYLE=&TILEMATRIXSET=EPSG:900913&TILEMATRIX=EPSG:900913:{z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png`,
  why: '256px 고정 격자 그림 타일. 처음 요청 때 그리고 저장, 다음부터 캐시 응답. EPSG:900913 격자의 TILEROW·TILECOL = XYZ 타일 번호.',
})

interface ServerVector {
  category: string
  /** DB 표 이름 = GeoServer 레이어·스타일 이름 = martin 소스 id. 확장자끼리 겹치지 않게 */
  layer: string
  preprocess: Step[]
  /** 전처리 결과 파일. load를 주지 않으면 이 파일을 그대로 적재 */
  work?: string
  load?: Step
  geom: 'polygon' | 'point'
  bounds: Bounds
  /** 높이 속성. 있으면 WFS·MVT 결과를 뷰어가 돌출 */
  height?: string
}

const vectorLoad = (v: ServerVector): Step => ({
  title: 'PostGIS 적재',
  why: `전처리 결과 → 상시 DB 표(${v.layer}). 표 이름 = GeoServer 레이어·martin 소스 이름.${v.geom === 'polygon' ? ' -nlt PROMOTE_TO_MULTI: Polygon·MultiPolygon 통일.' : ''} -overwrite: 다시 실행 시 표 교체.`,
  tool: 'gdal',
  run: `ogr2ogr -f PostgreSQL PG:dbname=gis ${v.work} -nln ${v.layer} -overwrite${v.geom === 'polygon' ? ' -nlt PROMOTE_TO_MULTI' : ''} -lco GEOMETRY_NAME=geom`,
})

function vectorRules(v: ServerVector) {
  const c = categories.find(x => x.id === v.category)!.color
  const css = (name: string, value: string | number) => `<CssParameter name="${name}">${value}</CssParameter>`
  if (v.geom === 'point') return `    <PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>\n      <Fill>${css('fill', c)}</Fill>\n    </Mark><Size>8</Size></Graphic></PointSymbolizer>`
  return `    <PolygonSymbolizer>\n      <Fill>${css('fill', c)}${css('fill-opacity', v.height ? 0.5 : 0.12)}</Fill>\n      <Stroke>${css('stroke', c)}${css('stroke-width', v.height ? 0.5 : 2)}</Stroke>\n    </PolygonSymbolizer>`
}

function geoserverVector(v: ServerVector): Recipe {
  const h = v.height && { style: { height: v.height } }
  return {
    id: 'geoserver',
    title: 'GeoServer',
    preprocess: v.preprocess,
    convert: [
      v.load ?? vectorLoad(v),
      {
        title: '작업공간·저장소 등록',
        why: 'GeoServer REST API. 작업공간(geo): 레이어 묶음, 서비스 주소 /geo/wms·/geo/ows. 저장소(gis): PostGIS 연결 정보. 이미 있으면 건너뜀.',
        tool: 'geoserver',
        run: gs(workspace, `curl -sf $AUTH $GS/workspaces/geo/datastores/gis -o /dev/null || curl -sf $AUTH -XPOST -H 'Content-Type: text/xml' -d "<dataStore><name>gis</name><connectionParameters><dbtype>postgis</dbtype><host>$PGHOST</host><port>5432</port><database>$PGDATABASE</database><user>$PGUSER</user><passwd>$PGPASSWORD</passwd></connectionParameters></dataStore>" $GS/workspaces/geo/datastores`),
      },
      style(v.layer, vectorRules(v), `WMS·WMTS 그림은 서버가 그림 → 색·${v.geom === 'point' ? '점 크기' : '선 굵기'}를 서버 스타일(SLD)로 지정. 다른 레시피의 화면 스타일과 같게${v.height ? '(돌출 대신 바닥면만)' : ''}.`),
      {
        title: '레이어 발행',
        why: 'featureType: 표 → 레이어. 범위·좌표계는 GeoServer가 표에서 계산. numDecimals 7: WFS 좌표 소수 7자리(기본 4자리 ≈ 10 m). 발행과 함께 GeoWebCache 타일 레이어 자동 생성 → WMTS. 다시 실행 시 지우고 새로 발행(속성 목록·타일 캐시 갱신).',
        tool: 'geoserver',
        run: gs(
          `curl -s $AUTH -XDELETE "$GS/workspaces/geo/datastores/gis/featuretypes/${v.layer}?recurse=true" -o /dev/null`,
          send('POST', `<featureType><name>${v.layer}</name><numDecimals>7</numDecimals></featureType>`, '$GS/workspaces/geo/datastores/gis/featuretypes'),
          defaultStyle(v.layer),
        ),
      },
    ],
    outputs: [
      wms(v.layer, v.bounds),
      wmts(v.layer, v.bounds, 19),
      {
        id: 'wfs', kind: 'geojson', ...h, label: v.height ? `WFS (GeoJSON, ${v.height} 속성)` : 'WFS (GeoJSON)',
        path: `/svc/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=${v.layer}&outputFormat=application/json&srsName=EPSG:4326`,
        why: `도형·속성 그대로 응답. outputFormat=application/json: GeoJSON. srsName=EPSG:4326: 표 좌표계가 달라도 서버가 위경도로 변환. bbox·필터로 일부만 요청 가능.${v.height ? ' 돌출은 뷰어가 height로.' : ''}`,
      },
    ],
    viewers: v.height
      ? {
          ol: { output: 'wms', note: '2D 지도 — 서버가 그린 바닥면 그림.' },
          maplibre: { output: 'wfs', note: 'WFS GeoJSON → fill-extrusion으로 돌출.' },
          deck: { output: 'wfs', note: 'WFS GeoJSON → GeoJsonLayer extruded.' },
          cesium: { output: 'wfs', note: 'WFS GeoJSON → 다각형별 extrudedHeight.' },
        }
      : {
          ol: { output: 'wms', note: '움직일 때마다 화면 범위 그림 한 장 요청.' },
          maplibre: { output: 'wmts', note: 'WMS 직접 미지원 → WMTS 타일 주소를 XYZ 템플릿으로.' },
          deck: { output: 'wfs', note: 'WFS GeoJSON 받아 브라우저에서 그림(스타일은 화면 쪽).' },
          cesium: { output: 'wms', note: '타일 칸마다 GetMap 요청.' },
        },
  }
}

function martinVector(v: ServerVector): Recipe {
  return {
    id: 'martin',
    title: 'martin',
    preprocess: v.preprocess,
    convert: [
      v.load ?? vectorLoad(v),
      {
        title: '소스 확인 (TileJSON)',
        why: 'martin: 시작할 때 PostGIS 표 자동 발행(pipeline/martin.yaml: public 스키마), 표 이름 = 소스 id. 새 표는 재시작 필요 → 이 단계 전에 파이프라인이 재시작. TileJSON: 타일 주소·범위·속성 목록.',
        tool: 'martin',
        run: `curl -sf http://martin:3000/${v.layer}`,
      },
    ],
    outputs: [
      {
        id: 'tiles', kind: 'mvt', path: `/svc/martin/${v.layer}/{z}/{x}/{y}`, layer: v.layer, bounds: v.bounds,
        ...(v.height && { style: { height: v.height } }),
        label: 'MVT 벡터타일 (요청마다 생성)',
        why: `요청마다 ST_AsMVT 실행 → 미리 굽는 MVT와 같은 타일. 줌 제한 없음, 좌표계 변환도 요청마다. 표 수정 → 캐시 만료 후 반영.${v.height ? ' height 속성 포함 → 뷰어가 돌출.' : ''}`,
      },
    ],
    viewers: {
      ol: { output: 'tiles', ...(v.height && { note: '2D 지도 — 바닥면만.' }) },
      maplibre: { output: 'tiles', ...(v.height && { note: 'vector 소스 → fill-extrusion으로 돌출.' }) },
      deck: { output: 'tiles', ...(v.height && { note: 'MVTLayer extruded.' }) },
      cesium: { unsupported: 'MVT 미지원. martin 출력은 타일뿐 → GeoJSON 피처는 WFS(GeoServer 레시피).' },
    },
  }
}

/** 벡터 서버 레시피 두 개 (GeoServer, martin) */
export const serverRecipes = (v: ServerVector): Recipe[] => [geoserverVector(v), martinVector(v)]

interface ServerRaster {
  /** 저장소·레이어·스타일 이름 */
  name: string
  preprocess: Step[]
  /** 서버가 읽을 GeoTIFF 경로 (/serve/<유형>/<확장자>/…) 와 그 파일을 만드는 단계 */
  file: string
  prepare: Step
  /** SLD RasterSymbolizer 안쪽 (ColorMap 등) */
  symbolizer: string
  styleWhy: string
  bounds: Bounds
  maxzoom: number
  view?: Recipe['view']
}

/** 래스터 서버 레시피 (GeoServer). /serve 아래 GeoTIFF → 저장소 → 스타일 → 레이어 */
export function geoserverRaster(r: ServerRaster): Recipe {
  return {
    id: 'geoserver',
    title: 'GeoServer',
    preprocess: r.preprocess,
    convert: [
      r.prepare,
      {
        title: '작업공간·저장소 등록 (GeoTIFF)',
        why: '저장소 종류 GeoTIFF: 파일 하나 = 저장소 하나. url: GeoServer 컨테이너 안 경로(/serve는 공유 폴더). 다시 실행 시 지우고 새로 등록 → 바뀐 파일 다시 읽기.',
        tool: 'geoserver',
        run: gs(
          workspace,
          `curl -s $AUTH -XDELETE "$GS/workspaces/geo/coveragestores/${r.name}?recurse=true" -o /dev/null`,
          send('POST', `<coverageStore><name>${r.name}</name><type>GeoTIFF</type><workspace>geo</workspace><enabled>true</enabled><url>file://${r.file}</url></coverageStore>`, '$GS/workspaces/geo/coveragestores'),
        ),
      },
      style(r.name, `    <RasterSymbolizer>\n${r.symbolizer}\n    </RasterSymbolizer>`, r.styleWhy),
      {
        title: '레이어 발행',
        why: 'coverage: 래스터 → 레이어. nativeName: 저장소 안 원래 이름(GeoTIFF는 파일 이름). 좌표계·범위는 GeoTIFF에서 읽음. 발행과 함께 GeoWebCache 타일 레이어 자동 생성 → WMTS.',
        tool: 'geoserver',
        run: gs(send('POST', `<coverage><name>${r.name}</name><nativeName>${r.file.split('/').pop()!.replace('.tif', '')}</nativeName></coverage>`, `$GS/workspaces/geo/coveragestores/${r.name}/coverages`), defaultStyle(r.name)),
      },
    ],
    outputs: [wms(r.name, r.bounds), wmts(r.name, r.bounds, r.maxzoom)],
    viewers: {
      ol: { output: 'wms', note: '움직일 때마다 화면 범위 그림 한 장 요청.' },
      maplibre: { output: 'wmts', note: 'WMS 직접 미지원 → WMTS 타일 주소를 XYZ 템플릿으로.' },
      deck: { output: 'wmts', note: 'TileLayer + BitmapLayer로 WMTS 타일.' },
      cesium: { output: 'wms', note: '타일 칸마다 GetMap 요청.' },
    },
    ...(r.view && { view: r.view }),
  }
}
