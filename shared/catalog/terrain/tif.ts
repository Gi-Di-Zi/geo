import { demSpec } from './_dem.ts'

const RAW = '/raw/BUKHANSAN_ASTGTM2.tif'

export default demSpec({
  id: 'tif',
  name: 'DEM GeoTIFF',
  extensions: ['.tif', '.tiff'],
  summary: '픽셀마다 높이(m)를 담은 GeoTIFF. 가장 흔한 지형 데이터 형태.',
  description: '픽셀마다 색(RGB) 대신 높이 값 하나. 브라우저는 높이 값 직접 표시 불가 → Terrain-RGB(높이를 색으로 인코딩한 이미지 타일) 또는 quantized-mesh(삼각형 메시)로 변환.',
  anatomy: [
    { name: '밴드 1', role: '높이(m). 이 샘플은 Int16 정수' },
    { name: 'NoData', role: '높이 없는 칸 표시 값 (-32768)' },
    { name: '높이 기준', role: 'ASTER GDEM: 해수면(EGM96 지오이드). Cesium: 타원체 → 보정 필요' },
  ],
  collect: {
    source: 'datagokr',
    dataset: '국립공원공단 국립공원 수치표고모델 공간데이터 15003715 (북한산)',
    url: 'https://www.data.go.kr/data/15003715/fileData.do',
    how: '공공데이터포털에 국립공원공단이 올린 북한산 DEM(ASTER GDEM 30m) GeoTIFF.',
    license: '이용허락범위 제한 없음',
    attribution: '국립공원공단 (공공데이터포털), ASTER GDEM (NASA·METI)',
    steps: [
      {
        title: '북한산 DEM zip 다운로드',
        why: '공공데이터포털 2단계 다운로드: 파일 번호(atchFileId) 조회 → 다운로드. 로그인 불필요.',
        tool: 'curl',
        run: `FID=$(curl -sS 'https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?publicDataPk=15003715&publicDataDetailPk=uddi:c5afb207-ff5e-4eb3-afec-c8e5c5a970c3&fileDetailSn=1&publicDataTyCode=PR0051' | grep -oE '"atchFileId":"[^"]+' | head -1 | cut -d'"' -f4) && curl -sSL "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=$FID&fileDetailSn=1" -o /work/dem.zip`,
      },
      {
        title: 'zip 해제 (GeoTIFF 묶음만)',
        why: 'tif·tfw·aux.xml만. 같은 높이를 그림으로 담은 BMP는 제외.',
        tool: 'gdal',
        run: `python3 -c "import zipfile; z = zipfile.ZipFile('/work/dem.zip'); z.extractall('/raw', [n for n in z.namelist() if n.startswith('BUKHANSAN_ASTGTM2.tif') and not n.endswith('.dbf') or n.endswith('.tfw')])" && ls -la /raw`,
      },
    ],
  },
  otherSources: [
    { source: 'ngii', dataset: '공개DEM (도엽별 IMG)', note: '더 촘촘한 국내 DEM(5m). 로그인 후 다운로드.' },
    { source: 'opentopography', dataset: 'Global DEM API: COP30 / SRTMGL1 / AW3D30 (GeoTIFF)', note: '한국 범위 추출 가능, API 키 필요.' },
    { source: 'planetary-computer', dataset: 'cop-dem-glo-30, alos-dem, nasadem (COG)', note: '한국 포함.' },
    { source: 'usgs-earthexplorer', dataset: 'SRTM 1 Arc-Second Global (GeoTIFF)', note: '한국 포함, 로그인 필요.' },
    { source: 'pdok', dataset: 'AHN4 DTM 0.5m', note: '네덜란드, COG, CC0.' },
    { source: 'nls-finland', dataset: 'dem2m (도엽별 .tif)', note: '핀란드 2m DEM.' },
  ],
  raw: RAW,
  accept: ['.tif', '.tiff'],
  // 줌 11 타일 1×2장(x 1746, y 791~792)에 맞춘 범위. 4096 대신 1024×2048 → 줌 13 해상도와 일치
  area: {
    extent: '14128008.81 4520180.1 14147576.69 4559315.86',
    size: '1024 2048',
    bounds: [126.9334, 37.5965, 127.0434, 37.7388],
    view: { center: [126.99, 37.655], zoom: 12.4, pitch: 60, bearing: -15 },
  },
})
