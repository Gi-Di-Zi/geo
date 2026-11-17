# 공간 데이터 학습 페이지 합본 검증

2026-11-16에 같은 기준 `defd4c4d23ba21232fc45c5db03b423fd27bf984`에서 갈라진 두 작업을 별도 복사본에서 병합했다.

- `bec54b03d10cd7bc1625aa7a009c4434ce62d3a1`: 26개 포맷의 구조·특징·전처리/변환/출력·대안, 44개 도구의 역할·입출력·공식 자료·명령 예시와 비교 질문.
- `96ab045071c0b4b2b0118926f3ac36a89b578dd1`: DEM·DSM, 지리/투영 좌표계·축·높이 기준, 관련 면접 답변과 추가 복습 컴포넌트.

최신 작업을 첫 번째 부모로 두고 이전 작업을 병합했다. `/viz/study`는 기존 상세 카탈로그를 유지하면서 `StudyConcepts`와 `StudyReview`를 함께 보여 준다. 포맷·도구 검색과 유형 필터, 목차, 빈 결과 안내를 유지한다. 기본 개념 화면에서도 최신 개념 컴포넌트를 재사용한다. 기존 8개 비교 질문과 추가 8개 기초 답변은 제목과 영역을 구분하며, DEM·좌표계 질문 2개도 포함한다. 탐색 링크와 lint 입력은 두 작업의 합집합이다.

`docs/ci-cd.md`와 `docs/study-validation.md`의 원래 검사 결과는 각 후보를 검사한 당시의 기록이다. 최신 후보에서 전체 의존성이 없어 빌드하지 못했던 한계는 이번 별도 합본의 빌드 성공과 구분한다.

## 실행한 검사

기존 manifest·lockfile은 변경하지 않았다. 같은 lockfile의 기존 의존성을 재사용하고 Nuxt·Vue·Oxlint/plugins·Playwright·esbuild·Zod·proj4의 실제 설치 버전이 lock과 일치함을 확인했다. 설치나 다운로드는 추가하지 않았다.

- `npm run lint`: 통과. 두 후보의 모든 추가 파일을 기존 error 규칙으로 검사했다.
- `npm run test:lint`: 3개 통과.
- `npm run test:reference-updates`: 11개 통과.
- `deploy/selfhost-ci.json`의 기존 offline Node 검사: 111개 통과.
- `npm run test:recommend`: 26개 통과.
- `python3 tests/viz/upload-runner.test.py`: 8개 통과.
- `npm run build`: 통과. 320개 경로를 생성하고 Nitro 서버를 빌드했다.
- 빌드된 정적 파일을 별도 로컬 서버에서 열어 Chrome sandbox로 1365px·390px 화면을 확인했다. 26개 포맷·44개 도구, 검색·유형 필터·빈 결과·초기화, 목차·답변 펼치기와 DEM·DSM·좌표계·높이 설명을 확인했고 가로 넘침과 페이지 오류는 없었다. 외부 요청과 비GET 요청은 차단했다.
- `git diff --check`: 통과.

## 아직 수행하지 않은 작업

이 결과는 격리된 소스 합본과 로컬 검증이다. 원래 두 작업 폴더, 작업 DB, 등록 main, 기존 사용자 자료는 변경하지 않았다. 호스트 CI의 새 영수증·이미지와 실제 DEV 배포는 별도 실행 및 검증이 필요하다. 이 문서나 로컬 빌드를 CI·DEV·PROD 완료 증거로 사용하지 않는다. PROD는 DEV 검수 뒤 별도 승인을 유지한다.
