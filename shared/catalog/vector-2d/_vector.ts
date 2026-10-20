// 2D 벡터 포맷 대부분은 "정리된 작업 파일 → GeoJSON(OGC API Features) + MVT" 변환이 같다. 전처리만 포맷마다 다르다.
import type { Recipe, Step, Upload } from '../../types.ts'

interface VectorRecipe {
  /** 전처리 결과 파일 (/work/...) */
  work: string
  /** 출력 레이어 이름. GeoJSON 컬렉션 id와 MVT 레이어 이름으로 함께 쓴다 */
  layer: string
  minzoom: number
  maxzoom: number
  preprocess: Step[]
  /** 원본도 GeoJSON일 때 다시 만드는 이유. GeoJSON 결과물 설명을 대신한다 */
  sameWhy?: string
}

export function vectorRecipe(r: VectorRecipe): Recipe {
  return {
    id: 'gdal',
    title: 'GDAL',
    preprocess: r.preprocess,
    convert: [
      {
        title: 'GeoJSON 내보내기 (OGC API Features 경로)',
        why: `${r.sameWhy ? '원본도 GeoJSON — 전처리 결과 반영해 재생성. ' : ''}-lco RFC7946=YES: 브라우저 표준 GeoJSON. COORDINATE_PRECISION=7: 좌표 7자리. /collections/{id}/items: OGC API Features 경로, 실서버 이전 용이.`,
        tool: 'gdal',
        run: `ogr2ogr -f GeoJSON /out/ogc/collections/${r.layer}/items.json ${r.work} -nln ${r.layer} -lco RFC7946=YES -lco COORDINATE_PRECISION=7`,
      },
      {
        title: 'MVT 벡터타일 분할',
        why: '줌별 z/x/y.pbf 타일 → 보이는 영역만 요청. -nln: 레이어 이름(뷰어 스타일에서 참조). MINZOOM·MAXZOOM: 줌 범위. COMPRESS=NO: gzip 없이 저장.',
        tool: 'gdal',
        run: `ogr2ogr -f MVT /out/tiles ${r.work} -nln ${r.layer} -dsco MINZOOM=${r.minzoom} -dsco MAXZOOM=${r.maxzoom} -dsco COMPRESS=NO`,
      },
    ],
    outputs: [
      { id: 'features', kind: 'geojson', path: `ogc/collections/${r.layer}/items.json`, label: 'GeoJSON', why: r.sameWhy ?? '파일 하나에 전체. 소규모 데이터에 가장 단순.' },
      { id: 'tiles', kind: 'mvt', path: 'tiles/{z}/{x}/{y}.pbf', minzoom: r.minzoom, maxzoom: r.maxzoom, layer: r.layer, label: 'MVT 벡터타일', why: '보이는 영역 타일만 요청. 대용량에 유리.' },
    ],
    viewers: {
      ol: { output: 'tiles' },
      maplibre: { output: 'tiles' },
      deck: { output: 'tiles' },
      cesium: { output: 'features', note: 'MVT 미지원 → GeoJSON 사용.' },
    },
  }
}

export const BBOX = '126.970 37.555 126.990 37.570'
export const BBOX_CSV = '126.970,37.555,126.990,37.570'

/**
 * 올린 벡터 파일: 레이어를 하나로 합치고 GeoJSON + PMTiles로. 데이터 크기를 모르니 줌 범위는 tippecanoe가 정한다.
 * prepare = 열기 전 준비 단계(인코딩 등), opts = 읽을 때 붙이는 옵션(-oo, -spat 등. ogrinfo·ogr2ogr 공통)
 */
export function vectorUpload(u: { accept: string[]; note: string; open?: string; prepare?: Step[]; opts?: string }): Upload {
  const open = `${u.open ?? '$INPUT'}${u.opts ? ` ${u.opts}` : ''}`
  return {
    accept: u.accept,
    note: u.note,
    recipe: {
      id: 'upload',
      title: '내 파일',
      preprocess: [
        ...(u.prepare ?? []),
        {
          title: '무결성 확인',
          why: '레이어 이름·도형 종류·개수·범위·좌표계 확인.',
          tool: 'gdal',
          run: `ogrinfo -so -al ${open} | grep -E 'Layer name|Geometry:|Feature Count|Extent|PROJCRS|GEOGCRS'`,
        },
        {
          title: '단일 레이어·위경도 정리',
          why: '-addfields: 여러 레이어 → data 하나로 병합. -nlt GEOMETRY: 도형 종류 혼합 허용. -t_srs EPSG:4326: 위경도 변환. -makevalid: 꼬인 도형 수정.',
          tool: 'gdal',
          run: `ogr2ogr -f GPKG /work/data.gpkg ${open} -nln data -nlt GEOMETRY -addfields -t_srs EPSG:4326 -makevalid`,
        },
      ],
      convert: [
        {
          title: 'GeoJSON 내보내기 (OGC API Features 경로)',
          why: '-lco RFC7946=YES: 브라우저 표준 GeoJSON. COORDINATE_PRECISION=7: 좌표 7자리. GeoJSON 원본도 병합·위경도·도형 수정 반영해 재생성.',
          tool: 'gdal',
          run: 'ogr2ogr -f GeoJSON /out/ogc/collections/data/items.json /work/data.gpkg -lco RFC7946=YES -lco COORDINATE_PRECISION=7',
        },
        {
          title: 'PMTiles 생성',
          why: '-zg: 데이터 크기 미지 → 줌 범위 자동 결정. --smallest-maximum-zoom-guess=12: 피처가 적어도 최대 줌 12 이상(낮으면 좌표가 수백 m 단위로 반올림). --drop-densest-as-needed: 무거운 타일은 밀집 구간부터 피처 제거. --extend-zooms-if-still-dropping: 그래도 넘치면 최대 줌 확장. GDAL MVT(샘플 방식)는 줌 범위 수동 지정 필요.',
          tool: 'tippecanoe',
          run: 'tippecanoe -q -o /out/data.pmtiles -l data -zg --smallest-maximum-zoom-guess=12 --drop-densest-as-needed --extend-zooms-if-still-dropping -f /out/ogc/collections/data/items.json',
        },
      ],
      outputs: [
        { id: 'features', kind: 'geojson', path: 'ogc/collections/data/items.json', label: 'GeoJSON', why: '정리된 전체 피처 한 파일. Cesium용.' },
        { id: 'tiles', kind: 'pmtiles', path: 'data.pmtiles', layer: 'data', label: 'PMTiles', why: '벡터타일 단일 파일. 보이는 영역만 Range 요청.' },
      ],
      viewers: {
        ol: { output: 'tiles' },
        maplibre: { output: 'tiles' },
        deck: { output: 'tiles' },
        cesium: { output: 'features', note: '벡터타일 미지원 → GeoJSON 사용.' },
      },
    },
  }
}

/**
 * 올린 SHP zip의 한글 처리 옵션을 /work/open_options에 남긴다.
 * .cpg가 없으면 .dbf를 CP949로, zip 안 파일 이름이 UTF-8 표시(0x800) 없는 한글이면 이름도 CP949로 읽는다
 */
export const shpEncoding: Step = {
  title: '한글 인코딩 결정',
  why: '.cpg: .dbf 글자 인코딩. 없으면 국내 SHP에 흔한 CP949(EUC-KR)로 열기(-oo ENCODING=CP949). zip 안 파일 이름이 UTF-8 표시 없는 한글이면 CPL_ZIP_ENCODING CP949(안 하면 레이어 이름 깨짐·목록 실패).',
  tool: 'gdal',
  run: `python3 -c "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]).infolist(); cpg = any(i.filename.lower().endswith('.cpg') for i in z); cp949 = any(not i.flag_bits & 0x800 and not i.filename.isascii() for i in z); print(' '.join(o for o, on in [('-oo ENCODING=CP949', not cpg), ('--config CPL_ZIP_ENCODING CP949', cp949)] if on))" $INPUT > /work/open_options && echo "열기 옵션: $(cat /work/open_options)"`,
}
