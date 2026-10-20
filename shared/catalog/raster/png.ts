import { HAMBURG_SRS, imageOthers, imageSpec } from './_image.ts'

const ZIP = '/vsizip//vsicurl/https://www.daten-hamburg.de/geographie_geologie_geobasisdaten/digitale_topographische_karte_50000/Digitale_Topographische_Karte_50000.zip'
const TILE = 'dtk50_32560_5920_20_sh_col'

export default imageSpec({
  id: 'png',
  name: 'PNG',
  ext: '.png',
  worldExt: '.pgw',
  gdalFormat: 'PNG',
  options: '-co ZLEVEL=9',
  summary: '무손실 압축 그림. 투명도를 담지만 사진은 용량이 크다.',
  description: '무손실 압축. 픽셀마다 색이 다른 항공·위성사진은 압축률 낮음. 선·글자 많은 지도, 투명 배경 오버레이에 적합. 색 적은 지도: 색상표(팔레트) PNG로 크게 축소.',
  traits: '무손실 압축, 색상표(팔레트)·투명도 지원',
  base: TILE,
  srs: HAMBURG_SRS,
  bounds: [9.907, 53.426, 10.203, 53.602],
  width: 2000,
  palette: true,
  collect: {
    source: 'hamburg',
    dataset: '함부르크 지형도 DTK50 (1:50,000), 도심 타일 32560_5920',
    url: 'https://suche.transparenz.hamburg.de/dataset/digitale-topographische-karte-1-50-000-hamburg9',
    how: '함부르크 지형도, 20km 타일별 PNG + 월드파일(.pgw) 배포. 도심 타일 하나.',
    derived: '타일 8개 zip(8.5MB) 중 도심 타일 하나(PNG + PGW)만. 형식 그대로.',
    steps: [
      {
        title: '도심 타일 하나 꺼내 받기',
        why: '/vsizip//vsicurl/: 원격 zip에서 PNG·월드파일만 복사.',
        tool: 'gdal',
        run: `gdal vsi copy ${ZIP}/${TILE}.png /raw/ && gdal vsi copy ${ZIP}/${TILE}.pgw /raw/`,
      },
    ],
  },
  otherSources: imageOthers,
  closed: '월드파일 포함 국내 PNG 공개 원본 없음.',
  view: { center: [10.0, 53.55], zoom: 10.5, basemap: 'osm' },
})
