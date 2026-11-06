import type { FormatSpec, Step } from '../../types.ts'
import { serverRecipes } from '../_server.ts'
import { SHP_OPEN, shpUnpack } from '../vector-2d/_vector.ts'
import { buildingRecipes, buildingUpload } from './_buildings.ts'

const ZIP = '/raw/gwacheon_buildings.zip'
// 배포 zip 안 폴더 이름에 기준일이 들어 있다. 다시 받아 날짜가 바뀌면 여기를 고친다
const RAW = `/vsizip/${ZIP}/경기도_과천시_새주소건물_20260818/새주소건물/TL_SPBD_BULD.SHP`

// 모든 레시피(파일 셋, 서버 둘)가 같이 쓰는 전처리: 국내 SHP의 좌표계·글자를 풀고 층수로 높이를 채운다
const preprocess: Step[] = [
  {
    title: '무결성 확인',
    why: '/vsizip/: 압축 해제 없이 열기. .prj·.cpg 없음 → 좌표계(중부원점 EPSG:5186)·인코딩(-oo ENCODING=CP949) 직접 지정. 지상층수: GRO_FLO_CO, 건물명: BULD_NM.',
    tool: 'gdal',
    run: `ogrinfo -so -al -oo ENCODING=CP949 ${RAW} | grep -E 'Geometry|Feature Count|BULD_NM|GRO_FLO_CO|UND_FLO_CO'`,
  },
  {
    title: '위경도 변환·층수로 높이 채우기',
    why: '-s_srs EPSG:5186: 좌표계 미표기 보완. -t_srs EPSG:4326: 위경도 변환. height: 지상층수×3m, 층수 없으면 9m. height_source: 사용 값 출처. -makevalid: 자기 교차 테두리 수정. -explodecollections: 그 결과 MultiPolygon → 다각형 단위(mago 3DTiler가 MultiPolygon 건너뜀).',
    tool: 'gdal',
    run: `ogr2ogr -f GeoJSON /work/buildings.geojson ${RAW} -oo ENCODING=CP949 -s_srs EPSG:5186 -t_srs EPSG:4326 -makevalid -explodecollections -dialect SQLite -sql "SELECT geometry, BULD_NM AS name, GRO_FLO_CO AS floors, CASE WHEN GRO_FLO_CO > 0 THEN GRO_FLO_CO * 3.0 ELSE 9.0 END AS height, CASE WHEN GRO_FLO_CO > 0 THEN '층수×3m' ELSE '기본값 9m' END AS height_source FROM TL_SPBD_BULD"`,
  },
]

export default {
  id: 'shp',
  category: 'vector-25d',
  name: 'Shapefile (높이·층수 속성)',
  extensions: ['.shp', '.zip'],
  summary: '바닥면에 높이·층수 속성을 붙인 Shapefile. 국내 건물 데이터의 가장 흔한 형태.',
  description: '대표: 국가공간정보포털·VWorld의 GIS건물통합정보. 도형은 2D 바닥면, 지상층수·높이는 속성(.dbf). 국내 SHP: 미터 평면 좌표계(EPSG:5186 등), CP949 인코딩, 높이 빈 건물 다수 → 전처리 핵심은 좌표계·인코딩·높이 채우기.',
  anatomy: [
    { name: '.shp / .shx', role: '바닥면 다각형·위치 목차' },
    { name: '.dbf', role: '속성. 열 이름 10자 제한 → GRO_FLO_CO(지상층수) 같은 약어' },
    { name: '.prj', role: '좌표계. 국내는 중부원점(EPSG:5186) 등 평면 좌표계 다수' },
    { name: '.cpg', role: '글자 인코딩. 없으면 CP949·UTF-8 판별 불가 → 한글 깨짐 위험' },
  ],
  convertible: true,
  collect: {
    source: 'datagokr',
    dataset: '경기도 과천시 공간정보(새주소건물) 15146680',
    url: 'https://www.data.go.kr/data/15146680/fileData.do',
    how: '공공데이터포털의 과천시 도로명주소 건물 SHP. 건물별 지상층수 포함.',
    license: '이용허락범위 제한 없음',
    attribution: '경기도 과천시 (공공데이터포털)',
    steps: [
      {
        title: '과천시 새주소건물 SHP 다운로드',
        why: '2단계: 파일 번호(atchFileId) 조회 → 다운로드. 번호는 데이터 갱신 시 바뀜 → 매번 조회. 로그인 불필요.',
        tool: 'curl',
        run: `FID=$(curl -sS 'https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?publicDataPk=15146680&publicDataDetailPk=uddi:04c8f370-277d-4c6d-a71f-8cb370aa31c5&fileDetailSn=1&publicDataTyCode=PR0051' | grep -oE '"atchFileId":"[^"]+' | head -1 | cut -d'"' -f4) && curl -sSL "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=$FID&fileDetailSn=1" -o ${ZIP}`,
      },
    ],
  },
  otherSources: [
    { source: 'nsdi', dataset: 'GIS건물통합정보 (시도별 SHP)', note: '건물별 지상층수·높이, 국내 대표 건물 데이터. 로그인 다운로드.' },
    { source: 'vworld', dataset: 'GIS건물통합정보 (지상층수·높이)', note: '같은 데이터. 약관상 재배포는 운영기관 확인 필요.' },
  ],
  recipes: [
    ...buildingRecipes(preprocess),
    ...serverRecipes({ category: 'vector-25d', layer: 'buildings', preprocess, work: '/work/buildings.geojson', geom: 'polygon', bounds: [126.964126, 37.402015, 127.036118, 37.465252], height: 'height' }),
  ],
  alternatives: [],
  upload: buildingUpload({
    accept: ['.zip'],
    note: '.shp, .shx, .dbf, .prj(, .cpg)를 zip 하나로 (폴더째 압축 OK, 여러 벌이면 가장 큰 1벌). .prj 없으면 판별 화면에서 좌표계 선택. 높이 열(HEIGHT …) 또는 층수 열(GRND_FLR, 지상층수 …) 사용, 없으면 9m.',
    open: SHP_OPEN,
    prepare: shpUnpack,
  }),
  view: { center: [126.9935, 37.4305], zoom: 15.6, pitch: 55, bearing: -20 },
} satisfies FormatSpec
