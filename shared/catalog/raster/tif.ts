import type { FormatSpec, Recipe, Step } from '../../types.ts'
import { rasterUpload, toCog, toTiles, webViewers } from './cog.ts'

const TIF = '/raw/50110.tif'
// 제주시 범위 (위경도). XYZ 타일 범위에 쓴다
const JEJU: [number, number, number, number] = [126.133, 33.272, 126.972, 34.02]
// 산사태 위험 등급(1 매우 높음 ~ 5 낮음) → 색. nv = 값 없음(0) 투명
const RAMP = '1 215 48 39\\n2 252 141 89\\n3 254 224 139\\n4 145 207 96\\n5 26 152 80\\nnv 0 0 0 0'

const inspect: Step = {
  title: '무결성 확인 (블록·축소본)',
  why: 'Block=128x128: 내부 타일 구조. Overviews: 옆 파일 .ovr의 외부 축소본 → 파일 하나로 부분 읽기 불가, COG 규칙 미충족. Int32 1밴드, 값 1~5(위험 등급), NoData 0. EPSG:5181(중부원점).',
  tool: 'gdal',
  run: `gdalinfo -mm ${TIF} | grep -E 'Size is|PROJCRS|LAYOUT|COMPRESSION|Block=|Overviews|Min/Max|NoData'`,
}
const toRgb: Step = {
  title: '등급 → 색 (5단계)',
  why: 'gdaldem color-relief: 등급 1~5를 빨강~초록 RGB로 칠함. 값 그대로면 1~5 → 거의 검정. -alpha: 값 없는 칸(0) 투명.',
  tool: 'gdal',
  run: `printf '${RAMP}\\n' > /work/ramp.txt && gdaldem color-relief ${TIF} /work/ramp.txt /work/rgb.tif -alpha`,
}
const cog: Step = {
  ...toCog,
  why: `${toCog.why} 투명 밴드(-alpha) 유지.`,
  run: 'gdalwarp -t_srs EPSG:3857 -r near -of COG -co TILING_SCHEME=GoogleMapsCompatible -co COMPRESS=WEBP -co QUALITY=85 /work/rgb.tif /out/jeju_3857.tif',
}
const tiles: Step = {
  ...toTiles,
  why: '--min-zoom 9 --max-zoom 13: COG 미지원 뷰어용 256px 타일. 10m 격자 → 줌 13에서 원본 해상도. --num-threads 1: 이 COG는 GDAL 3.13 다중 스레드 복제 실패("Source dataset cannot be cloned") → 단일 스레드.',
  run: 'gdal raster tile --min-zoom 9 --max-zoom 13 -f WEBP --co QUALITY=80 --webviewer none --num-threads 1 /out/jeju_3857.tif /out/tiles',
}
const outputs: Recipe['outputs'] = [
  { id: 'cog', kind: 'cog', path: 'jeju_3857.tif', label: 'COG (EPSG:3857)', why: '외부 .ovr GeoTIFF → 축소본 내장 COG. 파일 하나, Range 요청으로 보이는 블록만 수신.' },
  { id: 'tiles', kind: 'xyz-raster', path: 'tiles/{z}/{x}/{y}.webp', minzoom: 9, maxzoom: 13, bounds: JEJU, label: 'XYZ 타일', why: '미리 자른 이미지 타일. 모든 지도 라이브러리 지원.' },
]

export default {
  id: 'tif',
  category: 'raster',
  name: 'GeoTIFF',
  extensions: ['.tif', '.tiff'],
  summary: '좌표가 붙은 TIFF 이미지. 위성영상·항공사진·주제도의 가장 흔한 형태.',
  description: 'TIFF 이미지 + 위치 태그(GeoKey). 원본 해상도 그대로 파일 하나. 축소본이 옆 파일(.ovr)이거나 없는 경우 많음 → 웹 부분 읽기 불리. 웹용: 축소본 내장 COG 또는 XYZ 타일로 변환.',
  anatomy: [
    { name: 'TIFF 태그', role: '가로·세로 픽셀 수, 밴드 수, 압축 방식, 블록(스트립·타일) 위치' },
    { name: 'GeoKey', role: '좌표계(EPSG), 픽셀 크기·원점. 지도 배치 기준' },
    { name: '밴드', role: '사진은 R·G·B 세 밴드, 주제도·높이 데이터는 한 밴드' },
    { name: '.tfw / .ovr / .aux.xml', role: '월드파일, 외부 축소본, 통계·색 정보. 이 샘플에 모두 포함' },
  ],
  convertible: true,
  collect: {
    source: 'datagokr',
    dataset: '산림청 산사태위험지도 15074817, 제주시(50110)',
    url: 'https://www.data.go.kr/data/15074817/fileData.do',
    how: '공공데이터포털 등록, 산림청 사이트에서 시군구별 zip 배포. 제주시 GeoTIFF(10m, 위험 등급 1~5).',
    license: '이용허락범위 제한 없음',
    attribution: '산림청 (공공데이터포털)',
    steps: [
      {
        title: '제주시 산사태위험지도 zip 다운로드',
        why: '공공데이터포털 연결 링크(산림청)의 시군구 코드별 zip. 로그인 불필요.',
        tool: 'curl',
        run: "curl -sSL 'https://www.forest.go.kr/kfsweb/opda/dataMng/fileDown.do?dataType=/sansatae/LDM_50110.zip' -o /work/ldm.zip",
      },
      {
        title: 'zip 해제 (GeoTIFF 묶음만)',
        why: 'zip 압축 방식이 LZMA(14) → GDAL /vsizip/ 미지원, Python zipfile로 해제. tif·tfw·ovr·aux.xml만, 설명 PDF 제외.',
        tool: 'gdal',
        run: `python3 -c "import zipfile; z = zipfile.ZipFile('/work/ldm.zip'); z.extractall('/raw', [n for n in z.namelist() if n.startswith('50110.tif') or n == '50110.tfw'])" && ls -la /raw`,
      },
    ],
  },
  otherSources: [
    { source: 'ngii', dataset: '정사영상 51cm TIF (도엽별)', note: '국내 항공사진. 로그인 후 다운로드, 공공누리 1유형(출처표시).' },
    { source: 'datagokr', dataset: '지자체 수치표고·주제도 TIF 파일데이터', note: '기관별 TIF 데이터셋. 라이선스는 데이터셋마다 다름.' },
  ],
  recipes: [
    {
      id: 'gdal',
      title: 'GDAL',
      preprocess: [inspect, toRgb],
      convert: [cog, tiles],
      outputs,
      viewers: webViewers,
    },
    {
      id: 'rio-cogeo',
      title: 'rio-cogeo (Python)',
      preprocess: [inspect, toRgb],
      convert: [
        {
          title: '웹 최적화 COG 생성 (rio-cogeo)',
          why: '--web-optimized: EPSG:3857 변환 + 블록 = 웹 타일 경계. --cog-profile webp: 압축·블록 크기 한 번에. -r nearest: 등급 색이 섞이지 않게.',
          tool: 'rio-cogeo',
          run: 'rio cogeo create /work/rgb.tif /out/jeju_3857.tif --web-optimized -r nearest --overview-resampling nearest --cog-profile webp --co WEBP_LEVEL=85 --quiet',
        },
        {
          title: '무결성 확인 (COG 규칙)',
          why: '블록 구조·오버뷰·헤더 위치 검사. 통과 시 "is a valid cloud optimized GeoTIFF".',
          tool: 'rio-cogeo',
          run: 'rio cogeo validate /out/jeju_3857.tif',
        },
        tiles,
      ],
      outputs,
      viewers: webViewers,
    },
  ],
  alternatives: [
    { tool: 'titiler', note: '타일 미리 굽기 없이 COG에서 요청마다 생성.' },
  ],
  upload: rasterUpload,
  view: { center: [126.55, 33.62], zoom: 9.6 },
} satisfies FormatSpec
