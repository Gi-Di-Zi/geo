// glb와 gltf는 같은 가로등 모델이고 원본 형태(파일 하나 / JSON+bin+텍스처 여러 개)만 다르다.
import type { FormatSpec, Step } from '../../types.ts'

// 서울광장. 좌표가 없는 모델을 이 위치에 세운다
const ANCHOR: [number, number, number] = [126.97790, 37.56630, 0]
const BASE = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Lantern'

interface ModelFormat {
  id: 'glb' | 'gltf'
  name: string
  summary: string
  description: string
  anatomy: FormatSpec['anatomy']
  collect: Step
  /** 전처리·변환에 쓸 원본 경로 */
  raw: string
  /** mago 입력 폴더로 옮기는 명령 */
  magoInput: string
}

export function modelSpec(f: ModelFormat): FormatSpec {
  const inspect: Step = {
    title: '무결성 확인',
    why: '메시·정점 수·텍스처 크기. 웹 용량 대부분은 텍스처.',
    tool: 'gltf-transform',
    run: `gltf-transform inspect ${f.raw} --format md`,
  }
  // 올린 모델: .gltf는 딸린 .bin·텍스처가 있어야 해서 zip으로도 받는다
  const gltf = f.id === 'gltf'
  const src = gltf ? '/work/src/*.gltf' : '$INPUT'
  const unpack: Step = {
    title: '묶음 해제',
    why: '.gltf가 참조하는 .bin·텍스처는 같은 폴더 필요. zip → .gltf 있는 폴더 추출.',
    tool: 'python',
    run: 'mkdir -p /work/src && case $INPUT in *.zip) python /scripts/unpack.py $INPUT .gltf /work/src ;; *) cp $INPUT /work/src/ ;; esac',
  }
  // 올린 모델 공통 전처리: (.gltf zip이면 풀기) + 구성 확인
  const uploadInspect: Step[] = [...(gltf ? [unpack] : []), { ...inspect, run: `gltf-transform inspect ${src} --format md` }]
  const no2d = {
    ol: { unsupported: '2D 지도 — 3D 모델 미지원.' },
    maplibre: { unsupported: 'glTF·3D Tiles 기본 레이어 없음 → three.js 등 별도 라이브러리 필요.' },
  }
  return {
    id: f.id,
    category: 'model-3d',
    name: f.name,
    extensions: [`.${f.id}`],
    summary: f.summary,
    description: f.description,
    anatomy: f.anatomy,
    convertible: true,
    collect: {
      source: 'khronos',
      dataset: 'Lantern (CC0, Microsoft)',
      url: `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern`,
      how: 'glTF 표준 샘플의 낡은 나무 가로등 모델. 지도 위치 없는 일반 3D 모델 예시. 같은 모델이 .glb·.gltf 두 형태로 제공.',
      steps: [f.collect],
    },
    otherSources: [
      { source: 'vworld', dataset: '3D 건물 모델', note: '공개제한 → 사용 불가.' },
    ],
    recipes: [
      {
        id: '3d-tiles-tools',
        title: 'glTF Transform + 3d-tiles-tools',
        preprocess: [
          inspect,
          {
            title: '웹용 glb 최적화',
            why: `${gltf ? '.gltf·.bin·텍스처 → glb 1개.' : '원본도 glb — 용량 축소용 재압축.'} --compress meshopt: 형상 압축. --texture-compress webp: 텍스처 압축. 외형 유지, 용량 대폭 감소.`,
            tool: 'gltf-transform',
            run: `gltf-transform optimize ${f.raw} /work/lantern.glb --compress meshopt --texture-compress webp`,
          },
        ],
        convert: [
          {
            title: '서울광장 배치 3D Tiles 생성',
            why: '--cartographicPositionDegrees: 경위도·높이 → tileset.json 변환 행렬. glTF Y-위 축: 3D Tiles 규칙대로 뷰어가 자동 회전.',
            tool: '3d-tiles-tools',
            run: `cp /work/lantern.glb /out/model/lantern.glb && 3d-tiles-tools createTilesetJson -i /out/model/lantern.glb -o /out/model/tileset.json --cartographicPositionDegrees ${ANCHOR.join(' ')} -f`,
          },
        ],
        outputs: [
          { id: 'glb', kind: 'glb', path: 'model/lantern.glb', anchor: ANCHOR, label: 'GLB + 놓을 위치', why: 'meshopt·WebP 압축 glb + 위치(경위도) 별도 지정. Deck.gl용.' },
          { id: 'tiles', kind: '3dtiles', path: 'model/tileset.json', label: '3D Tiles (glb 감싸기)', why: '위치 내장 tileset.json → 파일만 지정. Cesium용.' },
        ],
        viewers: { ...no2d, deck: { output: 'glb', note: 'ScenegraphLayer로 지정 위치에 배치.' }, cesium: { output: 'tiles' } },
      },
      {
        id: 'mago',
        title: 'mago 3DTiler',
        preprocess: [inspect],
        convert: [
          {
            title: '위치 지정 3D Tiles 생성',
            why: '-lon·-lat: 배치 위치. 단순화 단계(LOD)별 b3dm 타일 생성. -rx -90: glTF Y-위 → X축 -90° 회전. 내부 Assimp가 meshopt 압축 glb 미지원 → 원본 입력.',
            tool: 'mago-3d-tiler',
            run: `${f.magoInput} && mago-3d-tiler -i /work/in -o /out/tiles -it ${f.id} -lon ${ANCHOR[0]} -lat ${ANCHOR[1]} -rx -90 -tv 1.0 -q`,
          },
        ],
        outputs: [
          { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (b3dm, LOD)', why: '멀리서 단순 모델, 가까이서 원본 모델. Deck.gl·Cesium용.' },
        ],
        viewers: { ...no2d, deck: { output: 'tiles' }, cesium: { output: 'tiles' } },
      },
    ],
    alternatives: [],
    upload: {
      accept: gltf ? ['.gltf', '.zip'] : ['.glb'],
      note: `${gltf ? '.bin·텍스처가 따로 있으면 .gltf와 함께 zip 하나로. ' : ''}지도 위치 없음 → 서울광장에 배치. 모델 단위: m.`,
      recipes: [{
        id: '3d-tiles-tools',
        title: 'glTF Transform + 3d-tiles-tools',
        preprocess: [
          ...uploadInspect,
          {
            title: '웹용 glb 최적화',
            why: 'glb 1개로 정리. --compress meshopt: 형상 압축. --texture-compress webp: 텍스처 압축.',
            tool: 'gltf-transform',
            run: `gltf-transform optimize ${src} /work/model.glb --compress meshopt --texture-compress webp`,
          },
        ],
        convert: [
          {
            title: '서울광장 배치 3D Tiles 생성',
            why: '샘플과 동일. 위치(경위도·높이) → tileset.json.',
            tool: '3d-tiles-tools',
            run: `cp /work/model.glb /out/model/model.glb && 3d-tiles-tools createTilesetJson -i /out/model/model.glb -o /out/model/tileset.json --cartographicPositionDegrees ${ANCHOR.join(' ')} -f`,
          },
        ],
        outputs: [
          { id: 'glb', kind: 'glb', path: 'model/model.glb', anchor: ANCHOR, label: 'GLB + 놓을 위치', why: 'meshopt·WebP 압축 glb + 위치 별도 지정. Deck.gl용.' },
          { id: 'tiles', kind: '3dtiles', path: 'model/tileset.json', label: '3D Tiles (glb 감싸기)', why: '위치 내장 tileset.json. Cesium용.' },
        ],
        viewers: { ...no2d, deck: { output: 'glb' }, cesium: { output: 'tiles' } },
      }, {
        id: 'mago',
        title: 'mago 3DTiler',
        preprocess: uploadInspect,
        convert: [
          {
            title: '위치 지정 3D Tiles 생성',
            why: '샘플 mago 레시피와 동일. -lon·-lat: 서울광장. 단순화 단계(LOD)별 b3dm 타일. -rx -90: glTF Y-위 → X축 -90° 회전. 내부 Assimp가 meshopt 압축 glb 미지원 → 올린 파일 그대로 입력(이미 meshopt 압축된 파일이면 실패). -q 없음: 진행 로그를 실시간 출력으로.',
            tool: 'mago-3d-tiler',
            run: `mkdir -p /work/in && ${gltf ? 'cp -r /work/src/. /work/in/' : 'cp $INPUT /work/in/model.glb'} && mago-3d-tiler -i /work/in -o /out/tiles -it ${f.id} -lon ${ANCHOR[0]} -lat ${ANCHOR[1]} -rx -90 -tv 1.0`,
          },
        ],
        outputs: [
          { id: 'tiles', kind: '3dtiles', path: 'tiles/tileset.json', label: '3D Tiles (b3dm, LOD)', why: '멀리서 단순 모델, 가까이서 원본 모델. Deck.gl·Cesium용.' },
        ],
        viewers: { ...no2d, deck: { output: 'tiles' }, cesium: { output: 'tiles' } },
      }],
    },
    view: { center: [126.9779, 37.5663], zoom: 18.2, pitch: 65, bearing: 30 },
  }
}

export { BASE as LANTERN_BASE }
