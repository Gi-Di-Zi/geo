import { HAMBURG_SRS, imageOthers, imageSpec } from './_image.ts'

const ZIP = '/vsizip//vsicurl/https://www.daten-hamburg.de/opendata/fernerkundung_luftbilder/dop_unbelaubt/DOP2020_unbelaubt_Hamburg.zip'
const TILE = 'dop20rgb_32_565_5933_1_hh_2020'

export default imageSpec({
  id: 'jpg',
  name: 'JPEG',
  ext: '.jpg',
  worldExt: '.jgw',
  gdalFormat: 'JPEG',
  options: '-co QUALITY=85',
  summary: '사진용 손실 압축 그림. 용량이 작고 투명도가 없다.',
  description: '눈에 덜 띄는 정보를 버려 사진 용량 축소. 항공·위성사진 배포에 오래 쓰임 — 타일 단위 정사영상 JPG + 월드파일 배포 다수. 투명도 없음 → 바깥 빈 곳 검정, 범위는 영상 안쪽으로 자르기.',
  traits: '손실 압축, 투명도 없음',
  base: TILE,
  srs: HAMBURG_SRS,
  bounds: [9.9812, 53.5419, 9.9959, 53.5507],
  width: 2500,
  collect: {
    source: 'hamburg',
    dataset: '함부르크 정사영상 DOP20 2020 (잎 없는 계절), 도심 타일 32_565_5933',
    url: 'https://suche.transparenz.hamburg.de/dataset?q=DOP20+unbelaubt+2020',
    how: '함부르크 20cm 항공사진, 1km 타일별 JPG + 월드파일(.jgw) 배포. 도심 타일 하나.',
    derived: '5.4GB 전체 zip 중 도심 1km 타일 하나(JPG + JGW)만. 형식 그대로.',
    steps: [
      {
        title: '도심 타일 하나 꺼내 받기',
        why: '/vsizip//vsicurl/: 원격 zip 목차를 Range 요청으로 읽기 → 5.4GB 전체 대신 필요한 파일 2개만 복사.',
        tool: 'gdal',
        run: `gdal vsi copy ${ZIP}/${TILE}.jpg /raw/ && gdal vsi copy ${ZIP}/${TILE}.jgw /raw/`,
      },
    ],
  },
  otherSources: imageOthers,
  closed: '월드파일 포함 국내 JPG 공개 원본 없음. 국토정보플랫폼 정사영상은 로그인 필요.',
  view: { center: [9.9885, 53.5463], zoom: 15.2, basemap: 'osm' },
})
