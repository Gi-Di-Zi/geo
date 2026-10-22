import { imageOthers, imageSpec } from './_image.ts'
import { RAMP } from './tif.ts'

export default imageSpec({
  id: 'webp',
  name: 'WebP',
  ext: '.webp',
  worldExt: '.wld',
  gdalFormat: 'WEBP',
  options: '-co QUALITY=80',
  summary: 'JPEG보다 작고 투명도도 담는 웹용 그림 포맷.',
  description: 'Google의 웹용 포맷. 같은 화질에서 JPEG보다 작고 투명도 지원. 지도 타일·COG 내부 압축에 주로 사용, 좌표 붙은 WebP 배포처는 못 찾음 → 국내 GeoTIFF(래스터 .tif와 같은 원본)를 WebP + 월드파일로 바꾼 샘플.',
  traits: '손실·무손실 모두 가능, 투명도 지원',
  base: '50110',
  srs: { epsg: 'EPSG:5181', label: '중부원점, EPSG:5181' },
  bounds: [126.142, 33.276, 126.97, 34.016],
  width: 2000,
  collect: {
    source: 'datagokr',
    dataset: '산림청 산사태위험지도 15074817, 제주시(50110)',
    url: 'https://www.data.go.kr/data/15074817/fileData.do',
    how: '래스터 .tif 샘플과 같은 zip. GeoTIFF를 색칠해 WebP + 월드파일로 저장.',
    converted: 'GeoTIFF(위험 등급 1~5) → 5단계 색 RGBA → 무손실 WebP + 월드파일(.wld). 래스터 .tif 샘플과 같은 원본.',
    license: '이용허락범위 제한 없음',
    attribution: '산림청 (공공데이터포털)',
    steps: [
      {
        title: '제주시 산사태위험지도 zip 다운로드',
        why: '래스터 .tif 샘플과 같은 zip. 로그인 불필요.',
        tool: 'curl',
        run: "curl -sSL 'https://www.forest.go.kr/kfsweb/opda/dataMng/fileDown.do?dataType=/sansatae/LDM_50110.zip' -o /work/ldm.zip",
      },
      {
        title: 'GeoTIFF 꺼내기',
        why: 'zip 압축 방식 LZMA(14) → GDAL /vsizip/ 미지원, Python zipfile로 해제.',
        tool: 'gdal',
        run: `python3 -c "import zipfile; zipfile.ZipFile('/work/ldm.zip').extract('50110.tif', '/work')"`,
      },
      {
        title: '등급 → 색 (5단계, 투명 배경)',
        why: 'WebP는 8비트 RGB(A)만 → 등급 1~5를 빨강~초록으로 칠함. -alpha: 값 없는 바다(0) 투명.',
        tool: 'gdal',
        run: `printf '${RAMP}\\n' > /work/ramp.txt && gdaldem color-relief /work/50110.tif /work/ramp.txt /work/rgb.tif -alpha`,
      },
      {
        title: '무손실 WebP + 월드파일 저장',
        why: 'LOSSLESS=YES: 색 5개뿐인 주제도 → 무손실이 더 작음. WORLDFILE=YES: 픽셀 크기·왼쪽 위 좌표를 .wld로. GDAL_PAM_ENABLED=NO: 좌표계 담은 .aux.xml 미생성 → "그림 + 월드파일"만 남김.',
        tool: 'gdal',
        run: 'gdal_translate --config GDAL_PAM_ENABLED NO -of WEBP -co LOSSLESS=YES -co WORLDFILE=YES /work/rgb.tif /raw/50110.webp && ls -la /raw',
      },
    ],
  },
  otherSources: imageOthers,
  noDomestic: '월드파일 포함 WebP 공개 원본 없음(국내·해외 모두). 주로 타일·COG 압축 등 웹 출력 형식.',
  view: { center: [126.55, 33.62], zoom: 9.3 },
})
