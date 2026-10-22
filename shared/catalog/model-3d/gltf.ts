import { LANTERN_BASE, modelSpec } from './_model.ts'

const spec = modelSpec({
  id: 'gltf',
  name: 'glTF (JSON + 외부 파일)',
  summary: 'glTF의 텍스트 형태. 장면 JSON, 이진 데이터(.bin), 텍스처 이미지가 따로인 묶음.',
  description: '사람이 읽는 JSON → 구조 확인·수정 용이. 정점(.bin)·텍스처(.png, .jpg)는 별도 파일 → 하나라도 빠지거나 경로가 바뀌면 모델 깨짐. 웹 배포는 보통 .glb 1개로 묶음.',
  anatomy: [
    { name: '.gltf', role: '장면·메시·재질 구조(JSON). buffers·images: 외부 파일 경로(uri)' },
    { name: '.bin', role: '정점 좌표, 법선, UV, 인덱스 같은 이진 데이터' },
    { name: '.png / .jpg', role: '색, 거칠기·금속성, 법선 텍스처' },
  ],
  collect: {
    title: '샘플 모델·딸린 파일 다운로드',
    why: '.gltf 먼저 → buffers·images의 uri로 딸린 파일 전부. 하나라도 빠지면 모델 열림 불가.',
    tool: 'shell',
    run: `mkdir -p /raw/Lantern && cd /raw/Lantern && curl -sSLO ${LANTERN_BASE}/glTF/Lantern.gltf && for u in $(python -c "import json; d = json.load(open('Lantern.gltf')); print(' '.join(x['uri'] for x in d.get('buffers', []) + d.get('images', [])))"); do curl -sSLO ${LANTERN_BASE}/glTF/$u; done`,
  },
  raw: '/raw/Lantern/Lantern.gltf',
  magoInput: 'mkdir -p /work/in && cp /raw/Lantern/* /work/in/',
})

export default {
  ...spec,
  otherSources: [
    ...spec.otherSources,
    { source: 'poly-haven', dataset: 'wooden_table_02 등 (.gltf + .bin + 텍스처)', note: '해상도 1k~4k 선택.' },
  ],
  noDomestic: '국내 glTF: 문화포털 실감형 3D(공공누리 1유형)는 원본 신청서(이름·이메일) 제출 필요 → 자동 수집 불가.',
}
