import type { FormatSpec, Step } from '../../types.ts'

const RAW = '/raw/tokyo_station_bldg.gml'
// 도쿄역 마루노우치 역사 앞. glb를 이 점 기준으로 옮기고 이 점에 세운다.
// 일본 평면직각좌표계 IX계(EPSG:6677, 동·북 순서)로는 (-5995.185, -35367.230)
const ANCHOR: [number, number, number] = [139.7671, 35.6812, 0]
// 치요다구 2025년 CityGML의 1km 메시(53394611) 건물 파일. PLATEAU API(datacatalog/citygml)가 알려 주는 주소
const MESH = 'https://assets.cms.plateau.reearth.io/assets/5d/dc07c5-ace7-465a-9c99-53f6d78f6164/13101_chiyoda-ku_pref_2025_citygml_1_op/udx/bldg/53394611_bldg_6697_op.gml'

const stats: Step = {
  title: '무결성 확인',
  why: '건물(Building) 아래 지붕·벽·바닥 면(RoofSurface, WallSurface, GroundSurface) 별도. 좌표계: 위도·경도·높이(EPSG:6697). LOD 0~2 혼재.',
  tool: 'citygml-tools',
  run: `citygml-tools stats --no-json-report ${RAW} | grep -v '^\\['`,
}

const no2d = {
  ol: { unsupported: '2D 지도 — 3D 건물 모델 미지원.' },
  maplibre: { unsupported: 'glTF·3D Tiles 기본 레이어 없음.' },
}

export default {
  id: 'citygml',
  category: 'model-3d',
  name: 'CityGML',
  extensions: ['.gml', '.citygml'],
  summary: '건물·도로·지형을 의미 단위로 담는 OGC 표준 XML. 지붕·벽 면과 속성을 따로 가진다.',
  description: '형상뿐 아니라 "이 건물의 지붕 면, 이 벽, 높이 235m, 용도 업무시설" 같은 도시 객체의 의미·관계. 같은 건물을 LOD(상세 수준) 0~4로 함께 표현 가능. 무거운 XML, 브라우저 직접 읽기 불가 → CityJSON으로 축소 또는 glTF·3D Tiles로 형상만 추출. 일본 PLATEAU가 전국을 이 형식으로 공개.',
  anatomy: [
    { name: 'core:CityModel', role: '파일 전체. 도시 객체(cityObjectMember) 목록' },
    { name: 'bldg:Building', role: '건물 1동. 높이(measuredHeight)·층수·용도 등 속성' },
    { name: 'RoofSurface · WallSurface · GroundSurface', role: 'LOD2 건물의 지붕·벽·바닥 면. 면별 의미 부여' },
    { name: 'app:Appearance', role: '면의 색(재질)·사진 텍스처. 텍스처 이미지는 별도 폴더' },
    { name: 'uro: (i-UR)', role: 'PLATEAU 일본용 확장 속성(ADE). 일부 도구는 무시' },
  ],
  convertible: true,
  collect: {
    source: 'plateau',
    dataset: 'PLATEAU 도쿄도 치요다구 2025 건물(bldg) LOD2, 도쿄역 일대 85동',
    url: 'https://www.geospatial.jp/ckan/dataset/plateau-13101-chiyoda-ku-2025',
    how: 'PLATEAU API: 범위 → 해당 1km 메시 CityGML 주소. 메시 1개 166MB → 도쿄역 일대 건물만 잘라 내고 별도 폴더 텍스처 참조 제거, 10MB 샘플.',
    derived: '1km 메시 파일(166MB) → 도쿄역 일대 건물 85동만, 텍스처 참조 제거. 형식은 CityGML 2.0 그대로.',
    steps: [
      {
        title: '도쿄역 포함 1km 메시 건물 파일 다운로드',
        why: '지역 메시 단위 공개 파일. API(api.plateauview.mlit.go.jp/datacatalog/citygml/r:경도,위도…?types=bldg)가 준 주소.',
        tool: 'curl',
        run: `curl -sSL -o /work/mesh.gml ${MESH}`,
      },
      {
        title: '도쿄역 일대 추출·텍스처 참조 제거',
        why: 'subset --bbox: 범위에 걸치는 건물만, 위도 우선 좌표계라 위도·경도 순서. remove-apps: 받지 않은 텍스처 이미지 참조 제거. PLATEAU 확장 속성(uro): 도구 미지원 → 함께 누락.',
        tool: 'citygml-tools',
        run: `citygml-tools subset /work/mesh.gml --bbox=35.6795,139.7645,35.6830,139.7690 -L warn -o /work/sub && citygml-tools remove-apps /work/sub/mesh.gml --no-pretty-print -L warn -o /work/noapp && mv /work/noapp/mesh.gml ${RAW}`,
      },
    ],
  },
  otherSources: [
    { source: 'vworld', dataset: '3D 건물 모델', note: '국내 3D 건물은 VWorld에 있으나 공개제한. 재배포 가능한 국내 CityGML 미확보.' },
    { source: 'nyc-3d', dataset: 'DA_WISE_GML.zip', note: 'CityGML 1.0, 구역별 파일.' },
  ],
  recipes: [
    {
      id: 'cjio',
      title: 'citygml-tools + cjio + 3d-tiles-tools',
      preprocess: [
        stats,
        {
          title: '미터 좌표계 변환',
          why: '-t 6677: glTF용 미터 평면 좌표, 도쿄 평면직각좌표계 IX계. -f: 북(X)·동(Y) 순서 → 동·북 강제 (미적용 시 모델 뒤집힘). --keep-height-values: 높이 유지.',
          tool: 'citygml-tools',
          run: `citygml-tools reproject ${RAW} -t 6677 -f --keep-height-values --no-pretty-print -L warn -o /work/rp`,
        },
      ],
      convert: [
        {
          title: 'CityJSON 변환',
          why: '같은 내용 JSON화, 좌표 정수 + 배율 → 10MB에서 약 0.7MB. 지붕·벽 의미·속성 유지.',
          tool: 'citygml-tools',
          run: 'citygml-tools to-cityjson /work/rp/tokyo_station_bldg.gml -L warn -o /work/cj',
        },
        {
          title: '도쿄역 원점 이동·glb 내보내기',
          why: '좌표 수만 m → glTF 정밀도 저하. crs_translate: 도쿄역(6677 좌표 -5995.185, -35367.230)을 원점으로. export glb: 면 삼각형 분할 후 glb 출력.',
          tool: 'cjio',
          run: 'cjio --suppress_msg /work/cj/tokyo_station_bldg.json crs_translate --minxyz 5995.185 35367.230 0 export glb /work/bldg.glb',
        },
        {
          title: '웹용 압축',
          why: '중복 꼭짓점 병합. --compress meshopt: 형상 압축.',
          tool: 'gltf-transform',
          run: 'gltf-transform optimize /work/bldg.glb /out/model/bldg.glb --compress meshopt',
        },
        {
          title: '도쿄역 배치 타일셋 생성',
          why: '--cartographicPositionDegrees: 원점(도쿄역) 경위도 → tileset.json, Cesium 제자리 배치.',
          tool: '3d-tiles-tools',
          run: `3d-tiles-tools createTilesetJson -i /out/model/bldg.glb -o /out/model/tileset.json --cartographicPositionDegrees ${ANCHOR.join(' ')} -f`,
        },
      ],
      outputs: [
        { id: 'glb', kind: 'glb', path: 'model/bldg.glb', anchor: ANCHOR, label: 'GLB + 놓을 위치', why: '85동을 메시 하나로, 건물별 속성 없음. Deck.gl용.' },
        { id: 'tiles', kind: '3dtiles', path: 'model/tileset.json', label: '3D Tiles (glb 감싸기)', why: '위치 내장 타일셋. Cesium용.' },
      ],
      viewers: { ...no2d, deck: { output: 'glb', note: 'ScenegraphLayer로 도쿄역 기준점에 배치.' }, cesium: { output: 'tiles' } },
    },
    {
      id: 'mago',
      title: 'mago 3DTiler',
      preprocess: [stats],
      convert: [
        {
          title: 'CityGML → 3D Tiles 직접 생성',
          why: 'CityGML 직접 입력. -c 6668: proj4j가 높이 포함 EPSG:6697 미지원 → 수평 좌표계 지정. -fc: 위도 우선 순서 → x·y 교환. 둘 중 하나라도 빠지면 건물이 바다 위로.',
          tool: 'mago-3d-tiler',
          run: `mkdir -p /work/in && cp ${RAW} /work/in/ && mago-3d-tiler -i /work/in -o /out/tiles -it citygml -c 6668 -fc -tv 1.0 -q`,
        },
      ],
      outputs: [
        { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (b3dm, LOD)', why: '공간 분할 + LOD: 멀리서 단순, 가까이서 상세. Deck.gl·Cesium용.' },
      ],
      viewers: { ...no2d, deck: { output: 'tiles' }, cesium: { output: 'tiles' } },
    },
    {
      id: '3dcitydb',
      title: '3DCityDB + pg2b3dm',
      db: { image: '3dcitydb/3dcitydb-pg:18-3.6-5.1.4', env: { SRID: '6697' } },
      preprocess: [stats],
      convert: [
        {
          title: '3DCityDB 적재',
          why: 'CityGML 구조 그대로 표 분할: 건물·면 → feature, 형상 → geometry_data, 속성·부모·자식 관계 → property. DB 좌표계 EPSG:6697(원본과 동일) → 변환 없이 적재.',
          tool: '3dcitydb',
          run: `citydb import citygml -H $PGHOST -d $PGDATABASE -u $PGUSER -p $PGPASSWORD ${RAW}`,
        },
        {
          title: '건물별 면 집계 표 생성',
          why: 'pg2b3dm 입력: "한 행 = 형상 하나" 표. property 부모(건물)·자식(지붕·벽) 관계로 면을 건물별 ST_Collect, 높이 속성 추가. ST_FlipCoordinates: 위도·경도 → 경도·위도. ST_SetSRID 4979: JGD2011·WGS84 차이 1m 이내.',
          tool: 'postgis',
          run: "psql -v ON_ERROR_STOP=1 -c \"CREATE TABLE bldg3d AS SELECT f.objectid AS gml_id, max(h.val_double) AS height, ST_SetSRID(ST_FlipCoordinates(ST_Collect(d.geom)), 4979) AS geom FROM citydb.feature f JOIN citydb.property p ON p.feature_id = f.id AND p.val_feature_id IS NOT NULL JOIN citydb.geometry_data g ON g.feature_id = p.val_feature_id AND g.geometry IS NOT NULL CROSS JOIN LATERAL ST_Dump(g.geometry) d LEFT JOIN citydb.property h ON h.feature_id = f.id AND h.name = 'value' WHERE f.objectclass_id = (SELECT id FROM citydb.objectclass WHERE classname = 'Building') GROUP BY f.objectid; SELECT count(*) AS 건물_수, round(max(height)::numeric, 1) AS 최고_높이 FROM bldg3d;\"",
        },
        {
          title: 'pg2b3dm 3D Tiles 생성',
          why: '건물별 면 삼각형 분할 → glb 타일. -a gml_id,height: 건물 id·높이 속성 포함.',
          tool: 'pg2b3dm',
          run: 'pg2b3dm --connection "Host=$PGHOST;Username=$PGUSER;Password=$PGPASSWORD;Database=$PGDATABASE" -t bldg3d -c geom -a gml_id,height -o /out/tiles --default_color "#2C5FD4"',
        },
      ],
      outputs: [
        { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles 1.1 (glb, 암시적 타일링)', why: 'DB에서 건물 단위로 모은 면 → 타일, gml_id·height 속성 포함. Deck.gl·Cesium용.' },
      ],
      viewers: { ...no2d, deck: { output: 'tiles' }, cesium: { output: 'tiles' } },
    },
  ],
  alternatives: [],
  upload: {
    accept: ['.gml', '.citygml'],
    note: 'CityGML 1.0·2.0 파일 1개. 좌표계(srsName) 기준 제자리 배치. 텍스처 미사용.',
    recipes: [{
      id: 'mago',
      title: 'mago 3DTiler',
      preprocess: [
        { ...stats, why: '도시 객체 종류·개수, 좌표계, LOD.', run: "citygml-tools stats --no-json-report $INPUT | grep -v '^\\['" },
        {
          title: '좌표계별 mago 옵션 결정',
          why: '파일별 좌표계 상이. 높이 포함 좌표계 → 수평 좌표계만(-c). 위도(북) 우선 좌표계 → x·y 교환(-fc).',
          tool: 'python',
          run: 'python /scripts/citygml_crs.py $INPUT > /work/mago_args && cat /work/mago_args',
        },
      ],
      convert: [
        {
          title: 'CityGML → 3D Tiles 직접 생성',
          why: '샘플 mago 레시피와 동일. 좌표계 옵션: 앞 단계 결과. input.gml: mago가 .gml 확장자만 인식. -q 없음: 진행 로그를 실시간 출력으로.',
          tool: 'mago-3d-tiler',
          run: 'mkdir -p /work/in && cp $INPUT /work/in/input.gml && mago-3d-tiler -i /work/in -o /out/tiles -it citygml $(cat /work/mago_args) -tv 1.0',
        },
      ],
      outputs: [
        { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (b3dm)', why: '파일 좌표 그대로 배치. Deck.gl·Cesium용.' },
      ],
      viewers: { ...no2d, deck: { output: 'tiles' }, cesium: { output: 'tiles' } },
    }],
  },
  view: { center: [139.7666, 35.6812], zoom: 16.4, pitch: 60, bearing: -25, basemap: 'osm' },
  noDomestic: '국내 CityGML 공개 원본 없음. VWorld 3D 건물은 공개제한.',
} satisfies FormatSpec
