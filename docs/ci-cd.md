# CI/CD와 AI 복구의 연결

## 자동 CI

CI는 GitHub Actions 대신 자체 서버에서 실행한다. [`deploy/selfhost-ci.json`](../deploy/selfhost-ci.json)이 source 검사 명령을 고정하고, 서버의 신뢰된 `geo-selfhost-ci.py`가 격리 실행과 산출물 검증을 담당한다. Node.js 24와 lockfile의 의존성을 사용하며 다음 검사는 모두 필수다. 실패 무시나 선택적 성공 처리는 없다.

과거 Quality workflow 원문은 [`.ci/contracts/quality.yml`](../.ci/contracts/quality.yml)에 byte 그대로 보존한다. GitHub 실행 경로 밖의 검증 계약 자료이며, Actions trigger로 실행되지 않는다. 이 이동으로 원문의 승인 SHA-256이나 자체 CI의 필수 검사를 바꾸지 않는다.

1. `npm ci`
2. `npm run lint`: 기존 anti-slop 범위·규칙·오류 수준을 유지한다.
3. `npm run test:lint`: 실제 검사기의 정상·위반 JavaScript/Vue 입력을 검증한다.
4. `npm run test:reference-updates`: 사전 갱신의 임대·동시 요청·중단 복구를 검증한다.
5. 외부 사전 없이 실행되는 주소·코드 단위 검사 10개 파일: `core`, `reference`, `administrative`, `location`, `location-resolve`, `all`, `boundary`, `files`, `jobs`, `chunks`의 `tests/link/*.test.ts`.
6. `npm run test:recommend`: 실제 카탈로그를 사용한 추천과 임시 파일·정리 함수 대역을 사용한 제공 방식 검증이다. 운영 GeoServer나 DB를 변경하지 않는다.
7. `python3 tests/viz/upload-runner.test.py`: 임시 작업 폴더·가짜 변환기/Docker를 사용하고, 실제 Linux 프로세스와 파일 잠금으로 동시 실행·중단 복구·소유권을 검증한다.
8. `npm run build`

이후 `image-build`와 `image-export`까지 성공해야 전체 10단계 CI가 성공한다. 웹 이미지·작업자 source를 같은 revision으로 연결하는 산출물과 원본 격리 증거는 서버 영수증으로 보존한다.

`npm run test:link:unit` 전체를 일반 CI에 그대로 넣지는 않는다. 그 명령이 포함하는 `administrative-service.test.ts`에는 실제 확보한 공식 법정동·행정동 사전을 요구하는 통합 검사가 섞여 있다. 공식 자료가 없는 새 checkout에서는 실패하며, 작은 시험 사전을 공식 자료인 것처럼 주입하거나 그 검사의 assertion을 약화하지 않는다. 위 10개 파일과 별도 갱신 회귀는 운영 사전 없이 실행할 수 있는 기존 검사들이다. 전체 `test:link:unit`은 공식 사전을 별도 경로에 준비한 통합 검증에서 실행한다.

## 실행 환경이 필요한 검사

| 명령 | 필요한 환경과 확인 범위 |
| --- | --- |
| `npm run test:viz` | 실행 중인 dev/preview 서버와 Chrome 또는 `VIZ_BROWSER_PATH`. 탐색·모바일 표시·MCP 리소스 검증이며 실제 지도 데이터 변환 성공을 대신하지 않는다. |
| `npm run test:mcp-app` | 실행 중인 MCP/웹 서버, 브라우저, 파일 업로드·실제 변환 작업자와 변환 도구. 서비스 발행 검사는 별도 GeoServer/PostGIS와 명시적 서비스 허용이 필요하다. 공개 파일 전용 환경에서는 서비스 발행 성공으로 보고하지 않는다. |
| `npm run test:snippets` | 예시 결과(`/data`·`/svc`)를 제공하는 사이트(`VIZ_TEST_URL`)와 Chrome. AI·웹이 주는 적용 코드를 그대로 번들·실행해 뷰어×결과 종류마다 그려지는지, 타일은 최대 줌보다 확대해도 비지 않는지, 독립 HTML 지도(index.html·lib·data)가 열리는지, GeoServer WMTS 범위가 GeoWebCache 격자 안인지 확인한다. 픽셀 판정은 거칠어 `SNIPPET_SHOTS` 화면을 눈으로도 본다. |
| `npm run test:qgis` | 설치된 QGIS(자동으로 찾음, 또는 `QGIS_PYTHON`)와 실제 변환 작업자가 있는 서버(`QGIS_TEST_URL`, 기본 로컬). ① 흐름 시험 `tests/qgis/plugins_test.py` ② Windows는 임시 프로필로 QGIS 데스크톱을 화면 없이 띄워 `tests/qgis/desktop_check.py` — 웹 메뉴·오른쪽 패널(탭)·닫기, 그리고 임시 프로필에서만 서버를 시험 서버로 바꿔 패널을 조작하는 사용 시험(예시 불러오기 → 결과 파일·HTML 지도·래스터 변환, 직접 검색·지도에서 찍기·레이어 값·도형 위치). `QGIS_SHOTS=<폴더>`면 단계별 화면 저장. 사용자 프로필은 건드리지 않는다. 손으로 시험하려면 `npm run qgis:dev`. 패널 구성은 QGIS 3.44에서 실행했다. QGIS 4.3(Qt6)은 대화상자 시절(2026-11-06 이전)에 `qgis/qgis:latest` 컨테이너로 확인했고 패널은 아직 확인하지 않았다. |
| `npm run test:link` | 개발 서버·브라우저·공식 사전과 HTTP/MCP 연결. 주소 제공자와 공식 자료의 실제 가용성 검증은 격리된 통합 환경에서 별도로 수행한다. |
| `npm run check` | 수집·변환한 실제 샘플과 서비스. 운영 원본·DB에 연결한 일반 PR 검사로 실행하지 않는다. |

위 검사는 일반 CI 성공과 구분해 실제로 실행한 환경·revision·결과를 남긴다. `setup`, `pipeline`, `services`, `unreal`은 데이터 수집·컨테이너·엔진 실행 명령이므로 일반 CI의 단위 검사 단계에 자동으로 넣지 않는다.

## 배포와 AI 복구

서버의 `geo-delivery-controller.py`가 등록된 source revision의 자체 CI, 동일 산출물 배포, 공개 동작 검증과 종료 백업을 연결한다. GitHub는 source 저장소로 사용하며 Actions CI나 배포 workflow에 의존하지 않는다. CI 성공은 실제 서비스에 같은 SHA가 배포되었다는 뜻이 아니므로 배포·공개 검증·백업의 실제 영수증을 따로 확인한다. AI 복구의 가동 여부도 DKB의 현재 프로젝트 정책, 원래 작업의 중지·승인·예산과 보호된 실행 증거로 확인하며, 이 문서나 보관 계약만으로 활성화되었다고 판단하지 않는다.

기존 DKB 프로젝트 정책은 `dev-first`, `automaticProductionApproval=false`다. 자동화는 성공한 정확한 source SHA와 산출물을 DEV에 반영하고, PROD는 사람이 승인한 동일 산출물만 승격하는 경계를 유지해야 한다. 현재 공개 URL이 DKB의 DEV 환경으로 등록되어 있으므로 환경 이름과 실제 공개 동작을 함께 확인한다.

geo의 배포는 웹 이미지 하나로 끝나지 않는다. Coolify application의 검증된 웹 이미지와 별도 private 변환 작업자의 source release를 같은 SHA에 맞추고, 기존 원본·결과·샘플·공간 DB·설정을 보존해야 한다. 배포 완료 증거에는 Coolify `finished`, 실제 이미지·작업자의 revision, health·restart, 공개 페이지·MCP·기존 결과 다운로드와 필요한 실제 변환 검증이 포함된다. 백업 완료는 배포 완료와 따로 기록한다.

AI 복구를 연결할 때는 실패한 SHA·단계·로그를 별도 사건으로 저장하고, 격리 작업트리에서 수정한 뒤 같은 필수 CI를 다시 실행한다. 실패를 검사 skip·규칙 완화로 통과시키지 않는다. 중복 사건·동시 배포를 막는 잠금, 재시도 상한, 중단·재개 상태, 검증된 복구점과 배포 후 종료 백업을 연결해야 한다. 이 연결의 실제 설치·실행 결과는 서버 운영 영수증으로 확인하며, 문서에 적힌 설계만으로 동작을 주장하지 않는다.


## 2026-11-05 소스 준비와 executor 인계

이번 작업은 CI 소스 준비와 로컬 검증이다. 등록 완료, 자체 호스팅 CI 성공, DEV 반영, 전체 readiness 또는 PROD 승인 영수증으로 사용하지 않는다.

### 확인한 소스와 기존 gate

등록된 작업트리의 시작 revision은 `defd4c4d23ba21232fc45c5db03b423fd27bf984`, 작업 branch는 `automation/b9460fd1-2b85-4538-86a6-81b7a313fc58`다. 인계 revision은 이 문서 변경을 포함한 최종 commit의 `git rev-parse HEAD` 전체 값으로 지정한다. 호스트 executor는 그 revision을 checkout하고 실제 등록 recipe의 revision·필수 step·산출물 revision과 대조해야 한다. 시작 revision을 최종 검증·배포 revision으로 대체하지 않는다.

`package.json`과 npm lockfile v3를 확인했다. Node engine은 `^22.21.0 || >=24.11.0`, 로컬 Node는 24.19.0, npm은 11.17.0이다. lockfile의 Nuxt 4.6.1, Vue 3.5.44, Oxlint와 `@oxlint/plugins` 1.90.0을 그대로 사용한다. 저장소 및 확인 가능한 상위 작업 공간에 AGENTS.md는 없었다. 별도 typecheck script는 없으며 기존 lint·회귀·build와 환경 의존 검사를 보존한다. anti-slop은 기존 명시 범위 32개 파일과 원본 `13909c9e07590f5a85d93c62712259fe14a883f7`을 유지한다.

기존 `deploy/selfhost-ci.json`은 `schemaVersion=1`, `projectId=geo`, `provider=self-hosted`인 **소스 recipe**다. 실제 호스트 registry에 등록되었다는 증거는 아니다. 다음 8개 step의 argv와 순서를 `.github/workflows/quality.yml`과 대조했다. Python 경로만 자체 호스팅은 `/usr/bin/python3`, GitHub는 `python3`다.

| 필수 step ID | 소스 명령 |
| --- | --- |
| `install` | `npm ci` |
| `lint` | `npm run lint` |
| `lint-tests` | `npm run test:lint` |
| `reference-tests` | `npm run test:reference-updates` |
| `offline-tests` | 위 자동 CI 5번의 기존 10개 파일을 `node --test`로 실행 |
| `recommend-tests` | `npm run test:recommend` |
| `upload-isolation-tests` | `/usr/bin/python3 tests/viz/upload-runner.test.py` |
| `build` | `npm run build` |

recipe는 `artifactSteps=["image-build","image-export"]`도 선언한다. 이 두 단계의 실행 argv·이미지 식별자·digest·export 결과는 소스 JSON에 없으며 호스트 executor의 실제 recipe와 영수증으로 확인해야 한다. 이 작업에서는 이미지를 만들거나 registry·배포 연결을 생성하지 않았다. `deploy/Dockerfile`의 기존 Node 24.19.0 이미지와 `SOURCE_COMMIT` revision label, Coolify compose 및 별도 변환 작업자 계약을 유지한다.

소스 SHA-256:

- `deploy/selfhost-ci.json`: `b75c194bcde6c48c61203496987a710f59e4a20a1c8f26f533284ae42ed8c687`
- `.github/workflows/quality.yml`: `459c8b2e48bd2375f7d123f71d81d59fb929216817b80211d619158ff07f2a65`
- `package-lock.json`: `2287463cc8ee4b03bfecb681a91cb7338b07ccd2b1ca0f33810a0ffea25fa7e0`

### 미연결·미확인 단계

| 단계 | 현재 근거와 호스트 executor의 별도 확인 |
| --- | --- |
| 실제 등록 recipe | 세션 도구에 호스트 recipe registry 조회가 없다. 소스 JSON만 확인했으며 등록 ID·revision·필수 8단계와 artifact 2단계의 실제 등록 여부는 미확인이다. |
| 자체 호스팅 CI | 로컬 실행은 호스트 CI run이 아니다. 최종 source SHA의 실제 run ID·각 step 종료 결과·이미지 digest·export 영수증이 필요하다. GitHub workflow의 존재도 원격 run 성공 증거가 아니다. |
| DEV | 기존 문서의 dev-first 정책을 유지한다는 가정이다. 현재 DKB `owner/geo`의 `wiki_context`는 `permission_denied`여서 실제 최신 delivery 정책과 연결을 재확인하지 못했다. 기존 Coolify 연결을 재사용하고 웹·변환 작업자의 동일 revision, health 및 필요한 통합 검증을 별도 확인한다. |
| PROD | 운영 승인과 승격을 실행하지 않았다. `automaticProductionApproval=false`라는 기존 계약을 완화하지 않는다. 준비 완료로 승인·중지 gate를 해제하지 않는다. |
| 백업·복원 | 실행하지 않았다. 기존 복구점과 생성 시각, 파일·원본·결과·공간 DB·GeoServer 설정의 보호 범위, 일관된 snapshot·격리 복원·종료 백업 영수증이 필요하다. |
| 제한된 AI 실패 복구 | 활성화·시험하지 않았다. 실제 실패 사건·SHA·로그, 격리 worktree, 필수 CI 재실행, 중복/동시 실행 잠금, 재시도 상한과 중단/재개, 기존 복구점 연계의 실제 executor 검증이 필요하다. 문서나 작업자의 중단 복구 단위 테스트를 AI 복구 검증으로 해석하지 않는다. |
| 환경 의존 QA | 위 표의 `test:mcp-app`, `test:link`, 전체 `test:link:unit`, `check`는 필요한 브라우저·공식 사전·실제 변환기·DB가 준비된 별도 환경에서 확인한다. 이번 일반 CI 준비에서 실행하거나 통과했다고 주장하지 않는다. `test:viz` 로컬 탐색 검증은 아래 추가 기록과 구분한다. |

DKB 공통 강제 원문은 제공된 snapshot의 `mandatoryComplete=true`로 확인했고, 두 Skill package를 활성 MCP로 읽어 카탈로그의 SHA-256과 일치함을 확인했다. 지식 읽기 권한 거부를 다른 credential이나 로컬 Wiki로 우회하지 않았다. 새로운 런타임·DB·secret·권한·외부 서비스·배포 경로를 추가하지 않았다.


### 2026-11-16 추가 구현과 로컬 검증

사용자의 추가 요청에 따라 `/viz/study`에 기존 카탈로그의 26개 포맷·44개 도구를 한 페이지로 모았다. 확장자·설명 검색, 유형 필터, 파일 구성·변환 경로·결과 선택 이유, 도구별 입력/출력·특징·명령 예시·공식 자료와 면접 질문 8개를 제공한다. 홈과 공통 푸터에서 연결하며 새 데이터 수집이나 변환 서비스를 시작하지 않는다. 면접 설명의 GeoJSON·COG·PMTiles 차이는 페이지에 연결한 RFC/GDAL/Protomaps 공식 자료와 대조했다.

최종 변경 소스에서 기존 recipe의 로컬 명령을 순서대로 실행했다. `npm ci`는 기존 lockfile로 성공했으며 lint, lint-tests 3개, reference-tests 11개, offline-tests 111개, recommend-tests 26개, upload-isolation-tests 8개, build가 모두 exit 0이다. lint 범위는 기존 32개를 보존하고 학습 페이지·홈·layout을 포함한 35개다. 총 159개 회귀 검사에는 실패·skip이 없다. 별도 typecheck script는 없어 typecheck 통과를 주장하지 않는다. install의 npm audit는 취약점 29개(낮음 3·중간 16·높음 10)를 보고했으며 이 작업에서 의존성을 임의 갱신하지 않았다. build는 번들 크기 및 의존 패키지 주석 경고를 내면서 성공했다.

빌드 결과를 loopback에서 실행해 Chromium으로 26개 포맷·44개 도구 렌더링, 검색·빈 결과·점군 유형 필터, 도구 anchor, 답안 펼치기, 홈 진입 링크와 1440/390px 가로 넘침 없음을 확인했다. pageerror는 없었다. 기존 Chrome symlink의 대상이 없어 최초 브라우저 실행은 실패했고, 이미 선언된 Playwright 1.64.1의 headless shell을 gitignored `.data/browser`에 준비해 검증했다. `.tif` 검색은 설명까지 검색하므로 결과가 4개인 것을 확인하고 최초 검증의 잘못된 기대값 3을 바로잡았다. 운영 브라우저나 서버 런타임을 설치·변경한 것은 아니다.

`VIZ_TEST_URL`을 loopback 빌드 서버에, `VIZ_BROWSER_PATH`를 위 headless shell에 지정한 기존 `npm run test:viz`도 3개 모두 통과했다. 이는 화면 탐색·MCP 리소스 검사이며 실제 데이터 변환 검증을 대신하지 않는다.

로컬 검증 로그와 화면 증거는 gitignored `.data/ci-preparation/`의 step별 `.log`, `study-browser.json`, `study-mobile.png`에 보존한다. 이 기록은 원격 호스트 CI 영수증이나 DEV/PROD 승인·백업·AI 복구의 증거가 아니다. 최종 source revision은 이 변경을 포함한 commit의 전체 HEAD로 인계한다.
