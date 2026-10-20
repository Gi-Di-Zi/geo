import { imageOthers, imageSpec } from './_image.ts'

export default imageSpec({
  id: 'webp',
  name: 'WebP',
  ext: '.webp',
  worldExt: '.wld',
  gdalFormat: 'WEBP',
  options: '-co QUALITY=80',
  summary: 'JPEG보다 작고 투명도도 담는 웹용 그림 포맷.',
  description: 'Google의 웹용 포맷. 같은 화질에서 JPEG보다 작고 투명도 지원. 지도 타일·COG 내부 압축에 주로 사용, 좌표 붙은 WebP 배포처는 못 찾음.',
  traits: '손실·무손실 모두 가능, 투명도 지원',
  closed: '월드파일 포함 WebP 공개 원본 없음. 주로 타일·COG 압축 등 웹 출력 형식.',
  base: 'none',
  srs: { epsg: 'EPSG:4326', label: '없음' },
  bounds: [0, 0, 0, 0],
  width: 0,
  collect: { source: 'copernicus', dataset: '없음', url: 'https://developers.google.com/speed/webp', how: '', steps: [] },
  otherSources: imageOthers,
  view: { center: [126.99, 37.55], zoom: 11.5 },
})
