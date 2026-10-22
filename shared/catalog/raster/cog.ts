import type { FormatSpec, Recipe, Step, Upload } from '../../types.ts'
import { geoserverRaster } from '../_server.ts'

export const TCI = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/52/S/CG/2026/5/S2B_52SCG_20260531_0_L2A/TCI.tif'

// 웹 메르카토르 COG → XYZ 타일. 일반 GeoTIFF(래스터 .tif)도 같은 단계와 출력을 쓴다
export const toCog: Step = {
  title: '웹 메르카토르 COG 재작성',
  why: '-t_srs EPSG:3857 + TILING_SCHEME=GoogleMapsCompatible: 블록 = 웹 타일 경계 → OpenLayers 재투영 없이 표시. COMPRESS=WEBP: 용량 축소. -dstalpha: 영상 밖 투명. 원본이 COG여도 격자·압축이 달라 재작성.',
  tool: 'gdal',
  run: 'gdalwarp -t_srs EPSG:3857 -r bilinear -dstalpha -of COG -co TILING_SCHEME=GoogleMapsCompatible -co COMPRESS=WEBP -co QUALITY=85 /raw/seoul_s2_tci.tif /out/seoul_3857.tif',
}
export const toTiles: Step = {
  title: 'XYZ 타일 굽기',
  why: '--min-zoom 10 --max-zoom 14: COG 미지원 뷰어용 256px 타일. -f WEBP: 투명 가장자리 유지, 작은 용량.',
  tool: 'gdal',
  run: 'gdal raster tile --min-zoom 10 --max-zoom 14 -f WEBP --co QUALITY=80 --webviewer none /out/seoul_3857.tif /out/tiles',
}
export const webOutputs: Recipe['outputs'] = [
  { id: 'cog', kind: 'cog', path: 'seoul_3857.tif', label: 'COG (EPSG:3857)', why: '원본도 COG — UTM 52N → EPSG:3857 격자, DEFLATE → WebP 압축으로 재작성. 파일 하나, Range 요청으로 보이는 블록만 수신.' },
  { id: 'tiles', kind: 'xyz-raster', path: 'tiles/{z}/{x}/{y}.webp', minzoom: 10, maxzoom: 14, bounds: [126.90, 37.48, 127.08, 37.62], label: 'XYZ 타일', why: '미리 자른 이미지 수백 장. 모든 지도 라이브러리 지원.' },
]
export const webViewers: Recipe['viewers'] = {
  ol: { output: 'cog', note: 'COG 직접 읽기 — 타일 굽기 불필요.' },
  maplibre: { output: 'tiles' },
  deck: { output: 'tiles' },
  cesium: { output: 'tiles' },
}


/** 올린 영상(GeoTIFF·COG): 8비트 RGB로 맞춘 뒤 샘플과 같은 COG + XYZ 타일. 줌 범위는 해상도에서 자동으로 정한다 */
export const rasterUpload: Upload = {
  accept: ['.tif', '.tiff'],
  note: '좌표 있는 영상. 16비트·다중 밴드: 앞 3밴드를 0~255로 변환. 높이 데이터(DEM)는 지형 페이지.',
  recipe: {
    id: 'upload',
    title: '내 파일',
    preprocess: [
      {
        title: '무결성 확인',
        why: '크기·좌표계·밴드 자료형·블록 구조·축소본 유무.',
        tool: 'gdal',
        run: "gdalinfo $INPUT | grep -E 'Size is|PROJCRS|GEOGCRS|LAYOUT|COMPRESSION|Block=|Overviews'",
      },
      {
        title: '8비트 RGB 변환',
        why: '웹 이미지(WebP·PNG): 0~255 3밴드(+투명도)만. 1밴드 → 회색 복제. 16비트 → 최솟값~최댓값을 0~255로 스트레치. 좌표 없음 → 서울시청 앞 배치.',
        tool: 'gdal',
        run: 'python3 /scripts/to_rgb.py $INPUT /work/rgb.vrt',
      },
    ],
    convert: [
      { ...toCog, run: toCog.run.replace('/raw/seoul_s2_tci.tif /out/seoul_3857.tif', '/work/rgb.vrt /out/web_3857.tif') },
      {
        ...toTiles,
        why: '--min-zoom: 영상 전체가 타일 두세 장에 걸치는 줌 (tile_grid.py 계산). 최대 줌: GDAL이 해상도로 결정. 시작 줌 없으면 최대 줌만 생성.',
        run: 'gdal raster tile --min-zoom $(python3 /scripts/tile_grid.py /out/web_3857.tif | cut -d" " -f1) -f WEBP --co QUALITY=80 --webviewer none /out/web_3857.tif /out/tiles',
      },
    ],
    outputs: [
      { id: 'cog', kind: 'cog', path: 'web_3857.tif', label: 'COG (EPSG:3857)', why: '파일 하나, Range 요청으로 보이는 블록만 수신. COG를 올려도 EPSG:3857 격자·WebP 압축으로 재작성.' },
      { id: 'tiles', kind: 'xyz-raster', path: 'tiles/{z}/{x}/{y}.webp', label: 'XYZ 타일', why: '미리 자른 이미지 타일. 모든 지도 라이브러리 지원.' },
    ],
    viewers: webViewers,
  },
}

const inspect: Step = {
  title: '무결성 확인',
  why: 'LAYOUT=COG·블록 크기·오버뷰 있으면 웹용 COG. 좌표계: UTM 52N (Sentinel-2 기본).',
  tool: 'gdal',
  run: "gdalinfo /raw/seoul_s2_tci.tif | grep -E 'Size is|PROJCRS|LAYOUT|COMPRESSION|Block=|Overviews'",
}

export default {
  id: 'cog',
  category: 'raster',
  name: 'COG (Cloud Optimized GeoTIFF)',
  extensions: ['.tif', '.cog.tif'],
  summary: '필요한 부분만 골라 읽도록 정리한 GeoTIFF. 확장자는 그대로 .tif.',
  description: '내부를 블록으로 나누고 축소본(오버뷰)을 넣은 GeoTIFF. 위치 정보(헤더)는 파일 맨 앞. HTTP Range 요청으로 필요한 조각만 수신. 서버 없이 파일 하나로 웹 지도 — OGC 표준.',
  anatomy: [
    { name: '헤더(IFD)', role: '파일 맨 앞. 크기, 좌표계, 블록별 위치(오프셋)' },
    { name: '블록', role: '512×512 등 작은 조각. 필요한 블록만 Range 요청' },
    { name: '오버뷰', role: '1/2, 1/4… 축소본. 멀리서 볼 때 사용' },
  ],
  convertible: true,
  collect: {
    source: 'copernicus',
    dataset: 'Sentinel-2 L2A 2026-05-31 TCI (트루컬러 10m)',
    url: 'https://registry.opendata.aws/sentinel-2-l2a-cogs/',
    how: 'Sentinel-2 영상: 처음부터 COG로 공개. 110km 원본 전체 대신 서울 중심부 블록만 Range 요청으로 저장.',
    steps: [
      {
        title: '서울 중심부 원격 잘라 받기',
        why: '/vsicurl/: 내려받기 없이 원격 파일 직접 열기. -projwin: 서울 중심부 범위 → COG라 해당 블록만 수신.',
        tool: 'gdal',
        run: `gdal_translate /vsicurl/${TCI} /raw/seoul_s2_tci.tif -projwin_srs EPSG:4326 -projwin 126.90 37.62 127.08 37.48 -of COG -co COMPRESS=DEFLATE`,
      },
    ],
  },
  otherSources: [
    { source: 'ngii', dataset: '정사영상 51cm TIF', note: '더 선명한 국내 항공사진. 로그인 후 다운로드 → COG 변환(.tif 페이지).' },
    { source: 'esa-worldcover', dataset: 'ESA_WorldCover_10m_2021_v200_N36E126_Map.tif', note: '수도권 포함 타일.' },
    { source: 'openaerialmap', dataset: 'OIN 영상 COG', note: '한국 커버리지 미확인.' },
    { source: 'planetary-computer', dataset: 'sentinel-2-l2a, landsat-c2-l2, esa-worldcover', note: '한국 포함.' },
  ],
  recipes: [
    {
      id: 'gdal',
      title: 'GDAL',
      preprocess: [inspect],
      convert: [
        toCog,
        toTiles,
      ],
      outputs: webOutputs,
      viewers: webViewers,
    },
    geoserverRaster({
      name: 's2_seoul',
      preprocess: [inspect],
      file: '/serve/raster/cog/s2_seoul.tif',
      prepare: {
        title: '원본 COG 그대로 서버 폴더에',
        why: '원본이 이미 COG(내부 블록·축소본) → 변환 없이 복사. 서버가 화면 범위·축척에 맞는 블록만 읽음. 좌표계(UTM 52N) 그대로, 웹 메르카토르 재투영은 요청마다.',
        tool: 'shell',
        run: 'mkdir -p /serve/raster/cog && cp /raw/seoul_s2_tci.tif /serve/raster/cog/s2_seoul.tif',
      },
      symbolizer: '      <Opacity>1.0</Opacity>',
      styleWhy: '트루컬러 RGB 3밴드 → 색 변환 없이 그대로.',
      bounds: [126.90, 37.48, 127.08, 37.62],
      maxzoom: 16,
    }),
  ],
  alternatives: [
    { tool: 'rio-cogeo', cmd: 'rio cogeo validate seoul_s2_tci.tif', note: 'Python COG 규칙 검사.' },
    { tool: 'titiler', note: '타일 미리 굽기 없이 COG에서 요청마다 생성.' },
  ],
  upload: { ...rasterUpload, accept: ['.tif'] },
  view: { center: [126.99, 37.55], zoom: 11.5 },
  noDomestic: '국내 기관 COG 배포처 없음. Sentinel-2 서울 영상은 해외(ESA).',
} satisfies FormatSpec
