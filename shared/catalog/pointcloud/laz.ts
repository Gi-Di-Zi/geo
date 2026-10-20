import { pointSpec } from './_points.ts'

const RAW = '/raw/sf_05250295.laz'
const LPC = 'https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_SanFrancisco_B23/CA_SanFrancisco_1_B23'

const spec = pointSpec({
  id: 'laz',
  name: 'LAZ',
  ext: '.laz',
  summary: 'LAS의 무손실 압축 형식. 같은 점군이 약 4분의 1 크기.',
  description: 'LASzip 점 레코드 압축. 내용은 LAS와 동일 → PDAL·py3dtiles 등 직접 지원. 공공 점군 배포 대부분 LAZ. 공간 인덱스 포함 COPC도 확장자 .copc.laz.',
  anatomy: [
    { name: '헤더·VLR', role: 'LAS와 동일. LASzip VLR: 압축 방식' },
    { name: '청크', role: '점 약 5만 개 단위 압축 덩어리' },
    { name: 'EVLR', role: 'LAS 1.4+ 파일 끝 확장 레코드. 좌표계 WKT 저장 위치(일부 파일)' },
  ],
  collect: {
    source: 'usgs-3dep',
    dataset: 'USGS LPC CA_SanFrancisco_B23, 타일 05250295 (엠바카데로 일대)',
    url: 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/LPC/Projects/CA_SanFrancisco_B23/CA_SanFrancisco_1_B23/0_file_download_links.txt',
    how: 'USGS 500m 타일별 LAZ 배포본 중 샌프란시스코 항공 LiDAR 1장, 그대로.',
    steps: [
      {
        title: '엠바카데로 일대 LAZ 타일 다운로드',
        why: '타일 1개(39MB, 점 719만 개). --retry 5 --retry-all-errors: 배포 서버 잦은 끊김 대비 재시도.',
        tool: 'curl',
        run: `curl -sSL --retry 5 --retry-all-errors ${LPC}/LAZ/USGS_LPC_CA_SanFrancisco_B23_05250295.laz -o ${RAW}`,
      },
    ],
  },
  input: RAW,
  inspect: '점 수·높이 범위·속성. 좌표계: EVLR의 WKT(샌프란시스코 시 좌표계 CS13 + NAVD88 높이). RGB 없음.',
  colorize: true,
  decimate: 3,
  view: { center: [-122.396, 37.8018], zoom: 16, pitch: 60, bearing: -30, basemap: 'osm' },
})

export default { ...spec, closed: '국내 LAZ 공개 원본 없음. 공공데이터포털 점군은 LAS(LAS 참고).' }
