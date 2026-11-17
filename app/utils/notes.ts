/**
 * 개념 정리노트(/notes). 묶음: 공통(좌표계·라이브러리·서버) → 벡터(공통·2D·2.5D·3D·기타) → 래스터(2D·2.5D) → 혼합·기타 → 프론트엔드 → 전체 요약(맨 아래).
 * 데이터 유형은 시각화 도구의 카탈로그 categories 그대로.
 * 두 갈래: ① 주제 노트 — note-topics.ts. 교과서 순서(무엇인가 → 종류 → 차이 → 이어지는 질문), 면접에 나온 주제는 ★중요 (질문은 app/assets/interview.txt에서)
 *          ② 정리 — 아래 mine (헷갈리는 것 비교), 맨 아래 전체 요약(카탈로그에서)
 * 그림: app/note-figs/<fig 또는 노트 id>.vue 파일이 있으면 그 노트에 붙는다.
 */
import raw from '~/assets/interview.txt?raw'
import { parseInterview, type InterviewSource } from '#shared/interview'
import type { Output, OutputKind, Tool, ViewerId } from '#shared/types'
import { categories, formats, supportLabels, tools } from '~/utils/catalog'
import { extraSources, topics, type FollowUp } from '~/utils/note-topics'

export const interview = parseInterview(raw)

export const noteGroups = [
  { id: 'common', name: '공통' },
  { id: 'vector', name: '벡터' },
  { id: 'raster', name: '래스터' },
  { id: 'mixed', name: '혼합·기타' },
  { id: 'web', name: '프론트엔드' },
  { id: 'summary', name: '전체 요약' },
]

// 데이터 유형 = 시각화 도구의 데이터 유형(카탈로그) 그대로 → 이름·색·설명이 도구와 같이 바뀐다.
// 묶음: 벡터(공통 → 2D → 2.5D → 3D 벡터 = 카탈로그의 3D 모델, 면·메시 도형은 벡터) · 래스터(정사영상 2D, 지형 2.5D) · 혼합·기타(점군·BIM·속성)
// dim: 그 유형의 차원 — 목록 줄마다 표시
const groupOfCat = new Map([['vector-2d', 'vector'], ['vector-25d', 'vector'], ['model-3d', 'vector'], ['raster', 'raster'], ['terrain', 'raster']])
const dimOfCat = new Map([['vector-2d', '2D'], ['vector-25d', '2.5D'], ['model-3d', '3D'], ['raster', '2D'], ['terrain', '2.5D'], ['pointcloud', '3D'], ['indoor-bim', '3D']])

const catsIn = (group: string) => categories.filter(c => (groupOfCat.get(c.id) ?? 'mixed') === group).map(c => ({
  id: c.id, group, name: c.id === 'model-3d' ? '3D 벡터 (3D 모델)' : c.name, color: c.color, text: c.summary, dim: dimOfCat.get(c.id),
}))

export const noteCats: { id: string; group: string; name: string; color: string; text: string; dim?: string }[] = [
  { id: 'crs', group: 'common', name: '좌표계', color: '#475569', text: '좌표를 어떻게 표현하는가 — 각도·평면·지심 좌표와 수평·수직 기준' },
  { id: 'viewer', group: 'common', name: '웹 지도 라이브러리', color: '#0E7490', text: 'OpenLayers·MapLibre·Deck.gl·CesiumJS — 데이터를 화면에 그리는 쪽' },
  { id: 'service', group: 'common', name: '지도 서버', color: '#B45309', text: '데이터를 요청마다 그림·타일·피처로 내주는 쪽 — 서버별 제공 확장자와 차원' },
  { id: 'vector-common', group: 'vector', name: '벡터 공통', color: '#64748B', text: '2D·2.5D·3D에 걸친 개념 — 벡터 데이터, 벡터 타일, 타일 아카이브', dim: '2D · 2.5D · 3D' },
  ...catsIn('vector'),
  { id: 'vector-etc', group: 'vector', name: '벡터 기타', color: '#9D174D', text: 'GML·CityGML·LOD — 2D~3D 벡터를 담는 표준과 세밀도', dim: '2D · 2.5D · 3D' },
  ...catsIn('raster'),
  ...catsIn('mixed'),
  { id: 'browser', group: 'web', name: '브라우저·네트워크', color: '#DD7A1F', text: '렌더링 과정, HTTP, CORS, 캐시' },
  { id: 'js', group: 'web', name: 'JavaScript·TypeScript', color: '#B4367E', text: '이벤트 루프, 비동기, 타입' },
  { id: 'vue', group: 'web', name: 'Vue·Nuxt', color: '#2E8A4C', text: '반응성, SSR, 하이드레이션' },
  { id: 'gfx', group: 'web', name: 'WebGL·성능', color: '#1E40AF', text: 'GPU, Web Worker, 메모리' },
  { id: 'summary', group: 'summary', name: '데이터 유형 한눈에', color: '#334155', text: '원본 → 변환 도구 → 웹 결과 → 라이브러리를 유형마다 한 줄로' },
]

/** 비교 표. 각 줄의 첫 칸은 줄 머리(to가 있으면 그 화면 링크) */
export type NoteTable = { cols: string[]; rows: { cells: string[]; to?: string }[] }

export type Note = {
  /** 주소 #id, 그림 파일 이름 */
  id: string
  /** noteCats의 id */
  cat: string
  /** 주제 · 정리 */
  kind: string
  /** 면접에 나온 주제 → ★중요 (값은 그 질문, 표식에 마우스를 올리면 보임) */
  important?: string
  /** 주제: 1단계 질문 / 정리: 질문 */
  title: string
  /** 주제: 1단계 정의 / 정리: 답 */
  answer: string
  /** 주제 1단계: 정의에 붙는 핵심 사실·출처 */
  answerFacts?: string[]
  answerRefs?: InterviewSource[]
  /** 주제 1단계: 2D·2.5D·3D에서 각각 */
  dims?: { d: string; text: string }[]
  dimsRefs?: InterviewSource[]
  /** 주제 2단계: 종류 카드 (정의 한 문장 + 핵심 사실 + 출처) */
  kindsQ?: string
  terms?: { name: string; sub: string; dim?: string; def: string; facts: string[]; refs: InterviewSource[]; subs?: { name: string; code?: string; text: string }[] }[]
  /** 주제 3단계: 차이 표 질문·출처 (표는 table) */
  diffQ?: string
  tableRefs?: InterviewSource[]
  /** 주제 4단계: 이어지는 질문 (면접 후기·실무 함정, 항목마다 출처) — 번호는 주제 안에서 1부터 */
  follow?: FollowUp[]
  /** 그림 파일 이름 (없으면 id) */
  fig?: string
  points: string[]
  code?: string
  /** 이 사이트에서 실제로 쓴 곳 — 경험으로 이어 말하기 */
  here?: string
  table?: NoteTable
  tags?: string[]
  links?: { to: string; label: string }[]
}

const row = (...cells: string[]) => ({ cells })

// 정리 노트 (kind는 아래에서 '정리'로 붙인다)
const mine: Omit<Note, 'kind'>[] = [
  // ── 파일 형식·표준 ──
  {
    id: 'gml',
    cat: 'vector-etc',
    title: 'XML·GML이란?',
    answer: 'XML: 태그(<이름>…</이름>)로 데이터 구조를 표현하는 W3C 표준 텍스트 형식 — 문법만 정하고 어휘(태그 이름의 뜻)는 응용 언어가 정의. GML(Geography Markup Language): 그 XML로 지리 정보(도형·좌표계·속성)를 적는 OGC 표준(3.2.1 = ISO 19136). 도형·좌표계 같은 공통 틀만 정하고, 분야별 어휘는 응용 스키마로 확장.',
    points: [
      'XML 구성: 요소(element)·속성(attribute)·네임스페이스(xmlns — gml:, bldg: 같은 접두사로 어휘 구분)',
      'XML 스키마(XSD)로 어떤 태그가 어떤 순서·형식으로 와야 하는지 검증 → 기관 간 교환에 강함. 정형(well-formed: 태그 짝·중첩) ≠ 유효(valid: 스키마까지 통과)',
      'XML 단점: 장황해서 크고 파싱이 느림 → 웹 전송은 JSON·바이너리(MVT, glb)가 주류',
      'GML 도형: gml:Point·LineString·Polygon·Surface·Solid, 좌표는 gml:pos·posList',
      'GML 피처(feature) = 현실 객체 하나(도형 + 속성). 속성 이름·형식은 응용 스키마(XSD)가 정의',
      '좌표계는 srsName. 축 순서는 좌표계 정의를 따름: EPSG:4326·6697은 위도 먼저, EPSG:28992 같은 투영 좌표계는 X(동쪽) 먼저',
      '함정: 짧은 표기 "EPSG:4326"은 옛 관례로 경도 먼저 읽는 도구도 있음 → urn:ogc:def:crs:EPSG::4326 표기면 위도 먼저',
      'GML 버전: 2.x(2001) → 3.1.1(2004, CityGML 2.0의 바탕) → 3.2.1(2007, ISO 19136, CityGML 3.0의 바탕)',
      '쓰는 곳: WFS 응답 기본 형식, CityGML·IndoorGML 같은 응용 스키마의 바탕',
    ],
    code: '<gml:Polygon srsName="urn:ogc:def:crs:EPSG::4326">\n  <gml:exterior><gml:LinearRing>\n    <gml:posList>37.56 126.97 37.56 126.98 37.57 126.98 37.56 126.97</gml:posList>\n  </gml:LinearRing></gml:exterior>\n</gml:Polygon>',
    here: 'GML 예시: WFS GetFeature 응답(GML 3.2)을 그대로 저장한 네덜란드 주 경계(EPSG:28992, X 먼저) → ogr2ogr로 위경도 GPKG. 도쿄역 CityGML은 EPSG:6697(위도 먼저)을 반대로 읽으면 건물이 바다 위로.',
    tags: ['XML', 'OGC', 'ISO 19136', '축 순서', 'WFS'],
    links: [{ to: '/viz/vector-2d/gml', label: 'GML 예시' }, { to: '/notes#citygml', label: '다음: CityGML' }],
  },
  {
    id: 'citygml',
    cat: 'vector-etc',
    title: 'CityGML이란?',
    answer: 'GML 위에 건물·도로·지형 같은 도시 객체 어휘를 정의한 OGC 3D 도시모델 표준. 모양만이 아니라 "이 면은 지붕, 이 건물 높이 21m" 같은 의미와 세밀도(LoD)를 함께 담음. 두 세대: 2.0(2012, GML 3.1.1, LoD 0~4)과 3.0(개념 모델 2021·GML 인코딩 2023, GML 3.2.1, LoD 0~3).',
    points: [
      '주제 모듈: 건물·교량·터널·교통·식생·수계·지형(Relief)·토지이용·도시시설물 + 외관(Appearance: 재질·텍스처)',
      '2.0 LoD: LoD0 바닥·지붕선 → LoD1 블록 → LoD2 지붕 형태·벽/지붕/바닥 면 구분 → LoD3 창·문(개구부)·외관 상세 → LoD4 실내(방·실내 설비)',
      '2.0은 기하와 의미가 LoD에 묶임: 도형 속성 이름부터 lod2Solid·lod3MultiSurface, 방(Room)은 LoD4에서만 → 실내 하나 넣으려면 LoD4 필요',
      '3.0: LoD4 폐지, LoD 0~3은 기하 세밀도만 → 실내·개구부를 어느 LoD에서나 (바깥은 LoD2, 실내는 LoD1처럼 따로)',
      '3.0 새 개념: 공간(Space — 점유·비점유 공간과 경계면), Dynamizer(센서·시계열), Versioning(버전·이력), PointCloud(점군 연결), Construction(건물·교량·터널 공통 구조), 차선 단위 교통',
      '3.0은 개념 모델(UML)과 인코딩 분리: GML 3.2.1 기반 XML, CityJSON 2.0(모델 일부의 JSON 인코딩)',
      '확장: ADE(Application Domain Extension)로 국가·분야별 속성 추가 (일본 PLATEAU의 uro: 등)',
      '국내: NDT(국가 디지털 트윈) 표준이 3.0 LoD 체계를 따름 — 국내 3차원 국토정보 기준과 번호가 같아도 뜻이 다름',
      '단점: XML이라 무겁고 브라우저 직접 표시 불가 → CityJSON으로 줄이거나 glTF·3D Tiles로 모양만 추출',
    ],
    here: '도쿄역 샘플 = PLATEAU 치요다구 CityGML 2.0 (LoD 0~2 혼재, 85동, 2025 배포본도 2.0 — citygml-tools upgrade로 3.0 변환 가능). 변환 경로 비교: mago 3DTiler 직접 · citygml-tools → CityJSON → glb · 3DCityDB(PostGIS) → pg2b3dm.',
    tags: ['OGC', '2.0 · 3.0', 'LoD', 'ADE', 'NDT'],
    links: [{ to: '/viz/model-3d/citygml', label: 'CityGML 예시' }, { to: '/notes#xml-gml-citygml', label: '다음: 차이 정리' }],
  },
  {
    id: 'xml-gml-citygml',
    cat: 'vector-etc',
    title: 'XML · GML · CityGML 2.0 · CityGML 3.0 차이 정리',
    answer: '층으로 쌓인 관계: XML(문법) ⊃ GML(지리 도형·좌표계) ⊃ CityGML(도시 객체 어휘). CityGML 2.0과 3.0은 같은 층의 두 세대 — 바탕 GML 버전과 LoD 체계가 다름.',
    points: [
      'XML만으론 그 값이 좌표인지 이름인지 모름 → GML이 도형·좌표계를 정함',
      'GML만으론 그 면이 벽인지 도로인지 모름 → CityGML이 건물·지붕 면 같은 의미를 정함',
      '2.0 → 3.0: LoD4 폐지, LoD는 기하 세밀도만, 실내는 모든 LoD에서, 모델과 인코딩 분리',
    ],
    table: {
      cols: ['', 'XML', 'GML', 'CityGML 2.0', 'CityGML 3.0'],
      rows: [
        row('정체', '범용 마크업 문법', 'XML 기반 지리 정보 언어', 'GML 응용 스키마 (3D 도시모델)', '개념 모델 + 인코딩 분리'),
        row('표준', 'W3C (1998)', 'OGC · ISO 19136 (3.2.1)', 'OGC (2012)', 'OGC (모델 2021 · GML 2023)'),
        row('바탕', '—', 'XML', 'GML 3.1.1', 'GML 3.2.1 · CityJSON 2.0'),
        row('담는 것', '아무 구조', '도형 · 좌표계 · 피처', '건물 · 도로 · 지형 · 외관', '+ 공간 · 시계열 · 버전 · 점군'),
        row('LoD', '—', '—', '0~4 (실내 = LoD4)', '0~3 (실내 = 어느 LoD나)'),
        row('파일 예', '.xml', '.gml (WFS 응답)', '.gml (PLATEAU)', '.gml · .city.json'),
      ],
    },
    tags: ['비교'],
    links: [{ to: '/notes#gml', label: 'XML·GML' }, { to: '/notes#citygml', label: 'CityGML' }, { to: '/notes#lod', label: '다음: LOD' }],
  },
  {
    id: 'png-jpg-webp',
    cat: 'raster',
    title: 'PNG · JPEG · WebP — 지도 그림은 무엇으로?',
    answer: 'PNG는 무손실·투명 가능(선·글자·주제도), JPEG는 손실·투명 없음·사진에 작음(항공사진), WebP는 손실·무손실 모두 되고 투명도도 담으며 같은 화질에서 JPEG보다 작음.',
    points: [
      '그림 자체엔 좌표가 없음 → 월드파일(.pgw·.jgw·.wld)이나 GeoTIFF 태그로 위치를 붙임',
      '타일: 항공사진은 JPEG·WebP, 투명 오버레이(경계·주제도)는 PNG·WebP',
      '높이를 색으로 담는 Terrain-RGB 타일은 무손실(PNG) 필수 — JPEG면 높이가 깨짐',
    ],
    here: 'WebP 예시는 국내 GeoTIFF를 WebP + 월드파일로 바꾼 샘플. 업로드는 첫 바이트로 판별: PNG 89 50 4E 47, JPEG FF D8 FF, WebP RIFF.',
    tags: ['비교', '월드파일'],
    links: [{ to: '/viz/raster/png', label: 'PNG' }, { to: '/viz/raster/jpg', label: 'JPEG' }, { to: '/viz/raster/webp', label: 'WebP' }],
  },

  // ── LOD(벡터 기타) ──
  {
    id: 'lod',
    cat: 'vector-etc',
    title: 'LOD(Level of Detail)란?',
    answer: '같은 대상을 얼마나 자세히 표현하느냐의 단계. 공간 데이터에선 두 뜻 — ① 렌더링 LOD: 멀면 성긴 것, 가까우면 촘촘한 것으로 바꿔 그려 속도 확보 ② 모델 LoD: 데이터를 얼마나 자세히 "만들었나"의 등급(CityGML LoD 등).',
    points: [
      '렌더링 LOD(3D Tiles): 타일마다 geometricError(m) → 화면에 투영한 오차(SSE, 픽셀)가 기준(CesiumJS 기본 16px)을 넘으면 자식 타일로 세분',
      '세분 방식: REPLACE(부모를 자식으로 교체, 건물 메시) / ADD(부모에 자식을 더함, 점군)',
      '같은 원리: 지도 타일 줌 단계, 텍스처 밉맵, 게임 엔진의 거리별 메시 교체',
      '모델 LoD는 실시간 전환이 아니라 구축 기준 → 같은 "LoD 4"도 기준마다 뜻이 다르니 어느 기준인지 먼저 확인',
    ],
    here: '치악산 점군 3D Tiles: 멀리서는 성긴 조각만, 다가가면 그 자리의 촘촘한 조각을 더 받음. 도쿄역 CityGML은 모델 LoD 0~2가 섞인 데이터.',
    tags: ['SSE', 'geometricError', 'HLOD'],
    links: [{ to: '/viz/why#s-lod', label: '처음이라면 · 3D 장면' }, { to: '/notes#lod-standards', label: '다음: LoD 기준 3가지' }],
  },
  {
    id: 'lod-standards',
    cat: 'vector-etc',
    title: 'LoD 기준 3가지: 국내 3차원 국토정보 · CityGML 2.0 · CityGML 3.0',
    answer: '같은 "LoD 숫자"라도 기준마다 단계 수와 뜻이 다름 — 국내 기준 LoD1~4(LoD0 없음), CityGML 2.0 LoD0~4(기하·의미 고정 결합), CityGML 3.0 LoD0~3(LoD4 폐지, 기하 세밀도로만 구분).',
    points: [
      'CityGML 2.0 단계: LoD0 바닥·지붕선 → LoD1 블록 → LoD2 지붕 형태 → LoD3 창·문 → LoD4 실내',
      '2.0의 고정 결합: 방(Room)은 LoD4에서만 → 방 하나 넣으려면 건물 전체를 LoD4로',
      '3.0: 바깥은 LoD2, 실내는 LoD1처럼 따로 정할 수 있음',
      '말할 때: "LoD2"가 아니라 "CityGML 2.0 LoD2"처럼 기준까지',
    ],
    here: '도쿄역 샘플: PLATEAU 건물 CityGML 2.0, 한 파일에 LoD 0~2가 섞여 있음.',
    table: {
      cols: ['구분', '국내 3차원 국토정보 구축 기준', 'CityGML 2.0', 'CityGML 3.0 (NDT 표준)'],
      rows: [
        row('단계 구성', 'LoD 1~4 (4단계, LoD 0 없음)', 'LoD 0~4 (5단계)', 'LoD 0~3 (4단계, LoD 4 폐지)'),
        row('핵심 특징', '1단계 외 2·3·4단계 간 시각적·구조적 차이가 명확하지 않음', '기하(Geometry)와 시맨틱 객체가 1:1로 고정 결합', '기하와 시맨틱의 결합 해제 (기하 표현 세밀도로만 단계 구분)'),
        row('실무 영향', "NDT 사업에서 이 기준의 'LoD 4'를 잘못 혼용해 제안하는 문제", '특정 실내 객체 표현 시 불필요하게 상위 LoD 전체를 구축해야 함', '모든 LoD 단계에서 실내 공간·개구부 등 시맨틱 객체 표현 가능'),
      ],
    },
    tags: ['비교', 'LoD', 'NDT'],
    links: [{ to: '/notes#citygml', label: 'CityGML' }],
  },

]

// ── 주제 노트 ──
// 출처: 면접 문서의 출처 목록(S01…) → 문서에 없는 것(R01…). 정의에 적은 번호가 없거나 실제 질문 번호가 문서에 없으면 오타 → 오류
const extra = new Map(extraSources.map(r => [r.id, r]))
const sources = (ids: string[]) => ids.flatMap(id => interview.sources.get(id) ?? extra.get(id) ?? [])
const items = interview.sections.flatMap(s => s.items)

for (const t of topics) {
  const used = [...t.what.src, ...(t.dimsSrc ?? []), ...(t.terms ?? []).flatMap(k => k.src), ...(t.tableSrc ?? [])]
  const missing = used.filter(id => !interview.sources.has(id) && !extra.has(id))

  if (missing.length) throw new Error(`note-topics.ts ${t.id}: 출처 ${missing.join(', ')}가 면접 문서·extraSources에 없음`)

  if (t.real && !items.some(i => i.no === t.real)) throw new Error(`note-topics.ts ${t.id}: 실제 질문 ${t.real}이 면접 문서에 없음`)
}

// 지도 서버: 카탈로그의 서버 도구에서 종류 카드·표. 확장자·차원은 서버가 내주는 결과 종류(serves)에서, "이 사이트"는 실제로 띄워 본 결과(checked)
const kindExt = {
  'geojson': 'GeoJSON (.geojson)', 'mvt': '벡터 타일 .pbf', 'pmtiles': '.pmtiles', 'image': '그림 .png·.jpg', 'cog': '',
  'xyz-raster': '그림 타일 .png·.jpg·.webp', 'terrain-rgb': 'Terrain-RGB .png', 'quantized-mesh': '.terrain + layer.json',
  '3dtiles': 'tileset.json + .glb', 'glb': '.glb', 'wms': 'WMS 그림 .png·.jpg',
} satisfies Record<OutputKind, string>

const kindDim = {
  'geojson': '2D', 'mvt': '2D', 'pmtiles': '2D', 'image': '2D', 'cog': '2D', 'xyz-raster': '2D', 'wms': '2D',
  'terrain-rgb': '2.5D (지형)', 'quantized-mesh': '2.5D (지형)', '3dtiles': '3D', 'glb': '3D',
} satisfies Record<OutputKind, string>

const serverOrder = ['geoserver', 'martin', 'titiler', 'pg-tileserv', 'pygeoapi', 'ctod']
const rank = (t: Tool) => (serverOrder.includes(t.id) ? serverOrder.indexOf(t.id) : serverOrder.length)
const servers = tools.filter(t => t.type === 'server').sort((a, b) => rank(a) - rank(b))
const uniq = (xs: string[]) => [...new Set(xs)].filter(Boolean).join(' · ')
const extOf = (t: Tool) => uniq((t.serves ?? []).map(k => kindExt[k]))
const dimOf = (t: Tool) => uniq((t.serves ?? []).map(k => kindDim[k]))
const siteOf = (t: Tool) => t.checked?.map(c => `${c.what} — ${supportLabels[c.level]}`).join(' / ') ?? '설명만 (이 사이트에서 실행 안 함)'
const serverRef = (t: Tool): InterviewSource => ({ id: t.id, title: `${t.name} 공식 사이트`, meta: '공식 사이트', text: t.summary, url: t.url })

const serverTerms = servers.map(t => ({
  name: t.name,
  sub: `${t.lang} · ${t.license} · ${t.version}`,
  def: t.summary,
  facts: [`입력 → 제공: ${t.io}`, `확장자: ${extOf(t)}`, `차원: ${dimOf(t)}`],
  refs: [serverRef(t)],
}))

const serverTable: NoteTable = {
  cols: ['서버', '입력 → 제공', '확장자', '차원', '이 사이트에서 확인'],
  rows: [
    ...servers.map(t => ({ cells: [t.name, t.io, extOf(t), dimOf(t), siteOf(t)], to: `/viz/tools/${t.id}` })),
    { cells: ['정적 파일 서버 (nginx·S3·CDN)', '미리 만든 파일 → 그대로 (HTTP Range·CORS)', '.pmtiles · .tif(COG) · tileset.json + .glb · .terrain', '2D · 2.5D (지형) · 3D', '이 사이트의 변환 결과 제공 방식'] },
  ],
}

const topicNotes: Note[] = topics.map(t => {
  const real = items.find(i => i.no === t.real)

  return {
    id: t.id,
    cat: t.cat,
    kind: '주제',
    important: real ? `면접 문서 ${real.no}: ${real.title}` : t.asked && `직접 받은 질문: ${t.asked}`,
    title: t.what.q,
    answer: t.what.def,
    answerFacts: t.what.facts,
    answerRefs: sources(t.what.src),
    dims: t.dims,
    dimsRefs: t.dimsSrc && sources(t.dimsSrc),
    kindsQ: t.kindsQ,
    terms: t.servers ? serverTerms : t.terms?.map(k => ({ name: k.name, sub: k.sub, dim: k.dim, def: k.def, facts: k.facts, refs: sources(k.src), subs: k.subs })),
    diffQ: t.diffQ,
    table: t.servers ? serverTable : t.table,
    tableRefs: t.servers ? servers.map(serverRef) : t.tableSrc && sources(t.tableSrc),
    follow: t.follow,
    fig: t.fig,
    points: t.points ?? [],
    code: t.code,
    here: t.here,
    tags: t.tags,
    links: t.links,
  }
})

export const importantCount = topics.filter(t => t.real || t.asked).length
export const followCount = topics.reduce((k, t) => k + (t.follow?.length ?? 0), 0)

// ── 전체 요약 (맨 아래): 데이터 유형마다 원본 → 도구 → 웹 결과 → 라이브러리. 카탈로그의 예시·레시피에서 → 예시가 바뀌면 같이 바뀐다 ──
const viewerName = { ol: 'OpenLayers', maplibre: 'MapLibre', deck: 'Deck.gl', cesium: 'CesiumJS' } satisfies Record<ViewerId, string>
const viewerIds: ViewerId[] = ['ol', 'maplibre', 'deck', 'cesium']

// 변환 도구 칸: 셸·스크립트·DB 드라이버는 빼고, 서버는 '서버로도' 칸으로
const toolName = new Map(tools.filter(t => t.type !== 'basic' && t.type !== 'server' && t.id !== 'python' && t.id !== 'psycopg').map(t => [t.id, t.name]))
const serverName = new Map(servers.map(t => [t.id, t.name]))
const serverOf = (o: Output) => (o.path.startsWith('/svc/') ? o.path.split('/')[2] : undefined)
const outName = (k: OutputKind) => (k === 'cog' ? 'COG .tif' : kindExt[k])

const summaryRows = noteCats.flatMap(c => {
  const recipes = formats.filter(f => f.category === c.id && !f.closed).flatMap(f => f.recipes)

  if (!recipes.length) return []
  const outputs = recipes.flatMap(r => r.outputs)
  const names = (ids: (string | undefined)[]) => uniq(ids.flatMap(id => toolName.get(id ?? '') ?? []))
  const viewers = viewerIds.filter(v => recipes.some(r => 'output' in r.viewers[v]))

  return [{
    cells: [
      c.name, c.dim ?? '—',
      uniq(formats.filter(f => f.category === c.id && !f.closed).flatMap(f => f.extensions)),
      uniq(outputs.filter(o => !serverOf(o)).map(o => outName(o.kind))),
      names(recipes.flatMap(r => [...r.preprocess, ...r.convert].map(st => st.tool))),
      uniq(viewers.map(v => viewerName[v])),
      uniq(outputs.flatMap(o => serverName.get(serverOf(o) ?? '') ?? [])) || '—',
    ],
  }]
})

const summaryNote: Note = {
  id: 'summary',
  cat: 'summary',
  kind: '정리',
  title: '전체 요약 — 데이터 유형별 원본 → 도구 → 웹 결과 → 라이브러리',
  answer: `데이터 유형 ${summaryRows.length}가지를 한 줄씩. 시각화 도구의 예시·레시피에서 만든 표라 예시가 바뀌면 같이 바뀐다.`,
  points: [
    '벡터 · 래스터 · 혼합: 도형(점·선·면·입체)이냐, 격자(픽셀)냐, 그 밖(점군·BIM·속성)이냐',
    '차원: 2D(x, y) → 2.5D(한 위치에 높이 하나 — 돌출·DEM) → 3D(한 위치에 높이 여럿 — 메시·솔리드·점군)',
    '웹에 올리는 길: 작으면 파일 통째로, 크면 타일(z/x/y·3D Tiles)로 필요한 부분만, 자주 바뀌면 서버가 요청마다',
    '좌표: 원본은 국내 TM(EPSG:5186 등)·로컬 좌표가 많음 → 웹은 경위도(4326)·Web Mercator(3857)·지심(4978)',
    '라이브러리: 2D 지도는 OpenLayers·MapLibre, 대용량 오버레이는 Deck.gl, 3D 지구본은 CesiumJS',
  ],
  table: { cols: ['유형', '차원', '예시 확장자', '웹 결과', '변환 도구', '라이브러리', '서버로도'], rows: summaryRows },
  tags: ['요약'],
  links: [{ to: '/viz', label: '시각화 도구 노선도' }, { to: '/viz/tools', label: '뷰어·도구' }],
}

export const notes: Note[] = [
  ...topicNotes,
  ...mine.map(n => ({ ...n, kind: '정리' })),
  summaryNote,
]

// 유형 id 오타 → 목록에서 조용히 사라지지 않게
const catIds = new Set(noteCats.map(c => c.id))
const lost = notes.filter(n => !catIds.has(n.cat))

if (lost.length) throw new Error(`notes: 없는 유형 ${lost.map(n => `${n.id}(${n.cat})`).join(', ')}`)
