# 공간 데이터 웹 처리

공간 데이터 유형·확장자별 웹 처리 과정 정리 사이트. 확장자마다 실제 국내 공개 원본을 받아 수집 → 전처리 → 웹 형태 변환을 Docker로 돌리고, 결과를 OpenLayers·MapLibre·MapLibre + Deck.gl·Cesium에서 비교.

## 구성

| 경로 | 내용 |
|---|---|
| `app/pages/index.vue` | 홈: 노선도, 유형 카드, 확장자 선택 창 |
| `app/pages/[category]/[format]/[[step]].vue` | 확장자 4단계 화면: 수집(`/유형/확장자`), 전처리(`/preprocess`), 웹 형태 변환(`/convert`), 화면 비교(`/view`) |
| `app/pages/tools`, `sources`, `status`, `concepts` | 뷰어·도구, 수급처, 현황, 개념 |
| `app/components/viewers/` | 뷰어 4종. 결과물 종류(`OutputKind`)별 로딩 코드 |
| `shared/catalog/<유형>/<확장자>.ts` | 확장자 spec 하나 = 확장자 하나 (`_`로 시작하는 파일은 spec 만드는 도우미) |
| `shared/catalog/sources.ts`, `tools.ts`, `origins.ts`, `terms.ts` | 수급처, 도구, 확장자 출신(표준/회사), 용어 |
| `scripts/pipeline.ts` | 수집·전처리·변환 실행기. spec의 `run` 명령을 도구 이미지 안에서 그대로 실행하고 기록(report.json) 작성 |
| `scripts/check.ts` | 카탈로그·기록 검사 |
| `pipeline/Dockerfile`, `pipeline/scripts/` | 로컬 도구 이미지(geo-web/tools), 단계용 보조 스크립트 |
| `pipeline/raw/` | 받은 원본 (git 제외, `npm run setup`으로 생성) |
| `public/data/` | 변환 결과·기록: `collect.json`, `<레시피>/report.json`, `status.json`, 내려받기용 `raw/`·`raw.zip` (git 제외, `npm run setup`으로 생성) |
| `server/` | 내 파일 업로드 작업 API (`/api/jobs` → `pipeline.ts --job`) |

## 실행

```sh
npm install
npm run setup                                 # 샘플 원본 수집 + 전체 변환 (= pipeline all, 처음 한 번)
npm run dev                                   # http://localhost:3000
npm run pipeline -- <유형>/<확장자> [--recollect]   # 수집(--recollect 시 다시 받기) + 모든 레시피
npm run pipeline -- <유형>/<확장자>/<레시피>        # 레시피 하나만
npm run pipeline -- all                       # 전부 (닫힌 확장자는 건너뜀)
npm run pipeline -- --status                  # status.json만 다시 쓰기
npm run check                                 # 검사
```

- Docker 필요. `local:tools` 이미지는 처음 쓸 때 자동 빌드, 나머지는 공개 이미지(`shared/catalog/tools.ts`의 `image`).
- `.env`: `NUXT_PUBLIC_VWORLD_KEY`(배경지도, 없으면 OSM). `.env.example` 참고.
- `shared/catalog`에 파일 추가·삭제 시 개발 서버 재시작 (확장자 목록은 빌드 템플릿 `#build/catalog-formats`).

## 샘플 기준

- **국내 기관 원본만.** 정부·지자체·공공기관 배포 데이터. 한국 범위라도 해외 플랫폼(OSM, Sentinel 등)은 제외.
- **그 형식 그대로.** 같은 형식 안에서 범위 자르기·점 솎기는 허용, 다른 형식에서 변환한 샘플은 불가.
- **자동 수집 가능.** 로그인·신청서 없이 스크립트로 다운로드.
- **재배포 허용.** 이용허락범위 제한 없음, 공공누리 1유형 등. 공공누리 3·4유형, VWorld 데이터, AI Hub는 제외.
- 조건에 맞는 원본이 없으면 spec에 `closed: '이유'` → 화면 "샘플 없음", 파이프라인 건너뜀. 설명·레시피는 그대로 두어 원본을 찾으면 다시 열기.

## 현재 샘플

| 확장자 | 원본 |
|---|---|
| 2D `.shp` | 서울시 상권분석서비스 영역 (서울 열린데이터광장 OA-15560) |
| 2D `.geojson` | 소상공인시장진흥공단 회식상권 (공공데이터포털 15167536) |
| 2D `.gpkg` | 한국산업인력공단 국가기술자격 시험장 (공공데이터포털 15150897) |
| 2.5D `.shp` | 경기도 과천시 새주소건물 (공공데이터포털 15146680) |
| 래스터 `.tif` | 산림청 산사태위험지도 제주시 (공공데이터포털 15074817) |
| 지형 `.tif` | 국립공원공단 북한산 DEM (공공데이터포털 15003715) |
| 점군 `.las` | 국립공원공단 치악산 둘레길 실측 (공공데이터포털 15095240) |

샘플 없음: `.mvt`, `.pmtiles`, `.fgb`, `.gml`, 2.5D `.geojson`, COG, `.jpg`, `.png`, `.webp`, `.img`, `.terrain`, `.laz`, `.pnts`, CityGML, `.glb`, `.gltf`, `.i3dm`, `.ifc`. 이유는 각 spec의 `closed`와 확장자 선택 창 `?`.

## 확장자 추가·다시 열기

1. `shared/catalog/<유형>/<확장자>.ts`: `collect`(출처·수집 단계), `recipes`(전처리·변환 단계, 출력, 뷰어별 사용), `upload`, `view`. 닫힌 확장자는 `collect`를 국내 원본으로 바꾸고 `closed` 삭제.
2. 수급처가 새로우면 `sources.ts`에 추가 (국내면 `domestic: true`).
3. 새 확장자면 `origins.ts`에 출신(표준/회사) 추가.
4. `npm run pipeline -- <유형>/<확장자> --recollect`
5. `npm run check`

설명 문구: 단어로 끝내기(~요·~니다 금지), 필요한 말만. 단계 `why`는 옵션별 로직(`옵션: 효과`), 검사 단계 제목은 `무결성 확인`.

## 검사 (`npm run check`)

- 카탈로그: 유형·수급처·도구·출신 존재, 뷰어가 결과물 종류 지원, 업로드 레시피가 `$INPUT`만 읽고 DB 도구 미사용
- 열린 확장자: 국내 수급처, 수집 기록 = 원본 폴더, 원본 내려받기 가능
- 레시피: 기록이 지금 명령과 같음(명령을 고치면 다시 실행), 모든 단계 성공, 출력 파일 존재
- 문자열: 백슬래시 하나(`\(` 등) 사라짐 방지, 설명 문구 말투

## 참고

- 원본 50MB 이하만 사이트에 게시, 파일 7개 이상이면 `raw.zip` 하나로.
- 업로드 작업: 네트워크 차단 컨테이너, 메모리 4GB·CPU 2, 단계당 20분, 결과는 24시간 뒤 삭제.
- 시행착오 기록: 각 단계 `why`, 그리고 `scripts/check.ts` 주석.
