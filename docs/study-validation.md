# 학습 설명 확장 작업 상태 (2026-11-16)

## 구현과 가정

- 현재 checkout에는 이전 대화의 study 페이지와 커밋 객체가 없으므로 현재 카탈로그를 재사용해 `/viz/study`를 구성했다. 확장자 특징·구조·변환 경로와 도구 특징·입출력·명령 예시, 검색·유형 필터를 제공한다.
- DEM·DSM의 지면/표면 차이, 용도, 확장자와 의미의 구분, nDSM 비교 조건과 면접 질문을 추가했다.
- 사용자의 “타원 좌표계”를 기준 타원체의 지리 좌표계로 해석했다. 투영 좌표계와의 관계, 단위·왜곡·축 순서, CRS 지정/변환, 타원체고/정표고를 설명했다.
- 기본 개념 페이지에서도 같은 설명 컴포넌트를 사용한다. 홈·푸터에서 학습 페이지로 접근한다.
- 일반 면접 복습 8개와 새 개념 질문 2개를 제공한다. 일반 복습은 SHP·인코딩, GeoJSON/MVT, COG/Range, glTF/GLB, 점군/메시, 변환 무결성, 파일/서비스, 도구 선택을 다룬다.
- 신규 Vue 파일을 기존 mandatory lint 범위에 추가했다. 기존 gate를 유지했다.
- 설명 근거는 화면의 USGS·Esri·PROJ 공식 자료 링크에서 확인할 수 있다.

## 검증 증거

기준 parent HEAD: `defd4c4d23ba21232fc45c5db03b423fd27bf984`. 최종 commit은 현재 automation branch의 Git 이력과 작업 결과에서 확인한다.

전체 `npm ci`는 디스크 공간 부족(ENOSPC)으로 실패했다. 첫 확인 시 가용 공간은 약 557MB였다. 다른 프로젝트의 자료·원본을 정리하지 않았다.

실행 가능한 검사에 필요한 의존성만 gitignored `.data/validation/`에 준비했다. 원본 `package-lock.json`에서 Oxlint/plugins, Zod, ExcelJS, archiver, shp-write, proj4, Vue SFC compiler, h3와 그 의존성의 정확한 lock 항목·integrity를 추출한 부분 lockfile로 `npm ci --prefix .data/validation --ignore-scripts`를 실행했다. 설치된 185개 package의 버전을 원본 lockfile과 대조해 차이 0개를 확인했다. root manifest·lockfile은 변경하지 않았다. 이 부분 설치는 전체 프로젝트 `npm ci` 성공을 의미하지 않는다.

| 검사 | 결과 |
| --- | --- |
| `npm run lint` | 통과. 신규 학습 페이지를 포함한 기존 범위에 동일 error 규칙 적용 |
| `npm run test:lint` | 3개 통과. 정상 JS/Vue와 신규 위반 차단 확인 |
| `npm run test:reference-updates` | 11개 통과 |
| CI recipe의 offline Node 검사 10개 파일 | 111개 통과 |
| `npm run test:recommend` | 26개 통과 |
| `python3 tests/viz/upload-runner.test.py` | 8개 통과 |
| Vue SFC compiler | study·concepts 페이지와 StudyConcepts·StudyReview의 script/template 컴파일 통과 |
| `git diff --check` | 통과 |
| `npm run build` | 실패: 부분 설치에 Nuxt 실행 파일이 없어 `nuxt: not found` |
| 실제 Nuxt 브라우저 검사 | 미실행: 전체 설치·빌드 필요 |

기존 회귀는 합계 159개 통과했다. 호스트의 동시 스레드 한도로 초기 병렬 검사에서 Oxlint가 중단되어, `RAYON_NUM_THREADS=2`, `TOKIO_WORKER_THREADS=2`를 사용해 다시 실행했다. 검사 규칙과 assertion은 변경하지 않았다. 임시 입력은 등록 worktree 안에서 생성했다. 최종 실행 로그는 gitignored `.data/validation/`에 남겼다.

코드 리뷰에서 코드 예시의 전경/배경 대비와 sticky 메뉴 아래 목차 제목이 가려지는 CSS 문제를 수정했다. 이 검토와 SFC 컴파일은 실제 브라우저·모바일 검증을 대신하지 않는다.

## 미완료와 인계

1. 호스트에서 이 작업 볼륨의 여유 공간을 확보해야 한다. 등록 worktree 밖의 정리나 sudo 작업은 수행하지 않았다.
2. 전체 lockfile 그대로 `npm ci` 후 `deploy/selfhost-ci.json`의 모든 필수 단계를 완료해야 한다. 부분 의존성 설치·회귀 성공을 전체 CI 통과로 취급하지 않는다.
3. Nuxt에서 데스크톱·모바일 검색, 유형 필터, 빈 결과, 면접 답안 펼치기, 목차 이동, 코드 대비, 가로 넘침을 검증해야 한다.
4. 소스 diff를 검토하고 필수 검사를 실행한 뒤 승인된 작업 branch commit 정책에 따라 현재 automation branch에 변경을 기록한다. 이 커밋은 CI·배포 gate를 대체하지 않는다.
5. 전체 필수 CI가 통과한 정확한 source revision을 별도 controller의 DEV 검증과 운영 승인 단계로 넘겨야 한다. 기존 저장 문서의 `dev-first`, `automaticProductionApproval=false` 계약을 유지하며 현재 실행 권한의 production 배포·push 금지를 따른다.

현재 공개 동작·Coolify finished·runtime revision은 확인하지 않았고 배포 성공을 주장하지 않는다. sudo가 필요한 명령을 실행하지 않았으며 비밀값 조회·외부 메시지·Git push도 하지 않았다.
