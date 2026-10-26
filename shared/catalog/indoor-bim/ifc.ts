import type { FormatSpec, Step } from '../../types.ts'

// 서울시청 앞. 원본의 위치(뉴질랜드 UTM 60S) 대신 이 자리에 세운다
const ANCHOR: [number, number, number] = [126.97830, 37.56590, 0]

/** 올린 IFC 공통 확인: 버전·요소별 개수 */
const uploadInspect: Step = {
  title: '무결성 확인',
  why: 'FILE_SCHEMA: IFC 버전. 텍스트 포맷 → grep만으로 요소별 개수 집계.',
  tool: 'shell',
  run: "grep -m1 -oE 'FILE_SCHEMA[^;]*' $INPUT; grep -oE 'IFC(BUILDINGSTOREY|WALL|SLAB|DOOR|WINDOW|ROOF|COLUMN|BEAM|STAIR|RAILING|COVERING|SPACE)[A-Z]*\\(' $INPUT | sort | uniq -c | sort -rn",
}
const RAW = '/raw/Building-Architecture-IFC4.ifc'
const RAW_2X3 = '/raw/Building-Architecture-IFC2x3.ifc'
const SAMPLES = 'https://raw.githubusercontent.com/buildingSMART/Certification-datasets/main'

export default {
  id: 'ifc',
  category: 'indoor-bim',
  name: 'IFC',
  extensions: ['.ifc'],
  summary: '벽·문·층의 의미와 속성까지 담는 BIM 국제 표준.',
  description: '형상뿐 아니라 "이건 벽, 이건 2층, 이 문의 방화 등급은…" 같은 건축 정보를 담는 buildingSMART 표준. 텍스트(STEP) 파일, #번호로 연결된 수천 줄 객체. 웹 지도 직접 읽기 불가 → 형상만 glTF로 추출, 위치 지정 후 3D Tiles로 감쌈.',
  anatomy: [
    { name: 'IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey', role: '프로젝트·대지·건물·층으로 이어지는 공간 구조' },
    { name: 'IfcWall, IfcSlab, IfcDoor …', role: '건축 요소. 형상·속성' },
    { name: 'IfcMapConversion', role: '모델 좌표를 실제 지도 좌표계로 옮기는 정보 (있을 때만)' },
  ],
  convertible: true,
  collect: {
    source: 'buildingsmart',
    dataset: 'Certification-datasets Building-Architecture (IFC4, IFC2x3)',
    url: 'https://github.com/buildingSMART/Certification-datasets',
    how: 'buildingSMART 소프트웨어 인증용 소형 건물 모델. 같은 건물의 IFC 버전별 파일.',
    steps: [
      {
        title: '같은 건물 IFC4·IFC2x3 두 판 다운로드',
        why: '경로의 공백·괄호 → URL 인코딩 주소. IFC2x3: 2006년 판, 아직 널리 쓰임, 이 판만 읽는 도구도 있음.',
        tool: 'curl',
        run: `curl -sSL -o ${RAW} '${SAMPLES}/IFC%204.0.2.1%20(IFC%204%20ADD2%20TC1)/Simple-Scene/Building-Architecture.ifc' && curl -sSL -o ${RAW_2X3} '${SAMPLES}/IFC%202.3.0.1%20(IFC%202x3%20TC1)/Simple-Scene/Building-Architecture.ifc'`,
      },
    ],
  },
  otherSources: [
    { source: 'ifc-community-samples', dataset: 'Duplex Apartment (IFC 2x3)', note: '같은 폴더에 MEP·전기 파일.' },
  ],
  recipes: [
    {
      id: 'ifcconvert',
      title: 'IfcConvert + 3d-tiles-tools',
      preprocess: [
        {
          title: '무결성 확인 (건축 요소)',
          why: '텍스트 포맷 → grep만으로 요소별 개수 집계.',
          tool: 'shell',
          run: `grep -oE 'IFC(BUILDINGSTOREY|WALL|SLAB|DOOR|WINDOW|ROOF|COLUMN|BEAM|STAIR|RAILING|COVERING|SPACE)[A-Z]*\\(' ${RAW} | sort | uniq -c | sort -rn`,
        },
        {
          title: '무결성 확인 (위치 정보)',
          why: '원래 위치: 뉴질랜드 UTM 60S, mm 단위(배율 0.001). 비교를 위해 서울시청 앞으로 이동.',
          tool: 'shell',
          run: `grep -E 'IFCMAPCONVERSION|IFCPROJECTEDCRS' ${RAW}`,
        },
      ],
      convert: [
        {
          title: '형상만 glb 추출',
          why: '벽·문 등 요소 → 삼각형 메시. --y-up: glTF 규칙대로 위쪽 축 Y. --use-element-names: 요소 이름 유지. --site-local-placement: 대지 기준 좌표.',
          tool: 'ifcconvert',
          run: `IfcConvert -q -y --y-up --use-element-names --site-local-placement ${RAW} /work/building.glb`,
        },
        {
          title: '웹용 압축',
          why: '--compress meshopt: 형상 압축, 용량 감소.',
          tool: 'gltf-transform',
          run: 'gltf-transform optimize /work/building.glb /out/model/building.glb --compress meshopt',
        },
        {
          title: '서울시청 앞 배치 타일셋 생성',
          why: '--cartographicPositionDegrees: 위치(경위도·높이) → tileset.json, Cesium 바로 배치.',
          tool: '3d-tiles-tools',
          run: `3d-tiles-tools createTilesetJson -i /out/model/building.glb -o /out/model/tileset.json --cartographicPositionDegrees ${ANCHOR.join(' ')} -f`,
        },
      ],
      outputs: [
        { id: 'glb', kind: 'glb', path: 'model/building.glb', anchor: ANCHOR, label: 'GLB + 놓을 위치', why: '형상만 남은 모델, 벽·문 속성 제외. Deck.gl용.' },
        { id: 'tiles', kind: '3dtiles', path: 'model/tileset.json', label: '3D Tiles (glb 감싸기)', why: '위치 내장 타일셋. Cesium용.' },
      ],
      viewers: {
        ol: { unsupported: '2D 지도 — 3D 건물 모델 미지원.' },
        maplibre: { unsupported: 'glTF·3D Tiles 기본 레이어 없음.' },
        deck: { output: 'glb' },
        cesium: { output: 'tiles' },
      },
    },
    {
      id: 'mago',
      title: 'mago 3DTiler',
      preprocess: [
        {
          title: '무결성 확인',
          why: 'IFC2x3 판. 같은 건물 → 요소 구성은 IFC4 판과 동일, 엔티티 이름 일부만 차이.',
          tool: 'shell',
          run: `grep -oE 'IFC(BUILDINGSTOREY|WALL|SLAB|DOOR|WINDOW|ROOF|COLUMN|BEAM|STAIR|RAILING|COVERING|SPACE)[A-Z]*\\(' ${RAW_2X3} | sort | uniq -c | sort -rn`,
        },
      ],
      convert: [
        {
          title: '위치 지정 3D Tiles 생성',
          why: '내부 Assimp: IFC2x3만 지원(IFC4 실패) → IFC2x3 판 입력. -lon·-lat: 서울시청 앞, b3dm 타일 생성. 경위도는 IFC 원점 기준, IFC 내 대지·건물 배치 거리 유지 → 기준점 북서쪽 약 40m에 위치. IfcConvert 레시피는 --site-local-placement로 기준점에 바로 배치.',
          tool: 'mago-3d-tiler',
          run: `mkdir -p /work/in && cp ${RAW_2X3} /work/in/ && mago-3d-tiler -i /work/in -o /out/tiles -it ifc -lon ${ANCHOR[0]} -lat ${ANCHOR[1]} -tv 1.0 -q`,
        },
      ],
      outputs: [
        { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (b3dm, LOD)', why: 'IFC2x3 판 직접 변환 타일. Deck.gl·Cesium용.' },
      ],
      view: { center: [126.97797, 37.56611], zoom: 19.3, pitch: 60, bearing: 35 },
      viewers: {
        ol: { unsupported: '2D 지도 — 3D 건물 모델 미지원.' },
        maplibre: { unsupported: 'glTF·3D Tiles 기본 레이어 없음.' },
        deck: { output: 'tiles' },
        cesium: { output: 'tiles' },
      },
    },
  ],
  alternatives: [],
  upload: {
    accept: ['.ifc'],
    note: 'IFC2x3·IFC4 모두 지원. 원래 위치와 무관하게 서울시청 앞 배치.',
    recipes: [{
      id: 'ifcconvert',
      title: 'IfcConvert + 3d-tiles-tools',
      preprocess: [uploadInspect],
      convert: [
        {
          title: '형상만 glb 추출',
          why: '샘플 IfcConvert 레시피와 동일, 단 --building-local-placement: 대지 아닌 건물 기준. 파일마다 대지 내 건물 위치 상이 → 건물 기준이어야 기준점에 바로 배치.',
          tool: 'ifcconvert',
          run: 'IfcConvert -q -y --y-up --use-element-names --building-local-placement $INPUT /work/building.glb',
        },
        {
          title: '웹용 압축',
          why: '--compress meshopt: 형상 압축, 용량 감소.',
          tool: 'gltf-transform',
          run: 'gltf-transform optimize /work/building.glb /out/model/building.glb --compress meshopt',
        },
        {
          title: '서울시청 앞 배치 타일셋 생성',
          why: '--cartographicPositionDegrees: 위치(경위도·높이) → tileset.json, Cesium 바로 배치.',
          tool: '3d-tiles-tools',
          run: `3d-tiles-tools createTilesetJson -i /out/model/building.glb -o /out/model/tileset.json --cartographicPositionDegrees ${ANCHOR.join(' ')} -f`,
        },
      ],
      outputs: [
        { id: 'glb', kind: 'glb', path: 'model/building.glb', anchor: ANCHOR, label: 'GLB + 놓을 위치', why: '형상만 남은 모델, 벽·문 속성 제외. Deck.gl용.' },
        { id: 'tiles', kind: '3dtiles', path: 'model/tileset.json', label: '3D Tiles (glb 감싸기)', why: '위치 내장 타일셋. Cesium용.' },
      ],
      viewers: {
        ol: { unsupported: '2D 지도 — 3D 건물 모델 미지원.' },
        maplibre: { unsupported: 'glTF·3D Tiles 기본 레이어 없음.' },
        deck: { output: 'glb' },
        cesium: { output: 'tiles' },
      },
    }, {
      id: 'mago',
      title: 'mago 3DTiler',
      preprocess: [
        uploadInspect,
        {
          title: 'IFC 버전 확인 (mago는 IFC2x3만)',
          why: 'mago 내부 Assimp는 IFC2x3만 읽음 → IFC4면 여기서 중단(IfcConvert 방식은 IFC4도 가능).',
          tool: 'shell',
          run: "grep -m1 FILE_SCHEMA $INPUT | grep -qi IFC2X3 || { echo 'IFC2x3 아님 → mago 불가. IfcConvert 방식으로 다시'; exit 1; }",
        },
      ],
      convert: [
        {
          title: '위치 지정 3D Tiles 생성',
          why: '샘플 mago 레시피와 동일. -lon·-lat: 서울시청 앞, 단순화 단계(LOD)별 b3dm 타일. IFC 원점 기준 → 대지 안 건물 배치 거리만큼 기준점에서 떨어질 수 있음. -q 없음: 진행 로그를 실시간 출력으로.',
          tool: 'mago-3d-tiler',
          run: `mkdir -p /work/in && cp $INPUT /work/in/model.ifc && mago-3d-tiler -i /work/in -o /out/tiles -it ifc -lon ${ANCHOR[0]} -lat ${ANCHOR[1]} -tv 1.0`,
        },
      ],
      outputs: [
        { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (b3dm, LOD)', why: 'IFC 직접 변환 타일. Deck.gl·Cesium용.' },
      ],
      viewers: {
        ol: { unsupported: '2D 지도 — 3D 건물 모델 미지원.' },
        maplibre: { unsupported: 'glTF·3D Tiles 기본 레이어 없음.' },
        deck: { output: 'tiles' },
        cesium: { output: 'tiles' },
      },
    }],
  },
  view: { center: [126.9783, 37.5659], zoom: 19.3, pitch: 60, bearing: 35 },
  noDomestic: '국내 IFC 공개 원본 없음. 공공데이터포털 BIM 자료는 지침·CSV.',
} satisfies FormatSpec
