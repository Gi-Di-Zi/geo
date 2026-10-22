import { demSpec } from './_dem.ts'

const NAME = 'ned19_n38x00_w122x50_ca_goldengate_2010'
const ZIP = '/raw/goldengate_img.zip'
const RAW = `/vsizip/${ZIP}/${NAME}.img`

const spec = demSpec({
  id: 'img',
  name: 'ERDAS IMAGINE (.img)',
  extensions: ['.img'],
  summary: 'ERDAS IMAGINE의 래스터 형식. 국토정보플랫폼 공개DEM이 이 형식.',
  description: 'GeoTIFF 이전 래스터 형식. 국내 공공 DEM·위성영상 배포에 아직 다수. 파일 하나에 밴드·통계·좌표계를 트리 구조(HFA)로 저장. GDAL은 지원, 웹 도구는 GeoTIFF 전용이 많아 GeoTIFF 선변환.',
  anatomy: [
    { name: '.img', role: '높이 격자와 좌표계, 통계를 담은 본 파일 (HFA 트리 구조)' },
    { name: '.rrd', role: '축소 영상(피라미드). 없으면 확대·축소마다 원본 읽기' },
    { name: '.ige', role: '2GB 초과분 데이터 파일' },
    { name: '.aux.xml', role: 'GDAL 계산 통계 파일' },
  ],
  collect: {
    source: 'usgs-3dep',
    dataset: 'USGS NED 1/9 arc-second DEM, 금문교 일대 (ned19_n38x00_w122x50_ca_goldengate_2010)',
    url: 'https://prd-tnm.s3.amazonaws.com/index.html?prefix=StagedProducts/Elevation/19/IMG/',
    how: 'USGS 1/9초(약 3m) DEM, ERDAS IMG 타일 하나. zip 그대로.',
    steps: [
      {
        title: '금문교 일대 IMG zip 받기',
        why: '배포 zip(38MB). 내용: .img(47MB, 8112×8112), 좌표계·메타데이터 파일.',
        tool: 'curl',
        run: `curl -sSL --retry 3 https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/19/IMG/${NAME}.zip -o ${ZIP}`,
      },
    ],
  },
  otherSources: [
    { source: 'ngii', dataset: '공개DEM (90m·5m, 도엽별 IMG zip)', note: '국내 공식 DEM. 로그인 후 다운로드, 공공누리 1유형(출처표시). 서울: 도엽 37608.' },
  ],
  raw: RAW,
  accept: ['.img'],
  toTiff: {
    title: 'GeoTIFF 변환',
    why: 'GDAL은 .img 그대로, mago 3DTerrainer는 GeoTIFF 전용("No GeoTiff files found"). -t_srs EPSG:4326: NAD83 위경도 → WGS84, 높이 값 유지. PREDICTOR=3: 실수 압축 효율.',
    tool: 'gdal',
    run: `gdalwarp -t_srs EPSG:4326 -of GTiff -co COMPRESS=DEFLATE -co PREDICTOR=3 ${RAW} /work/dem.tif`,
    path: '/work/dem.tif',
  },
  // 줌 10 타일 2×2장(x 163~164, y 394~395)에 맞춘 범위. 데이터 밖(바다)은 높이 0으로 채운다
  area: {
    extent: '-13658379.71 4539747.99 -13580108.19 4618019.50',
    size: '4096 4096',
    bounds: [-122.5, 37.75, -122.25, 38.0],
    view: { center: [-122.43, 37.83], zoom: 11.8, pitch: 60, bearing: -20, basemap: 'osm' },
  },
})

export default { ...spec, noDomestic: '국내 IMG DEM은 국토정보플랫폼 공개DEM뿐. 로그인 필요 → 자동 수집 불가.' }
