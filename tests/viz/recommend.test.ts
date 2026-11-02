// 추천 엔진(shared/recommend.ts) 규칙 확인. 실제 카탈로그(shared/catalog)의 업로드 레시피로 계산한다 (mock 없음)
import test from 'node:test'
import assert from 'node:assert/strict'
import { openAsBlob, readdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readIntent, recommend } from '../../shared/recommend.ts'
import { sniff } from '../../shared/sniff.ts'
import type { FormatSpec } from '../../shared/types.ts'

const dir = fileURLToPath(new URL('../../shared/catalog/', import.meta.url))
const specs: FormatSpec[] = []

// nuxt.config.ts의 #catalog-formats와 같은 규칙: <유형>/<확장자>.ts (밑줄로 시작하면 공용 조각)
for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' }).map(f => f.replaceAll('\\', '/')).sort()) {
  if (!/^[^/]+\/[^_/][^/]*\.ts$/.test(file)) continue
  const mod: { default: FormatSpec } = await import(pathToFileURL(join(dir, file)).href)
  specs.push(mod.default)
}

function spec(id: string) {
  const found = specs.find(s => `${s.category}/${s.id}` === id)

  assert.ok(found, id)

  return found
}

const MB = 1024 ** 2

test('SHP + MapLibre + 대용량 → tippecanoe PMTiles, 대안 GDAL MVT', () => {
  const r = recommend(spec('vector-2d/shp'), { viewer: 'maplibre', priority: 'large_data' }, { bytes: 80 * MB, count: 400_000 })

  assert.equal(r.recommended?.method, 'tippecanoe')
  assert.equal(r.recommended?.primary?.kind, 'pmtiles')
  assert.ok(r.recommended?.warnings.some(w => w.includes('피처 생략')))
  const gdal = r.candidates.find(c => c.method === 'gdal')
  assert.equal(gdal?.fit, 'alternative')
  assert.equal(gdal?.primary?.kind, 'mvt')
})

test('SHP + CesiumJS → GeoJSON (벡터타일 미지원)', () => {
  const r = recommend(spec('vector-2d/shp'), { viewer: 'cesium' }, { bytes: 2 * MB, count: 1650 })

  assert.equal(r.recommended?.primary?.kind, 'geojson')

  for (const c of r.candidates) assert.ok(c.fit === 'unsupported' || c.primary?.kind === 'geojson')
})

test('CesiumJS + PMTiles 요청 → 충돌 이유 (CesiumJS에 PMTiles를 주지 않음)', () => {
  const r = recommend(spec('vector-2d/shp'), { viewer: 'cesium', output: 'pmtiles' }, { bytes: 2 * MB })

  assert.equal(r.recommended, null)
  assert.match(r.conflict ?? '', /PMTiles 미지원/)
})

test('GeoTIFF + OpenLayers → COG', () => {
  const r = recommend(spec('raster/tif'), { viewer: 'ol' }, { bytes: 20 * MB })

  assert.equal(r.recommended?.primary?.kind, 'cog')
  assert.ok(r.recommended?.warnings.some(w => w.includes('8비트')))
})

test('DEM + CesiumJS → quantized-mesh, DEM + MapLibre → Terrain-RGB', () => {
  assert.equal(recommend(spec('terrain/tif'), { viewer: 'cesium' }, { bytes: MB }).recommended?.primary?.kind, 'quantized-mesh')
  assert.equal(recommend(spec('terrain/tif'), { viewer: 'maplibre' }, { bytes: MB }).recommended?.primary?.kind, 'terrain-rgb')
})

test('LAS + Deck.gl → 3D Tiles, 원본 보존이면 양자화 없는 py3dtiles', () => {
  const r = recommend(spec('pointcloud/las'), { viewer: 'deck' }, { bytes: 20 * MB, count: 675_472 })

  assert.equal(r.recommended?.primary?.kind, '3dtiles')
  assert.equal(r.recommended?.method, 'mago')
  assert.ok(r.notes.some(n => n.includes('RGB')))
  assert.equal(recommend(spec('pointcloud/las'), { viewer: 'deck', priority: 'fidelity' }, { bytes: 20 * MB }).recommended?.method, 'py3dtiles')
})

test('LAS + OpenLayers → 미지원 이유와 실제 가능한 대안', () => {
  const r = recommend(spec('pointcloud/las'), { viewer: 'ol' }, { bytes: 20 * MB })

  assert.equal(r.recommended, null)
  assert.ok(r.candidates.every(c => c.fit === 'unsupported'))
  assert.match(r.conflict ?? '', /3D 점군 미지원/)
  assert.match(r.conflict ?? '', /CesiumJS/)
  assert.deepEqual(r.byViewer.filter(b => b.method).map(b => b.viewer), ['deck', 'cesium'])
})

test('IFC·glTF → 고정 위치 배치 제약 (limited)', () => {
  for (const id of ['indoor-bim/ifc', 'model-3d/gltf', 'model-3d/glb']) {
    const r = recommend(spec(id), { viewer: 'cesium' }, { bytes: 3 * MB })

    assert.equal(r.recommended?.fit, 'limited', id)
    assert.ok(r.recommended?.warnings.some(w => w.includes('실제 위치 아님')), id)
  }

  // CityGML은 srsName 좌표계로 제자리 배치 → 고정 위치 제약 없음
  assert.equal(recommend(spec('model-3d/citygml'), { viewer: 'cesium' }, { bytes: 3 * MB }).recommended?.fit, 'recommended')
})

test('뷰어 미지정 → 뷰어를 확정하지 않고 뷰어별 결과와 선택 질문', () => {
  const r = recommend(spec('vector-2d/shp'), {}, { bytes: 2 * MB, count: 1650 })

  assert.equal(r.intent.viewer, null)
  assert.ok(r.recommended)
  assert.ok(r.needs.some(n => n.includes('대상 라이브러리 미지정')))
  assert.deepEqual(r.byViewer.map(b => b.output?.kind), ['geojson', 'geojson', 'geojson', 'geojson'])
})

test('PMTiles만 지정 → 뷰어 질문 없이 tippecanoe', () => {
  const r = recommend(spec('vector-2d/geojson'), { output: 'pmtiles' }, { bytes: 3 * MB })

  assert.equal(r.recommended?.method, 'tippecanoe')
  assert.equal(r.recommended?.primary?.kind, 'pmtiles')
  assert.ok(!r.needs.some(n => n.includes('대상 라이브러리')))
})

test('서비스 요청 + 공개 환경(서비스 꺼짐) → 파일로 바꾸지 않고 이유·파일 대안', () => {
  const r = recommend(spec('vector-2d/shp'), { delivery: 'service' }, { bytes: 2 * MB }, false)

  assert.equal(r.recommended, null)
  assert.match(r.conflict ?? '', /공간 서비스 발행을 제공하지 않음/)
  assert.ok(r.candidates.every(c => c.way === 'file' && c.fit !== 'recommended'))
})

test('서비스 요청 + 서비스 허용 환경 → GeoServer·martin, 48시간 만료 안내', () => {
  const r = recommend(spec('vector-2d/shp'), { delivery: 'service', viewer: 'cesium' }, { bytes: 2 * MB }, true)

  assert.equal(r.recommended?.method, 'geoserver')
  assert.equal(r.recommended?.way, 'service')
  assert.ok(r.recommended?.warnings.some(w => w.includes('48시간')))
  assert.match(r.candidates.find(c => c.method === 'martin')?.reasons[0] ?? '', /MVT 미지원/)
})

test('작은 벡터 + 일반 목적 → GeoJSON 통째, 중간 크기 → 사이트 뷰어 기본(MVT)', () => {
  assert.equal(recommend(spec('vector-2d/geojson'), { viewer: 'maplibre' }, { bytes: 200 }).recommended?.primary?.kind, 'geojson')
  assert.equal(recommend(spec('vector-2d/geojson'), { viewer: 'maplibre' }, { bytes: 15 * MB }).recommended?.primary?.kind, 'mvt')
})

test('모든 업로드 형식 × 뷰어: 미지원은 이유가 있고, 지원은 그 뷰어가 구현한 결과', async () => {
  const { viewerKinds } = await import('../../shared/viewers.ts')

  for (const s of specs) {
    if (s.closed || !('recipes' in s.upload)) continue

    for (const viewer of ['ol', 'maplibre', 'deck', 'cesium'] as const) {
      const r = recommend(s, { viewer }, { bytes: MB })

      if (r.recommended?.primary) assert.ok(viewerKinds[viewer].includes(r.recommended.primary.kind), `${r.format} ${viewer}`)
      else assert.ok(r.conflict, `${r.format} ${viewer}: 이유 없음`)
    }
  }
})

test('바깥 입력 확인: auto = 미지정, 모르는 값 = null', () => {
  assert.deepEqual(readIntent({ viewer: 'auto', priority: 'large_data', output: 'auto' }), { priority: 'large_data' })
  assert.equal(readIntent({ viewer: 'leaflet' }), null)
  assert.equal(readIntent({ output: 'wms' }), null)
})

test('LAS 머리글: 점 수·RGB·좌표계 기록 유무 (좌표계 없으면 변환 전에 막음)', async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'geo-las-'))

  t.after(() => rm(tmp, { recursive: true, force: true }))

  // LAS 1.2 머리글 227바이트, VLR 없음, 점 형식 2(RGB), 점 1234개
  const header = new Uint8Array(227)
  const view = new DataView(header.buffer)

  header.set([...'LASF'].map(c => c.charCodeAt(0)))
  view.setUint8(24, 1)
  view.setUint8(25, 2)
  view.setUint16(94, 227, true)
  view.setUint32(96, 227, true)
  view.setUint32(100, 0, true)
  view.setUint8(104, 2)
  view.setUint32(107, 1234, true)
  const file = join(tmp, 'no-crs.las')
  await writeFile(file, header)
  const found = await sniff(await openAsBlob(file), 'no-crs.las', specs)

  assert.equal(found.picks[0]?.id, 'las')
  assert.equal(found.count, 1234)
  assert.ok(found.facts.some(f => f.includes('RGB 있음')))
  assert.match(found.blocked ?? '', /좌표계 기록 없음/)
  assert.ok(recommend(spec('pointcloud/las'), { viewer: 'cesium' }, { bytes: 227, blocked: found.blocked }).blocked)
})

test('이미 웹 형식인 PMTiles → 원본 그대로를 주력 (타일에서 다시 꺼낸 GeoJSON은 CesiumJS용)', () => {
  for (const priority of ['balanced', 'fast_preview', 'fidelity'] as const) {
    assert.equal(recommend(spec('vector-2d/pmtiles'), { viewer: 'maplibre', priority }, { bytes: MB }).recommended?.primary?.kind, 'pmtiles', priority)
  }

  assert.equal(recommend(spec('vector-2d/pmtiles'), { viewer: 'cesium' }, { bytes: MB }).recommended?.primary?.kind, 'geojson')
})

test('IFC4 → mago(IFC2x3 전용)는 미지원, IfcConvert만', () => {
  const r = recommend(spec('indoor-bim/ifc'), { viewer: 'deck', priority: 'large_data' }, { bytes: 3 * MB, schema: 'IFC4' })

  assert.equal(r.recommended?.method, 'ifcconvert')
  assert.match(r.candidates.find(c => c.method === 'mago')?.reasons[0] ?? '', /IFC2x3/)
  assert.equal(recommend(spec('indoor-bim/ifc'), { viewer: 'deck', priority: 'large_data' }, { bytes: 3 * MB, schema: 'IFC2X3' }).recommended?.method, 'mago')
})

test('원본 보존 목적인데 손실 없는 결과가 없으면 그 사실을 이유에 밝힘 (래스터)', () => {
  const r = recommend(spec('raster/tif'), { viewer: 'maplibre', priority: 'fidelity' }, { bytes: MB })

  assert.ok(r.recommended?.reasons.some(x => x.includes('원본 값을 그대로 두는 결과 없음')))
  // 손실 없는 결과가 있으면 붙이지 않음 (점군 py3dtiles)
  assert.ok(!recommend(spec('pointcloud/las'), { viewer: 'deck', priority: 'fidelity' }, { bytes: MB }).recommended?.reasons.some(x => x.includes('원본 값을 그대로')))
})
