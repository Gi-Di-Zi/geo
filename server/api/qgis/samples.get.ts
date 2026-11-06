// QGIS 웹 지도 변환 플러그인의 "예시 데이터": 확장자별 공개 샘플 원본 중 QGIS가 2D 레이어로 바로 여는 것.
// 파일은 사이트의 /data/<유형>/<형식>/collect.json·raw/ 그대로 (플러그인이 받아 연다)
import { categories } from '#shared/catalog/categories'
import { sources } from '#shared/catalog/sources'
import { allFormats } from '../../utils/catalog'

// 파일 하나(또는 압축 하나)를 GDAL/OGR이 바로 여는 형식. 타일 폴더(MVT·3D Tiles·지형 타일)·PMTiles·CSV(좌표 열 지정 필요)는 뺀다
const OPENABLE = ['vector-2d/gpkg', 'vector-2d/fgb', 'vector-2d/geojson', 'vector-2d/shp', 'vector-2d/gml', 'vector-25d/geojson', 'vector-25d/shp',
  'raster/tif', 'raster/cog', 'raster/png', 'raster/jpg', 'raster/webp', 'terrain/tif', 'terrain/img']

export default defineEventHandler(() => OPENABLE.flatMap(id => {
  const f = allFormats.find(s => `${s.category}/${s.id}` === id)

  if (!f) return []
  const source = sources.find(s => s.id === f.collect.source)

  return [{
    id,
    ext: f.extensions[0],
    name: f.name,
    category: categories.find(c => c.id === f.category)?.name ?? f.category,
    kind: f.category === 'raster' || f.category === 'terrain' ? 'raster' : 'vector',
    dataset: f.collect.dataset,
    attribution: f.collect.attribution ?? source?.attribution ?? source?.name ?? '',
    license: f.collect.license ?? source?.license ?? '',
  }]
}))
