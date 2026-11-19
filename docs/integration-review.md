# MCP Apps·QGIS 연결 점검 (2026-11-19)

[README로 돌아가기](../README.md)

시각화·주소 변환을 바깥 도구에서 쓰는 두 통로 — AI 대화(MCP Apps)와 QGIS 플러그인 — 의 현재 상태, 검증 범위, 고칠 곳을 정리한다. 코드를 읽고, 떠 있는 개발 서버(:3000)에 읽기 요청만 보내 확인했다. 줄 번호는 이 문서를 쓴 시점 기준이다.

## 한눈에

| 통로 | 상태 | 가장 먼저 고칠 것 |
|---|---|---|
| 시각화 MCP (`ui://geo/app.html`) | 업로드 → 추천 → 변환 → 지도·내려받기 흐름 동작. 공식 AppBridge로 시험 있음 | 앱이 모델에 보내는 알림이 앞 알림을 덮어써 stage id가 사라짐 |
| 주소 변환 MCP (`ui://geo/link.html`) | 최대 20줄 즉시 변환·후보 선택·경계 SHP 동작 | 일괄 작업 도구가 빈 화면을 열고, 결과를 받을 길이 없음 |
| QGIS 웹 지도 변환 플러그인 (0.3.1) | 레이어 → 변환 → 결과 레이어·HTML 지도. Qt5·Qt6 분기 있음 | 네트워크 오류 처리, 상태 확인 실패 시 작업을 잃음 |
| QGIS 주소 변환 플러그인 (0.4.1) | 속성 표 결과 열·직접 검색·점/필지 레이어 | 429가 아닌 오류면 모은 결과를 버림 |

이번에 고친 것: 두 플러그인 metadata에 `supportsQt6=True` 추가. 없으면 Qt6 QGIS(QGIS 4)의 플러그인 관리자가 "incompatible"로 표시해 설치가 막힌다(QGIS `pyplugin_installer/installer_data.py`의 검사). 버전 올림: 웹 지도 0.3.1, 주소 0.4.1(이름도 "주소·코드 변환"으로).

## MCP Apps

### 현재 기능

- 시각화 도구: `geo_identify`(앱 열기)·`geo_recommend`·`geo_convert`(앱 열기)·`geo_status`·`geo_formats`, 앱 전용 `geo_stage_chunk`, `GEO_ENGINE_ENABLED=1`일 때만 `geo_engine`.
- 주소 도구: `geo_link_capabilities`·`geo_link_regions`·`geo_link_resolve`(앱 열기)·`geo_link_run`·`geo_link_status`·`geo_link_export`, 앱 전용 `upload_chunk`·`preview`·`download`·`boundary`. 공개 모드에서는 run~download 6개를 등록하지 않음(`server/mcp/link.ts:70`).
- 앱 리소스: SDK를 HTML 안에 넣어(약 350KB) 외부 스크립트 없음. 시각화 앱은 connectDomains·frameDomains에 사이트 주소, 주소 앱은 connectDomains만.
- 모델이 받는 것: 시각화는 맞춤 글 + structuredContent, 앱이 업로드·조건 변경·변환·완료를 `updateModelContext`로 알림. 주소는 요약 글 + 10행 structuredContent, 전체 결과는 `_meta`로 앱만.

### 검증 범위

| 시험 | 내용 | 서버 필요 |
|---|---|---|
| `tests/viz/recommend.test.ts`, `delivery.test.ts` | 추천·내려받기 규칙 (35개 통과) | 아니오 |
| `tests/viz/mcp-app.test.ts` | 공식 AppBridge로 조건 전달 → 업로드 → 추천 변경 → 변환 → 지도 → downloadFile, 48시간 서비스 | 예 (실제 변환 작업 생성) |
| `tests/link/apps.test.ts` | 주소 앱 화면 흐름 (통과) | 예 (읽기만) |

시험이 없는 부분: 도구 어노테이션·visibility·CSP `_meta`, Origin 403, 시각화 오류 경로, `updateModelContext` 내용. 주소 앱 시험은 직접 만든 postMessage 호스트에 응답을 넣어 주는 방식이라, 모델이 도구를 부른 결과를 앱이 받는 경로는 검증되지 않았다. 직접 연결해 본 클라이언트는 Claude Desktop·Claude Code뿐이고, Claude Code에서는 `geo_link_resolve` 결과가 structuredContent JSON으로만 보였다(글 요약은 안 보임).

### 문제

1. 알림 덮어쓰기: SDK는 마지막 `updateModelContext`만 보낸다. stage id가 든 업로드 알림(`server/assets/mcp-app.html:274`)이 뒤의 조건·방식 변경 알림(221·395·417)에 덮여, 업로드 후 조건만 바꾸고 대화로 돌아오면 모델이 stage id를 모른다.
2. 안내가 글에만: "변환은 자동으로 시작하지 않음"(`server/routes/mcp.ts:111`)과 웹 업로드 주소(223)가 content 글에만 있다. structuredContent를 보이는 호스트에서는 안내가 사라진다.
3. 빈 화면: `geo_link_run`·`geo_link_status`가 주소 앱을 여는데 앱은 rows가 없으면 아무것도 하지 않는다(`server/assets/mcp-link.html:65`).
4. 쓸 수 없는 도구: 앱 전용 `upload_chunk`·`preview`·`download`(`link.ts:85·91·95`)를 부르는 화면이 없고, export 주소는 Mcp-Session-Id 헤더가 있어야 받을 수 있어(`link.ts:83`) 사용자가 받을 방법이 없다.
5. 어노테이션: run·status·export에 없어 호스트가 파괴적 도구로 본다(`link.ts:72·76·81`). resolve·boundary는 VWorld를 부르는데 openWorldHint가 false다(`link.ts:56·101`).
6. 오류 구분: `safe()`(`link.ts:40-46`)가 모든 오류를 INVALID_INPUT으로 바꾸고 기록하지 않는다.
7. 위험 낮음: 비공개 모드 세션 파일 정리 없음(`server/services/link/mcp-access.ts:25`, 24시간 뒤 404 — 재연결 동작은 미확인), 시각화 앱이 origin을 이스케이프 없이 HTML에 넣음(`mcp.ts:349`), `geo_stage_chunk` 조각 순서·중단 조각 정리 없음(`server/utils/stage.ts:53-69`).

### 문서 불일치

- 없앤 url·path 입력과 `MCP_LOCAL_PATHS` 설명이 남아 있다: `docs/visualization.md`(MCP 절), `.env.example`.
- 도구표에 `geo_recommend`·`geo_link_*`와 `GEO_ENGINE_ENABLED`가 없다 (`docs/visualization.md`, README 표).
- 검증 상태가 서로 다르다: `docs/visualization.md`는 "Claude Desktop·Claude Code 직접 확인", README·`app/pages/ai.vue`는 "실제 Claude 연결 미검증".
- 결과 형식(outputKind)은 앱에만 있고, `mcp.ts:220`이 웹 주소에 붙여도 `app/pages/viz/upload.vue`는 읽지 않는다.
- 베타 표시는 시각화 앱에만, 오류 형식은 시각화(글)와 주소(`structuredContent.error`)가 다르다.

## QGIS 플러그인

### 현재 기능

- 웹 지도 변환: 레이어(선택 피처만도 가능)를 GPKG·GeoTIFF로 보내 `POST /api/jobs` → `GET /api/jobs/{id}/info` 2초마다 → 결과를 받아 GeoJSON·MVT·COG·XYZ는 레이어로, HTML 지도는 127.0.0.1 정적 서버로 브라우저에 연다. 예시 데이터는 `/api/qgis/samples`.
- 주소 변환: 속성 표 탭(열 값·도형 위치 → `POST /api/link/resolve` target=all, 외부 조회 켜면 20줄·끄면 200줄씩 → 원본에 g_* 열 또는 새 레이어, 점·필지 레이어), 직접 검색 탭(최대 20줄·좌표·지도에서 찍기), 기준자료 시각.
- 배포: `scripts/qgis-plugins.ts`가 postinstall·prebuild 때 zip·plugins.xml을 만들고 `server/routes/qgis/[file].get.ts`가 내준다. experimental=True, QGIS 3.28~4.99. `app/pages/qgis.vue` 설치 안내는 코드와 맞다.
- 서버 호출은 QgsTask로 화면 밖에서, Qt5·Qt6와 QGIS 버전별 API 분기, 200MB 사전 검사·429 메시지 표시가 있다. 모든 Python 파일 `py_compile` 통과.

### 검증 범위

`npm run test:qgis` = `tests/qgis/plugins_test.py`(실제 변환 3건, 결과 레이어, 미리보기 Range, 주소 변환 전체, 예시 3종, 가짜 iface 패널) + `tests/qgis/desktop_check.py`(Windows, 임시 프로필에서 패널 클릭). 설치된 QGIS, 변환 작업자가 있는 서버, VWORLD 키가 필요하고 CI에는 없다.

시험하지 않은 것: 저장소 주소·ZIP으로 실제 설치(플러그인 관리자 경로 — Qt6 검사가 여기서 걸림), 현재 패널 코드의 QGIS 4·QGIS 3.28, 429·503·타임아웃·프록시·취소, 예시 중 gpkg·gml·그림 래스터, 온라인 래스터 선택.

### 문제

1. 네트워크 오류: `qgis/*/client.py:15-27`의 `_open`이 HTTPError·URLError만 감싸 응답 대기 중 타임아웃·연결 끊김이 영문 "timed out" 등으로 그대로 올라온다.
2. 부분 결과 손실: 주소 `resolve()`(`qgis/geo_address_link/core.py:97-103`)가 429가 아닌 오류면 모은 결과를 모두 버린다(하루 한도는 이미 차감). 429 판정도 문자열 검색.
3. 작업 손실: 웹 지도 상태 확인(`qgis/geo_web_bridge/core.py:129-140`)이 일시 오류 한 번에 포기하고 작업 id·결과 주소를 보여 주지 않는다 → 다시 올리면 하루 1GiB에서 또 차감.
4. 화면 멈춤: 벡터 GPKG 내보내기가 진행 표시·취소 없이 화면 스레드에서 돈다(`qgis/geo_web_bridge/panel.py:164-168`).
5. 취소: 업로드·내려받기·예시 받기(`panel.py:141`)는 취소되지 않고, 끝나면 정상 완료로 처리된다.
6. 정리: unload가 지도 찍기 도구·실행 중 작업을 정리하지 않고(`qgis/geo_address_link/plugin.py:29-35`), busy()가 찍기 버튼을 막지 않아 검색 중 찍으면 작업이 겹친다(`panel.py:338-340`). 임시 폴더·받은 zip을 지우지 않고 업로드는 파일을 메모리에 두 번 올린다.
7. 위험 낮음(미검증): 공개 nginx의 link 경로 초과 응답이 429가 아닌 503(`deploy/public.nginx.conf`) → 2번과 겹치면 큰 표가 통째로 실패. 레이어 목록에 WMS·XYZ 온라인 래스터가 나와 고르면 실패할 수 있음. zip 주소 정규식이 x.y.z 세 자리 버전만 받음(`server/routes/qgis/[file].get.ts:6`). 저장소 XML의 `<icon>`이 비어 있음.
8. 시험 표시: 데스크톱 단계를 건너뛰어도 "데스크톱 통과"로 출력(`scripts/test-qgis.ts:55`).

## 고칠 것

### P1 — 지금

| 할 일 | 파일 |
|---|---|
| `tell()`이 파일·stage·형식·조건·방식·작업 id를 매번 모두 담게 (덮어써도 잃지 않게) | `server/assets/mcp-app.html` |
| 모델용 다음 단계 안내·업로드 주소를 structuredContent에도 | `server/routes/mcp.ts` |
| `geo_link_run`·`status`에서 앱 열기(`_meta.ui`) 빼고 어노테이션 추가 | `server/mcp/link.ts` |
| `_open`과 응답 읽기의 OSError까지 ServerError로, 상태 코드는 속성으로 | `qgis/*/client.py` |
| 주소 `resolve()`가 어떤 오류에서든 부분 결과와 중단 사유를 돌려주기 | `qgis/geo_address_link/core.py` |

### P2 — 다음

| 할 일 | 파일 |
|---|---|
| 쓸 수 없는 MCP 일괄 작업 도구를 없애고 웹 `/link`로 안내 | `server/mcp/link.ts` |
| openWorldHint 바로잡기, `safe()`에서 내부 오류 구분·기록 | `server/mcp/link.ts` |
| 주소 앱도 `updateModelContext`로 고른 후보·결과를 모델에 알림 | `server/assets/mcp-link.html` |
| 문서를 하나의 검증 상태로 맞추고 도구표 갱신 (url·path·MCP_LOCAL_PATHS 삭제) | `docs/visualization.md`, `README.md`, `app/pages/ai.vue`, `.env.example` |
| 서버 없이 도는 MCP 계약 시험 (어노테이션·visibility·CSP) | `tests/viz/` |
| 상태 확인 재시도, 실패하면 결과 주소(info.view) 표시 | `qgis/geo_web_bridge/core.py` |
| 저장소 주소로 실제 설치하는 시험을 QGIS 3.44·QGIS 4 Docker에서, 현재 패널을 Qt6에서 확인 | `scripts/test-qgis.ts`, `docs/ci-cd.md` |
| 벡터 내보내기를 작업으로 옮기거나 진행·취소, 예시 받기 취소 | `qgis/geo_web_bridge/panel.py`, `ui.py` |
| link 경로 `limit_req_status 429;` | `deploy/public.nginx.conf` |

### P3 — 있으면 좋음

- 세션 파일 정리(`mcp-access.ts`), origin 이스케이프(`mcp.ts`), 조각 순서 검사·중단 조각 정리(`stage.ts`)
- outputKind를 웹 업로드도 읽거나 주소에서 빼기(`mcp.ts`·`upload.vue`), 주소 앱 베타 표시
- unload 정리·찍기 버튼 잠금, 임시 파일 정리·업로드 스트리밍, 온라인 래스터 거부(QGIS 플러그인)
- `<icon>` 채우기·버전 정규식 완화(`qgis-plugins.ts`, `[file].get.ts`), 데스크톱 시험 "건너뜀" 표시(`test-qgis.ts`), 개발 서버에서 플러그인 저장소 다시 만들기(`qgis-dev.ts`)

## 더하면 좋을 것

- 두 MCP 앱의 이름·베타 표시·오류 형식을 하나로 (사용자에게는 한 서비스)
- 주소 변환 결과를 시각화로 넘기기: 주소 → 점·필지 결과를 바로 지도 화면(시각화 업로드)으로
- QGIS에서 주소 변환 결과 레이어를 웹 지도 변환으로 이어 보내기 (두 플러그인 사이 버튼)
- 공개 서버에서 Claude.ai·ChatGPT 연결을 실제로 확인한 기록 (지금은 Desktop·Code만)
