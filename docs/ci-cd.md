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
