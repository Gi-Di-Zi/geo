import { LANTERN_BASE, modelSpec } from './_model.ts'

const spec = modelSpec({
  id: 'glb',
  name: 'glTF Binary (GLB)',
  summary: '3D 모델의 웹 표준. 형상·재질·텍스처를 파일 하나에.',
  description: 'Khronos의 "3D의 JPEG" 포맷 glTF를 이진 파일 하나로 묶은 형태. 브라우저 → GPU 거의 직행, 웹 3D 기본. 좌표는 모델 기준(m)뿐, 지구 위치 없음 → 지도 배치 시 경위도·높이·방향 별도 지정.',
  anatomy: [
    { name: 'JSON 청크', role: '장면 구조, 메시, 재질, 텍스처 목록' },
    { name: 'BIN 청크', role: '정점·인덱스 같은 실제 숫자 데이터와 이미지' },
    { name: '좌표축', role: 'Y-위 오른손 좌표계. 지도(Z-위) 배치 시 회전 필요' },
  ],
  collect: {
    title: '샘플 모델 다운로드',
    why: 'GitHub 저장소 파일 그대로.',
    tool: 'curl',
    run: `curl -sSL -o /raw/Lantern.glb ${LANTERN_BASE}/glTF-Binary/Lantern.glb`,
  },
  raw: '/raw/Lantern.glb',
  magoInput: 'mkdir -p /work/in && cp /raw/Lantern.glb /work/in/',
})

export default {
  ...spec,
  otherSources: [
    ...spec.otherSources,
    { source: '3dbag', dataset: '3D Tiles 1.1 lod22 (타일 콘텐츠 GLB)', note: '네덜란드 건물.' },
    { source: 'smithsonian-3d', dataset: 'Open Access(CC0) 3D 모델', note: 'GLB 제공 여부 객체별 확인.' },
    { source: 'sketchfab', dataset: '모델 페이지 Download → GLB', note: '로그인, 모델별 라이선스.' },
    { source: 'khs-digital', dataset: '국가유산 3D 에셋', note: '문화유산 스캔 3D. 원본 형식 자료별 → GLB 변환 필요.' },
    { source: 'datagokr', dataset: '경주 불국사 다보탑 3D 모델링 15150537', note: 'OBJ zip(약 292MB), 공공누리 1유형, 로그인 불필요. OBJ → GLB 변환 필요.' },
  ],
  noDomestic: '국내 glb 자동 수집 원본 없음. 국가유산청 3D(공공누리 1유형)는 로그인·승인 후 FBX, 뷰어 내부 glb는 이용조건 미표시. 문화포털 실감형 3D는 신청서(이름·이메일) 필요.',
}
