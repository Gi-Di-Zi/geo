// 2D 벡터 포맷 대부분은 "정리된 작업 파일 → GeoJSON(OGC API Features) + MVT" 변환이 같다. 전처리만 포맷마다 다르다.
import type { Output, Recipe, Step, Upload } from '../../types.ts'
import { serverRecipes, UPLOAD_LAYER } from '../_server.ts'

interface VectorRecipe {
  /** 전처리 결과 파일 (/work/...) */
  work: string
  /** 출력 레이어 이름. GeoJSON 컬렉션 id와 MVT 레이어 이름으로 함께 쓴다 */
  layer: string
  minzoom: number
  maxzoom: number
  /** 피처를 가르는 속성(식). 타일 전후 피처 수 비교에 쓴다 */
  key: string
  preprocess: Step[]
  /** 원본도 GeoJSON일 때 다시 만드는 이유. GeoJSON 결과물 설명을 대신한다 */
  sameWhy?: string
  /** MVT 폴더 범위 (GDAL이 쓴 tiles/metadata.json bounds를 바깥으로 반올림). GDAL은 빈 타일을 안 쓰므로 범위 밖 요청 = 404 */
  bounds?: Output['bounds']
}

/**
 * 무결성 확인: 타일로 바꾼 뒤 줌마다 피처가 몇 개 남았는지 센다. 변환 전후 같은 key 식의 고유 개수를 비교한다.
 * work = 변환 전 데이터(GDAL 경로), tiles = 줌 $z 타일을 여는 GDAL 인자 (폴더: /out/tiles/$z, PMTiles: -oo ZOOM_LEVEL=$z 파일)
 */
export function tileCount(t: { work: string; layer: string; key: string; tiles: string; minzoom: number; maxzoom: number }): Step {
  const sql = (cols: string) => `-dialect SQLite -sql "SELECT ${cols} FROM ${t.layer}"`
  return {
    title: '무결성 확인 (타일 전후 피처 수)',
    why: `줌마다 타일 속 고유 ${t.key} 수 = 남은 피처, 전체 행 = 조각(타일 경계에서 잘려 여러 타일에 든 것 포함). 피처가 변환 전보다 적으면 그 줌에서 사라진 피처(너무 작은 도형·밀집 제거). 줌 하나의 타일 전체 = GDAL 레이어 하나.`,
    tool: 'gdal',
    // awk가 ogrinfo 오류(없는 열 등)를 삼켜 종료 코드 0이 되므로, 변환 전 수를 못 읽으면 직접 실패시킨다
    run: `n() { ogrinfo -ro -q "$@" | awk '/ = /{print $NF}'; }\nb=$(n ${t.work} ${sql(`count(DISTINCT ${t.key})`)})\n[ -n "$b" ] || { echo "피처 수 읽기 실패: ${t.key}"; exit 1; }\necho "변환 전: 피처 $b"\nfor z in $(seq ${t.minzoom} ${t.maxzoom}); do set -- $(n ${t.tiles} ${sql(`count(DISTINCT ${t.key}), count(*)`)}); echo "줌 $z: 피처 $1, 조각 $2"; done`,
  }
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
      tileCount({ work: r.work, layer: r.layer, key: r.key, tiles: '/out/tiles/$z', minzoom: r.minzoom, maxzoom: r.maxzoom }),
    ],
    outputs: [
      { id: 'features', kind: 'geojson', path: `ogc/collections/${r.layer}/items.json`, label: 'GeoJSON', why: r.sameWhy ?? '파일 하나에 전체. 소규모 데이터에 가장 단순.' },
      { id: 'tiles', kind: 'mvt', path: 'tiles/{z}/{x}/{y}.pbf', minzoom: r.minzoom, maxzoom: r.maxzoom, layer: r.layer, bounds: r.bounds, label: 'MVT 벡터타일', why: '보이는 영역 타일만 요청. 대용량에 유리.' },
    ],
    viewers: {
      ol: { output: 'tiles' },
      maplibre: { output: 'tiles' },
      deck: { output: 'tiles' },
      cesium: { output: 'features', note: 'MVT 미지원 → GeoJSON 사용.' },
    },
  }
}

/**
 * tippecanoe 레시피: 전처리 결과 → GeoJSON → PMTiles 한 파일. GDAL 레시피(MVT 폴더)와 같은 줌 범위라 타일 전후 피처 수를 나란히 비교할 수 있다.
 * Cesium은 벡터타일을 못 읽는다 (GeoJSON은 GDAL 레시피 쪽). input = tippecanoe가 바로 읽는 원본(FlatGeobuf 등) → GeoJSON 추출 생략
 */
export function tippecanoeRecipe(r: Omit<VectorRecipe, 'sameWhy'> & { input?: { path: string; why: string } }): Recipe {
  return {
    id: 'tippecanoe',
    title: 'tippecanoe',
    preprocess: r.preprocess,
    convert: [
      ...(r.input ? [] : [{
        title: 'GeoJSON 추출',
        why: 'tippecanoe 입력 형식: GeoJSON(또는 FlatGeobuf).',
        tool: 'gdal',
        run: `ogr2ogr -f GeoJSON /work/${r.layer}.geojson ${r.work} -lco RFC7946=YES`,
      }]),
      {
        title: 'PMTiles 생성',
        why: `${r.input ? `${r.input.why} ` : ''}-Z${r.minzoom}·-z${r.maxzoom}: 줌 범위. -l ${r.layer}: 레이어 이름. --drop-densest-as-needed: 줌별 과밀 피처 제거. 결과: PMTiles 한 파일.`,
        tool: 'tippecanoe',
        run: `tippecanoe -o /out/${r.layer}.pmtiles -l ${r.layer} -Z${r.minzoom} -z${r.maxzoom} --drop-densest-as-needed --force ${r.input?.path ?? `/work/${r.layer}.geojson`}`,
      },
      tileCount({ work: r.work, layer: r.layer, key: r.key, tiles: `-oo ZOOM_LEVEL=$z /out/${r.layer}.pmtiles`, minzoom: r.minzoom, maxzoom: r.maxzoom }),
    ],
    outputs: [
      { id: 'pmtiles', kind: 'pmtiles', path: `${r.layer}.pmtiles`, minzoom: r.minzoom, maxzoom: r.maxzoom, layer: r.layer, label: 'PMTiles', why: '타일 전체 단일 파일. 정적 호스팅에 적합.' },
    ],
    viewers: {
      ol: { output: 'pmtiles' },
      maplibre: { output: 'pmtiles' },
      deck: { output: 'pmtiles', note: 'MVTLayer 타일 요청 → PMTiles 읽기로 교체.' },
      cesium: { unsupported: '벡터타일(PMTiles 포함) 미지원 → GeoJSON 별도 필요.' },
    },
  }
}

/** Python 단계 명령: 화면에 코드가 그대로 보이게 heredoc으로. config = GDAL 설정 (zip 안 한글 파일 이름 등) */
const py = (code: string, config?: Record<string, string>) =>
  `python3 - <<'PY'\nimport geopandas as gpd, pyogrio\n${config ? `pyogrio.set_gdal_config_options(${JSON.stringify(config)})\n` : ''}${code}\nPY`

/**
 * GeoPandas 레시피: GDAL 레시피와 같은 정리를 Python(GeoPandas + pyogrio)으로 → GeoJSON 한 파일 (OGC API Features 경로).
 * check·tidy = 포맷마다 다른 Python 코드. tidy는 위경도로 정리된 df를 만들고, 저장·내보내기는 여기서 붙인다
 */
export function geopandasRecipe(r: {
  layer: string
  config?: Record<string, string>
  check: { why: string; code: string }
  tidy: { title: string; why: string; code: string }
  output?: Partial<Output>
  viewers?: Recipe['viewers']
}): Recipe {
  const work = `/work/${r.layer}.gpkg`
  const path = `ogc/collections/${r.layer}/items.json`
  return {
    id: 'geopandas',
    title: 'GeoPandas',
    preprocess: [
      { title: '무결성 확인', why: r.check.why, tool: 'geopandas', run: py(r.check.code, r.config) },
      { title: r.tidy.title, why: `${r.tidy.why} to_file: GeoPackage 작업 파일.`, tool: 'geopandas', run: py(`${r.tidy.code}\ndf.to_file('${work}', layer='${r.layer}')\nprint(len(df), '피처 ·', df.crs.to_string())`, r.config) },
    ],
    convert: [
      {
        title: 'GeoJSON 내보내기 (OGC API Features 경로)',
        why: 'to_file(driver=GeoJSON): pyogrio(GDAL)로 쓰기. RFC7946=YES·COORDINATE_PRECISION=7: GDAL 레시피와 같은 생성 옵션 → 결과 비교 가능.',
        tool: 'geopandas',
        run: py(`gpd.read_file('${work}').to_file('/out/${path}', driver='GeoJSON', RFC7946='YES', COORDINATE_PRECISION=7)`),
      },
    ],
    outputs: [{ id: 'features', kind: 'geojson', path, label: 'GeoJSON', why: '정리된 전체 피처 한 파일. 네 뷰어 직접 읽기.', ...r.output }],
    viewers: r.viewers ?? {
      ol: { output: 'features' },
      maplibre: { output: 'features' },
      deck: { output: 'features' },
      cesium: { output: 'features' },
    },
  }
}

/**
 * 파일에 좌표계가 없을 때 판별 화면에서 고른 좌표계(작업의 SRS 환경 변수)를 원본 좌표계로 쓴다. 안 골랐으면 빈 값 → 파일 표기대로.
 * (TS 문자열 안의 셸 변수라 템플릿 리터럴이 아닌 따옴표 문자열로 둔다)
 */
export const SRC_SRS = '${SRS:+-s_srs $SRS }'

/**
 * 위경도로 정리한 벡터 검사: 도형 0건·좌표가 모두 범위 밖이면 중단, 범위 밖·빈 도형만 제외.
 * 범위를 /out/bounds.json에 남긴다(서버 결과의 확인 요청·시점). zoom: 벡터타일 최대 줌 하한(/work/minzoom)도 쓴다
 */
export const checkExtent = (file: string, zoom?: boolean): Step => ({
  title: '무결성 확인 (도형 수·좌표 범위)',
  why: `도형 0건이거나 좌표가 모두 위경도 범위 밖(좌표계 표기 없음·틀림)이면 여기서 중단 → 끝 단계의 엉뚱한 오류 대신 원인 표시. 일부만 밖이면(뒤바뀐 위도·경도, 빈 좌표) 그 피처만 제외. 범위 → bounds.json.${zoom ? ' 범위 폭으로 벡터타일 최대 줌 하한(도시 12 ~ 국가 9 ~ 세계 6): 하한 없으면 피처가 적을 때 줌 4 안팎 → 좌표 수백 m 단위 반올림, 넓은 범위를 12로 고정하면 면 타일 수백만 장.' : ''}`,
  tool: 'gdal',
  run: `python3 /scripts/check_extent.py ${file} --bounds /out/bounds.json${zoom ? ' --zoom /work/minzoom' : ''}`,
})

const uploadViewers = (tiles: string): Recipe['viewers'] => ({
  ol: { output: tiles },
  maplibre: { output: tiles },
  deck: { output: tiles },
  cesium: { output: 'features', note: '벡터타일 미지원 → GeoJSON 사용.' },
})

/**
 * 올린 벡터 파일: 레이어를 하나로 합쳐 위경도 GeoPackage(/work/data.gpkg)로 정리한 뒤 방식·도구별로
 * GDAL(GeoJSON + MVT 폴더) · tippecanoe(GeoJSON + PMTiles) · GeoServer · martin. 데이터 크기를 모르니 줌은 범위에서 정한다.
 * prepare = 열기 전 준비 단계(인코딩 등), opts = 읽을 때 붙이는 옵션(-oo 등. ogrinfo·ogr2ogr 공통), category = 서버 스타일 색
 */
export function vectorUpload(u: { accept: string[]; note: string; open?: string; prepare?: Step[]; opts?: string; category?: string }): Upload {
  const open = `${u.open ?? '$INPUT'}${u.opts ? ` ${u.opts}` : ''}`
  const preprocess: Step[] = [
    ...(u.prepare ?? []),
    {
      title: '무결성 확인',
      why: '레이어 이름·도형 종류·개수·범위·좌표계 확인.',
      tool: 'gdal',
      run: `ogrinfo -so -al ${open} | grep -E 'Layer name|Geometry:|Feature Count|Extent|PROJCRS|GEOGCRS'`,
    },
    {
      title: '단일 레이어·위경도 정리',
      why: '-addfields: 여러 레이어 → data 하나로 병합. -nlt GEOMETRY: 도형 종류 혼합 허용. -s_srs $SRS: 파일에 좌표계가 없을 때 판별 화면에서 고른 좌표계. -t_srs EPSG:4326: 위경도 변환. -makevalid: 꼬인 도형 수정.',
      tool: 'gdal',
      run: `ogr2ogr -f GPKG /work/data.gpkg ${open} -nln data -nlt GEOMETRY -addfields ${SRC_SRS}-t_srs EPSG:4326 -makevalid`,
    },
    checkExtent('/work/data.gpkg', true),
  ]
  const geojson: Step = {
    title: 'GeoJSON 내보내기 (OGC API Features 경로)',
    why: '-lco RFC7946=YES: 브라우저 표준 GeoJSON. COORDINATE_PRECISION=7: 좌표 7자리. GeoJSON 원본도 병합·위경도·도형 수정 반영해 재생성.',
    tool: 'gdal',
    run: 'ogr2ogr -f GeoJSON /out/ogc/collections/data/items.json /work/data.gpkg -lco RFC7946=YES -lco COORDINATE_PRECISION=7',
  }
  const features: Output = { id: 'features', kind: 'geojson', path: 'ogc/collections/data/items.json', label: 'GeoJSON', why: '정리된 전체 피처 한 파일. Cesium용.' }
  return {
    accept: u.accept,
    note: u.note,
    recipes: [
      {
        id: 'gdal',
        title: 'GDAL',
        preprocess,
        convert: [
          geojson,
          {
            title: 'MVT 벡터타일 분할',
            why: '줌별 z/x/y.pbf 타일 → 보이는 영역만 요청. MAXZOOM: 무결성 확인에서 정한 범위 기준 줌, MINZOOM: 그보다 6 낮게(멀리서도 보이게). -nln data: 레이어 이름. COMPRESS=NO: gzip 없이 저장(정적 서버가 그대로 응답).',
            tool: 'gdal',
            run: 'Z=$(cat /work/minzoom) && ogr2ogr -f MVT /out/tiles /work/data.gpkg -nln data -dsco MINZOOM=$((Z > 6 ? Z - 6 : 0)) -dsco MAXZOOM=$Z -dsco COMPRESS=NO',
          },
        ],
        outputs: [features, { id: 'tiles', kind: 'mvt', path: 'tiles/{z}/{x}/{y}.pbf', layer: 'data', label: 'MVT 벡터타일', why: '보이는 영역 타일만 요청. 줌 범위는 데이터 범위에서.' }],
        viewers: uploadViewers('tiles'),
      },
      {
        id: 'tippecanoe',
        title: 'tippecanoe',
        preprocess,
        convert: [
          geojson,
          {
            title: 'PMTiles 생성',
            why: '-zg: 데이터 크기 미지 → 줌 범위 자동 결정. --smallest-maximum-zoom-guess: 무결성 확인에서 정한 범위 기준 하한. --drop-densest-as-needed: 무거운 타일은 밀집 구간부터 피처 제거. --extend-zooms-if-still-dropping: 그래도 넘치면 최대 줌 확장. 진행률은 실시간 출력으로.',
            tool: 'tippecanoe',
            run: 'tippecanoe -o /out/data.pmtiles -l data -zg --smallest-maximum-zoom-guess=$(cat /work/minzoom) --drop-densest-as-needed --extend-zooms-if-still-dropping -f /out/ogc/collections/data/items.json',
          },
        ],
        outputs: [features, { id: 'tiles', kind: 'pmtiles', path: 'data.pmtiles', layer: 'data', label: 'PMTiles', why: '벡터타일 단일 파일. 보이는 영역만 Range 요청.' }],
        viewers: uploadViewers('tiles'),
      },
      ...serverRecipes({ category: u.category ?? 'vector-2d', layer: UPLOAD_LAYER, preprocess, work: '/work/data.gpkg', geom: 'any' }),
    ],
  }
}

/**
 * 올린 SHP zip에서 한 벌을 /work/src/data.*로 꺼내고 .dbf 인코딩 옵션을 /work/open_options에 남긴다 (pipeline/scripts/shp_unpack.py).
 * 이후 단계는 /work/src/data.shp를 연다
 */
export const SHP_OPEN = '/work/src/data.shp'
export const shpUnpack: Step = {
  title: 'SHP 꺼내기·인코딩 결정',
  why: 'zip 안 어느 폴더든 .shp 찾기(폴더째 압축 OK, 여러 벌이면 가장 큰 1벌) → data.*로 꺼냄: 한글·공백 파일 이름과 무관하게 열기. .cpg 없으면 .dbf 내용으로 인코딩 결정: UTF-8로 깨짐 없이 읽히면 UTF-8, 아니면 국내 SHP에 흔한 CP949(-oo ENCODING).',
  tool: 'gdal',
  run: 'python3 /scripts/shp_unpack.py $INPUT /work/src /work/open_options && echo "열기 옵션: $(cat /work/open_options)"',
}
