// DEM은 원본 포맷(GeoTIFF, ERDAS IMG …)만 다르고 Terrain-RGB·quantized-mesh로 바꾸는 과정은 같다
import type { FormatSpec, Step } from '../../types.ts'

/** 타일로 구울 범위: 줌 10 타일 경계에 맞춘 EPSG:3857 범위와 픽셀 크기, 데이터 범위(위경도), 처음 시점 */
interface DemArea {
  extent: string
  size: string
  bounds: [number, number, number, number]
  view: FormatSpec['view']
}
const calc = (band: string, expr: string) =>
  `gdal_calc -A /work/dem_3857.tif --outfile=/work/${band}.tif --calc="${expr}" --type=Byte --hideNoData --overwrite --quiet`

interface DemFormat {
  id: string
  name: string
  extensions: string[]
  summary: string
  description: string
  anatomy: FormatSpec['anatomy']
  collect: FormatSpec['collect']
  otherSources: FormatSpec['otherSources']
  /** 전처리에 쓸 원본 경로 */
  raw: string
  /** 원본을 mago-3d-terrainer가 못 읽을 때 GeoTIFF로 바꾸는 단계와 그 결과 경로 */
  toTiff?: Step & { path: string }
  /** 업로드로 받는 확장자 */
  accept: string[]
  area: DemArea
}

export function demSpec(f: DemFormat): FormatSpec {
  return {
  id: f.id,
  category: 'terrain',
  name: f.name,
  extensions: f.extensions,
  summary: f.summary,
  description: f.description,
  anatomy: f.anatomy,
  convertible: true,
  collect: f.collect,
  otherSources: f.otherSources,
  recipes: [
    {
      id: 'gdal-mago',
      title: 'GDAL + mago 3DTerrainer',
      preprocess: [
        ...(f.toTiff ? [f.toTiff] : []),
        {
          title: '무결성 확인',
          why: '-stats: 최저·최고·평균 높이(m). 격자 크기·좌표계 확인. GDAL_PAM_ENABLED NO: 원본 옆 .aux.xml 미생성.',
          tool: 'gdal',
          run: `gdalinfo -stats --config GDAL_PAM_ENABLED NO ${f.raw} | grep -E 'Size is|GEOGCRS|Pixel Size|STATISTICS_(MINIMUM|MAXIMUM|MEAN)'`,
        },
        {
          title: '웹 타일 격자 재투영',
          why: '-t_srs EPSG:3857 -te -ts: 웹 타일 경계에 정확히 맞춤. -ot Float32: 정수(Int16) 높이 → 실수, 다음 단계 인코딩 계산의 16비트 넘침 방지. -dstnodata 0: 빈칸 → 높이 0(해수면), -10000m 절벽 방지.',
          tool: 'gdal',
          run: `gdalwarp -t_srs EPSG:3857 -te ${f.area.extent} -ts ${f.area.size} -r bilinear -ot Float32 -dstnodata 0 ${f.raw} /work/dem_3857.tif`,
        },
      ],
      convert: [
        {
          title: 'Terrain-RGB 인코딩',
          why: '높이 = -10000 + (R×65536 + G×256 + B) × 0.1. gdal_calc: 실수 높이 → 0.1m 단위 정수 → R·G·B 세 바이트. gdalbuildvrt -separate: 세 밴드 묶기. 브라우저가 PNG에서 높이로 복원.',
          tool: 'gdal',
          run: [
            calc('r', 'floor((A+10000)*10/65536)'),
            calc('g', 'floor((A+10000)*10/256)%256'),
            calc('b', 'floor((A+10000)*10)%256'),
            'gdalbuildvrt -separate /work/rgb.vrt /work/r.tif /work/g.tif /work/b.tif',
          ].join(' && '),
        },
        {
          title: 'Terrain-RGB 타일 굽기',
          why: '-r nearest --overview-resampling nearest: 인코딩 색이 섞이면 엉뚱한 높이 → 평균 대신 최근접. PNG: 무손실 필수. --skip-blank: 빈 타일 생략.',
          tool: 'gdal',
          run: 'gdal raster tile --min-zoom 10 --max-zoom 13 --skip-blank -r nearest --overview-resampling nearest --webviewer none /work/rgb.vrt /out/terrain-rgb',
        },
        {
          title: 'Cesium용 quantized-mesh 생성',
          why: 'Cesium 지형: 높이 이미지 대신 삼각형 메시 타일. 평지는 큰 삼각형, 험지는 작은 삼각형 → 용량 절감. -g EGM2008: 지오이드 → 타원체 높이 보정. -max 13: 최대 줌.',
          tool: 'mago-3d-terrainer',
          run: `mago-3d-terrainer -i ${f.toTiff?.path ?? f.raw} -o /out/terrain -g EGM2008 -max 13 -q`,
        },
      ],
      outputs: [
        { id: 'rgb', kind: 'terrain-rgb', path: 'terrain-rgb/{z}/{x}/{y}.png', minzoom: 10, maxzoom: 13, bounds: f.area.bounds, label: 'Terrain-RGB 타일', why: '높이를 색으로 담은 PNG 타일. MapLibre·Deck.gl용.' },
        { id: 'mesh', kind: 'quantized-mesh', path: 'terrain', label: 'quantized-mesh 타일', why: '삼각형 메시 타일(.terrain) + 목록(layer.json). Cesium 전용.' },
      ],
      viewers: {
        ol: { unsupported: '2D 지도 — 지형 입체 미지원.' },
        maplibre: { output: 'rgb' },
        deck: { output: 'rgb' },
        cesium: { output: 'mesh' },
      },
    },
  ],
  alternatives: [
    { tool: 'rio-rgbify', cmd: 'rio rgbify -b -10000 -i 0.1 seoul_dem.tif rgb.tif', note: 'Terrain-RGB 인코딩 한 줄. 2022년 이후 업데이트 없음.' },
    { tool: 'titiler', note: 'COG DEM에서 요청마다 Terrain-RGB 타일 생성.' },
    { tool: 'ctb', cmd: 'ctb-tile -f Mesh -C -N -o terrain seoul_dem.tif', note: '구형 quantized-mesh 생성기. 결과 gzip → 압축 해제 필요.' },
    { tool: 'quantized-mesh-encoder', note: 'Python 메시 직접 생성.' },
  ],
  upload: {
    accept: f.accept,
    note: '높이 1밴드 DEM. 범위·줌은 파일에서 결정. 높이 기준: 해수면(지오이드).',
    recipe: {
      id: 'upload',
      title: '내 파일',
      preprocess: [
        {
          title: '무결성 확인',
          why: '-mm: 최저·최고 높이. 좌표계, 격자 크기, 빈칸(NoData) 값.',
          tool: 'gdal',
          run: "gdalinfo -mm $INPUT | grep -E 'Size is|PROJCRS|GEOGCRS|Pixel Size|NoData|Computed Min/Max'",
        },
        {
          title: '웹 타일 격자 재투영',
          why: 'tile_grid.py: 타일 두세 장에 걸치는 기준 줌·타일 경계 범위 계산. -t_srs EPSG:3857 -te: 그 경계까지 확장. -ot Float32: 정수 높이도 실수로, 인코딩 계산 넘침 방지. -dstnodata 0: 넓힌 곳·빈칸 → 높이 0, 가장자리 -10000m 절벽 방지.',
          tool: 'gdal',
          run: 'set -- $(python3 /scripts/tile_grid.py $INPUT) && echo $1 > /work/minzoom && echo "기준 줌 $1" && gdalwarp -t_srs EPSG:3857 -te $2 $3 $4 $5 -r bilinear -ot Float32 -dstnodata 0 $INPUT /work/dem_3857.tif',
        },
        {
          title: 'Cesium용 위경도 GeoTIFF 생성',
          why: 'mago 3DTerrainer 입력: 위경도(EPSG:4326) GeoTIFF. -t_srs EPSG:4326: 다른 좌표계·.img도 여기서 변환.',
          tool: 'gdal',
          run: 'gdalwarp -t_srs EPSG:4326 -r bilinear -of GTiff -co COMPRESS=DEFLATE $INPUT /work/dem_4326.tif',
        },
      ],
      convert: [
        {
          title: 'Terrain-RGB 인코딩',
          why: '높이 = -10000 + (R×65536 + G×256 + B) × 0.1. 샘플과 같은 계산.',
          tool: 'gdal',
          run: [
            calc('r', 'floor((A+10000)*10/65536)'),
            calc('g', 'floor((A+10000)*10/256)%256'),
            calc('b', 'floor((A+10000)*10)%256'),
            'gdalbuildvrt -separate /work/rgb.vrt /work/r.tif /work/g.tif /work/b.tif',
          ].join(' && '),
        },
        {
          title: 'Terrain-RGB 타일 굽기',
          why: '--min-zoom: 기준 줌 → 해상도에 맞는 최대 줌까지. -r nearest: 인코딩 색 섞임 방지.',
          tool: 'gdal',
          run: 'gdal raster tile --min-zoom $(cat /work/minzoom) --skip-blank -r nearest --overview-resampling nearest --webviewer none /work/rgb.vrt /out/terrain-rgb',
        },
        {
          title: 'Cesium용 quantized-mesh 생성',
          why: '삼각형 메시 타일. -g EGM2008: 지오이드 → 타원체 높이 보정. -max 14: 최대 줌.',
          tool: 'mago-3d-terrainer',
          run: 'mago-3d-terrainer -i /work/dem_4326.tif -o /out/terrain -g EGM2008 -max 14 -q',
        },
      ],
      outputs: [
        { id: 'rgb', kind: 'terrain-rgb', path: 'terrain-rgb/{z}/{x}/{y}.png', label: 'Terrain-RGB 타일', why: '높이를 색으로 담은 PNG 타일. MapLibre·Deck.gl용.' },
        { id: 'mesh', kind: 'quantized-mesh', path: 'terrain', label: 'quantized-mesh 타일', why: '삼각형 메시 타일 + 목록(layer.json). Cesium 전용.' },
      ],
      viewers: {
        ol: { unsupported: '2D 지도 — 지형 입체 미지원.' },
        maplibre: { output: 'rgb' },
        deck: { output: 'rgb' },
        cesium: { output: 'mesh' },
      },
    },
  },
  view: f.area.view,
}
}
