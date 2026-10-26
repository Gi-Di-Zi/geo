// 2.5D 건물: 높이를 채운 /work/buildings.geojson(name, height, height_source)을 받아 세 도구로 세운다.
// 원본 형식(GeoJSON, SHP …)마다 다른 건 높이를 채우는 전처리뿐이다
import type { Recipe, Step, Upload } from '../../types.ts'
import { serverRecipes, UPLOAD_LAYER } from '../_server.ts'
import { checkExtent, SRC_SRS } from '../vector-2d/_vector.ts'

const no3dTiles = {
  ol: { unsupported: '2D 지도 — 건물 돌출 미지원.' },
  maplibre: { unsupported: '3D Tiles 미지원 → GeoJSON 레시피에서 fill-extrusion으로 돌출.' },
}

/** sameWhy: 원본도 GeoJSON일 때 다시 만드는 이유. GeoJSON 결과물 설명을 대신한다 */
export function buildingRecipes(preprocess: Step[], sameWhy?: string): Recipe[] {
  return [
    {
      id: 'gdal',
      title: 'GDAL',
      preprocess,
      convert: [
        {
          title: 'GeoJSON 내보내기 (OGC API Features 경로)',
          why: `${sameWhy ? '원본도 GeoJSON — 전처리 결과 반영해 재생성. ' : ''}건물 수천 동은 GeoJSON 한 파일로 충분. COORDINATE_PRECISION=7: 좌표 자릿수 축소 → 용량 절감.`,
          tool: 'gdal',
          run: 'ogr2ogr -f GeoJSON /out/ogc/collections/buildings/items.json /work/buildings.geojson -lco RFC7946=YES -lco COORDINATE_PRECISION=7',
        },
      ],
      outputs: [
        { id: 'features', kind: 'geojson', path: 'ogc/collections/buildings/items.json', style: { height: 'height' }, label: 'GeoJSON (height 속성)', why: sameWhy ?? '뷰어가 height 값만큼 바닥면 돌출.' },
      ],
      viewers: {
        ol: { unsupported: '2D 지도 — 건물 돌출 미지원.' },
        maplibre: { output: 'features', note: 'fill-extrusion 레이어로 돌출.' },
        deck: { output: 'features', note: 'GeoJsonLayer extruded 옵션으로 돌출.' },
        cesium: { output: 'features', note: '다각형별 extrudedHeight로 돌출.' },
      },
    },
    {
      id: 'mago',
      title: 'mago 3DTiler',
      preprocess,
      convert: [
        {
          title: '3D Tiles 생성 (높이 돌출)',
          why: '-hc height: 바닥면을 height만큼 돌출한 메시 → 타일 분할. -c 4326: 입력 좌표계. 입력은 이름·높이만 남긴 파일(속성 복잡 시 실패 방지).',
          tool: 'mago-3d-tiler',
          run: 'mkdir -p /work/in && cp /work/buildings.geojson /work/in/ && mago-3d-tiler -i /work/in -o /out/tiles -it geojson -c 4326 -hc height -tv 1.0 -q',
        },
      ],
      outputs: [
        { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (b3dm)', why: '건물 메시를 미리 만든 타일. 수십만 동도 보이는 영역만 요청.' },
      ],
      viewers: { ...no3dTiles, deck: { output: 'tiles' }, cesium: { output: 'tiles' } },
    },
    {
      id: 'postgis',
      title: 'PostGIS + pg2b3dm',
      preprocess,
      convert: [
        {
          title: 'PostGIS 적재',
          why: '높이 채운 건물 → 테이블. -nlt PROMOTE_TO_MULTI: 도형 종류 통일.',
          tool: 'gdal',
          run: 'ogr2ogr -f PostgreSQL PG:dbname=gis /work/buildings.geojson -nln bldg -nlt PROMOTE_TO_MULTI -lco GEOMETRY_NAME=geom',
        },
        {
          title: '입체 생성 (CG_Extrude)',
          why: 'CG_Extrude(SFCGAL): 바닥면을 height만큼 돌출 → 닫힌 다면체. ST_Dump: MultiPolygon → 다각형 단위(그대로면 GeometryCollection → pg2b3dm 읽기 불가). ST_MakeValid + ST_CollectionExtract: 꼬인 도형 수정 후 면만. ST_SetSRID 4979: 위경도+높이 좌표계.',
          tool: 'postgis',
          run: 'psql -v ON_ERROR_STOP=1 -c "CREATE TABLE bldg3d AS SELECT name, height, height_source, ST_SetSRID(CG_Extrude(ST_Force3D(geom), 0, 0, height), 4979) AS geom FROM (SELECT name, height, height_source, (ST_Dump(ST_CollectionExtract(ST_MakeValid(geom), 3))).geom AS geom FROM bldg) parts; CREATE INDEX ON bldg3d USING gist (st_centroid(st_envelope(geom))); SELECT count(*) AS 건물_수, ST_GeometryType(geom) AS 형태 FROM bldg3d GROUP BY 2;"',
        },
        {
          title: '3D Tiles 생성 (pg2b3dm)',
          why: '입체 → 삼각형 분할 → glb 타일. -a: 속성 열 포함. 3D Tiles 1.1 암시적 타일링: tileset.json에 타일 목록 대신 주소 규칙({level}_{x}_{y})·subtree 파일. 기본값 사용: 2.28 명시적 타일링 옵션은 빈 tileset 생성.',
          tool: 'pg2b3dm',
          run: 'pg2b3dm --connection "Host=$PGHOST;Username=$PGUSER;Password=$PGPASSWORD;Database=$PGDATABASE" -t bldg3d -c geom -a name,height,height_source -o /out/tiles --default_color "#DD7A1F"',
        },
      ],
      outputs: [
        { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles 1.1 (glb, 암시적 타일링)', why: 'DB 입체 그대로 타일화. 속성(이름·높이 출처) 포함.' },
      ],
      viewers: { ...no3dTiles, deck: { output: 'tiles' }, cesium: { output: 'tiles' } },
    },
  ]
}

/**
 * 올린 건물 파일: 높이 열을 찾아 채운 /work/buildings.geojson을 만든 뒤 방식·도구별로
 * GDAL(돌출용 GeoJSON) · mago(3D Tiles) · GeoServer · martin
 */
export function buildingUpload(u: { accept: string[]; note: string; open?: string; prepare?: Step }): Upload {
  const open = u.open ?? '$INPUT'
  const preprocess: Step[] = [
    ...(u.prepare ? [u.prepare] : []),
    {
      title: '무결성 확인',
      why: '도형 종류·개수·속성 열 이름 확인. 높이·층수 열 유무.',
      tool: 'gdal',
      run: `ogrinfo -so -al ${open}${u.prepare ? ' $(cat /work/open_options)' : ''} | grep -vE '^(INFO|Metadata|  [A-Z_]+=)'`,
    },
    {
      title: '위경도 정리',
      why: '-s_srs $SRS: 파일에 좌표계가 없을 때 판별 화면에서 고른 좌표계. -t_srs EPSG:4326: 위경도 변환. -makevalid: 꼬인 도형 수정.',
      tool: 'gdal',
      run: `ogr2ogr -f GeoJSON /work/data.geojson ${open} -nln buildings ${SRC_SRS}-t_srs EPSG:4326 -makevalid${u.prepare ? ' $(cat /work/open_options)' : ''}`,
    },
    checkExtent('/work/data.geojson'),
    {
      title: '높이 열 탐색·채우기',
      why: '파일마다 열 이름 상이 → 높이 열 → 층수 열×3m → 기본값 9m 순으로 height 채움. height_source: 사용 값 출처.',
      tool: 'python',
      run: 'python /scripts/fill_height.py /work/data.geojson /work/buildings.geojson',
    },
  ]
  return {
    accept: u.accept,
    note: u.note,
    recipes: [
      {
        id: 'gdal',
        title: 'GDAL',
        preprocess,
        convert: [
          {
            title: 'GeoJSON 내보내기 (OGC API Features 경로)',
            why: 'COORDINATE_PRECISION=7: 좌표 7자리. GeoJSON 원본도 위경도·도형 수정·height 채움 반영해 재생성.',
            tool: 'gdal',
            run: 'ogr2ogr -f GeoJSON /out/ogc/collections/buildings/items.json /work/buildings.geojson -lco RFC7946=YES -lco COORDINATE_PRECISION=7',
          },
        ],
        outputs: [
          { id: 'features', kind: 'geojson', path: 'ogc/collections/buildings/items.json', style: { height: 'height' }, label: 'GeoJSON (height 속성)', why: 'height 채운 GeoJSON. 뷰어가 height만큼 바닥면 돌출.' },
        ],
        viewers: {
          ol: { unsupported: '2D 지도 — 건물 돌출 미지원.' },
          maplibre: { output: 'features', note: 'fill-extrusion 레이어로 돌출.' },
          deck: { output: 'features', note: 'GeoJsonLayer extruded 옵션으로 돌출.' },
          cesium: { output: 'features', note: '다각형별 extrudedHeight로 돌출.' },
        },
      },
      {
        id: 'mago',
        title: 'mago 3DTiler',
        preprocess,
        convert: [
          {
            title: 'mago 입력 정리',
            why: '-explodecollections: MultiPolygon → 다각형 단위(mago가 MultiPolygon 건너뜀). -select height: 높이만 남김(속성 복잡 시 실패 방지).',
            tool: 'gdal',
            run: 'ogr2ogr -f GeoJSON /work/mago_raw.geojson /work/buildings.geojson -explodecollections -select height',
          },
          {
            title: '작은 구멍 메우기',
            why: '수 ㎡ 구멍(채광창 등) → mago 벽 생성 실패·전체 중단. 10㎡ 미만 구멍만 메움, 큰 안뜰은 유지.',
            tool: 'python',
            run: 'python /scripts/fill_holes.py /work/mago_raw.geojson /work/mago.geojson 10',
          },
          {
            title: '3D Tiles 생성 (높이 돌출)',
            why: '-hc height: 바닥면을 height만큼 돌출한 메시 → 타일 분할. -c 4326: 입력 좌표계. -q 없음: 진행 로그를 실시간 출력으로.',
            tool: 'mago-3d-tiler',
            run: 'mkdir -p /work/in && cp /work/mago.geojson /work/in/ && mago-3d-tiler -i /work/in -o /out/tiles -it geojson -c 4326 -hc height -tv 1.0',
          },
        ],
        outputs: [
          { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (b3dm)', why: '건물 메시를 미리 만든 타일. 수십만 동도 보이는 영역만 요청.' },
        ],
        viewers: { ...no3dTiles, deck: { output: 'tiles' }, cesium: { output: 'tiles' } },
      },
      ...serverRecipes({ category: 'vector-25d', layer: UPLOAD_LAYER, preprocess, work: '/work/buildings.geojson', geom: 'polygon', height: 'height' }),
    ],
  }
}
