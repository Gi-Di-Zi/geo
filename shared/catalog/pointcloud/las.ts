import { pointSpec } from './_points.ts'

const RAW = '/raw/chiak_sample.las'

const spec = pointSpec({
  id: 'las',
  name: 'LAS',
  ext: '.las',
  summary: '레이저 스캔 점군의 표준 포맷. 점마다 좌표·반사 강도·분류 코드.',
  description: 'ASPRS 이진 포맷. 점당 수십 바이트 → 비압축 시 수백 MB. 웹에서는 3D Tiles·COPC 같은 공간 분할 구조로 변환.',
  anatomy: [
    { name: '헤더', role: '버전, 점 개수, 범위, 좌표 배율(scale/offset)' },
    { name: 'VLR', role: '좌표계(WKT) 등 부가 정보. 비었거나 LOCAL_CS인 파일 많음' },
    { name: '점 레코드', role: 'X·Y·Z(정수, 배율 적용), 반사 강도, 반사 번호, 분류 코드, (형식에 따라) RGB' },
  ],
  collect: {
    source: 'datagokr',
    dataset: '국립공원공단 치악산 둘레길 실측데이터 15095240',
    url: 'https://www.data.go.kr/data/15095240/fileData.do',
    how: '공공데이터포털 LAS 원본(4족 보행 로봇 스캔). 점 수가 많아 20개 중 1개만 남긴 LAS를 샘플로.',
    license: '이용허락범위 제한 없음',
    attribution: '국립공원공단 (공공데이터포털)',
    derived: '원본 zip(212MB, LAS 486MB·점 1,351만 개)에서 20개 중 1개만 남김. 형식 그대로(LAS 1.4, 점 형식 7).',
    steps: [
      {
        title: '치악산 둘레길 LAS zip 다운로드',
        why: '공공데이터포털 2단계 다운로드: 파일 번호(atchFileId) 조회 → 다운로드. 로그인 불필요.',
        tool: 'curl',
        run: `FID=$(curl -sS 'https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?publicDataPk=15095240&publicDataDetailPk=uddi:9f32bc83-bd28-43b4-b9d4-f939df1ed635&fileDetailSn=1&publicDataTyCode=PR0051' | grep -oE '"atchFileId":"[^"]+' | head -1 | cut -d'"' -f4) && curl -sSL "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=$FID&fileDetailSn=1" -o /work/chiak.zip`,
      },
      {
        title: 'zip 해제',
        why: 'PDAL: zip 직접 읽기 불가 → LAS 추출.',
        tool: 'gdal',
        run: 'python3 -m zipfile -e /work/chiak.zip /work/ && ls -la /work/*.las',
      },
      {
        title: '20개 중 1개만 남기기',
        why: 'decimation step=20: 점 1,351만 → 약 68만. writers.las: LAS 1.4·점 형식 7(RGB) 유지, forward=all: 헤더 값 유지.',
        tool: 'pdal',
        run: `pdal translate "/work/ChiAk_Seg (1).las" ${RAW} decimation --filters.decimation.step=20 --writers.las.minor_version=4 --writers.las.dataformat_id=7 --writers.las.forward=all`,
      },
    ],
  },
  input: RAW,
  inspect: '점 수·높이 범위·속성. RGB 포함. 좌표계 VLR: LOCAL_CS(지역 좌표) → 좌표 범위상 동부원점(EPSG:5187)으로 판단.',
  srs: 'EPSG:5187',
  colorize: false,
  view: { center: [128.0717, 37.4224], zoom: 19.3, pitch: 60, bearing: -20 },
})

export default {
  ...spec,
  otherSources: [
    ...spec.otherSources,
    { source: 'datagokr', dataset: '인천지하철1호선 포인트클라우드 샘플 15111216', note: '역사 내부 LiDAR LAS, zip 약 140MB. 데이터 한계란에 공개제한 언급 → 확인 필요.' },
    { source: 'ngii', dataset: '정밀도로지도 점군 (MMS)', note: '로그인 후 다운로드. 점군 파일 형식 미확인.' },
  ],
}
