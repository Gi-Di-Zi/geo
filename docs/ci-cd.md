# CI/CD와 AI 복구의 연결

## 자동 CI

`.github/workflows/quality.yml`의 `Quality / quality`는 pull request와 `main`·`deploy/**` push에서 실행한다. Node.js 24와 lockfile의 의존성을 사용하고, 다음 단계가 모두 성공해야 job이 성공한다. 실패 무시나 선택적 성공 처리는 없다.

1. `npm ci`
2. `npm run lint`: 기존 anti-slop 범위·규칙·오류 수준을 유지한다.
3. `npm run test:lint`: 실제 검사기의 정상·위반 JavaScript/Vue 입력을 검증한다.
4. `npm run test:reference-updates`: 사전 갱신의 임대·동시 요청·중단 복구를 검증한다.
5. 외부 사전 없이 실행되는 주소·코드 단위 검사 10개 파일: `core`, `reference`, `administrative`, `location`, `location-resolve`, `all`, `boundary`, `files`, `jobs`, `chunks`의 `tests/link/*.test.ts`.
6. `npm run test:recommend`: 실제 카탈로그를 사용한 추천과 임시 파일·정리 함수 대역을 사용한 제공 방식 검증이다. 운영 GeoServer나 DB를 변경하지 않는다.
7. `python3 tests/viz/upload-runner.test.py`: 임시 작업 폴더·가짜 변환기/Docker를 사용하고, 실제 Linux 프로세스와 파일 잠금으로 동시 실행·중단 복구·소유권을 검증한다.
8. `npm run build`

`npm run test:link:unit` 전체를 일반 CI에 그대로 넣지는 않는다. 그 명령이 포함하는 `administrative-service.test.ts`에는 실제 확보한 공식 법정동·행정동 사전을 요구하는 통합 검사가 섞여 있다. 공식 자료가 없는 새 checkout에서는 실패하며, 작은 시험 사전을 공식 자료인 것처럼 주입하거나 그 검사의 assertion을 약화하지 않는다. 위 10개 파일과 별도 갱신 회귀는 운영 사전 없이 실행할 수 있는 기존 검사들이다. 전체 `test:link:unit`은 공식 사전을 별도 경로에 준비한 통합 검증에서 실행한다.

## 실행 환경이 필요한 검사

| 명령 | 필요한 환경과 확인 범위 |
| --- | --- |
| `npm run test:viz` | 실행 중인 dev/preview 서버와 Chrome 또는 `VIZ_BROWSER_PATH`. 탐색·모바일 표시·MCP 리소스 검증이며 실제 지도 데이터 변환 성공을 대신하지 않는다. |
| `npm run test:mcp-app` | 실행 중인 MCP/웹 서버, 브라우저, 파일 업로드·실제 변환 작업자와 변환 도구. 서비스 발행 검사는 별도 GeoServer/PostGIS와 명시적 서비스 허용이 필요하다. 공개 파일 전용 환경에서는 서비스 발행 성공으로 보고하지 않는다. |
| `npm run test:link` | 개발 서버·브라우저·공식 사전과 HTTP/MCP 연결. 주소 제공자와 공식 자료의 실제 가용성 검증은 격리된 통합 환경에서 별도로 수행한다. |
| `npm run check` | 수집·변환한 실제 샘플과 서비스. 운영 원본·DB에 연결한 일반 PR 검사로 실행하지 않는다. |

위 검사는 일반 CI 성공과 구분해 실제로 실행한 환경·revision·결과를 남긴다. `setup`, `pipeline`, `services`, `unreal`은 데이터 수집·컨테이너·엔진 실행 명령이므로 일반 CI의 단위 검사 단계에 자동으로 넣지 않는다.

## 배포와 AI 복구

2026-11-02 연결 조사 시점에는 GitHub push CI가 자동 실행되었으나 Coolify 자동 배포는 꺼져 있었고, GitHub webhook·배포 workflow·배포 runner/secrets가 연결되지 않았다. CI 성공은 실제 서비스에 같은 SHA가 배포되었다는 뜻이 아니다. 이 문서와 Quality workflow 변경만으로 CD나 AI 복구가 활성화되지는 않는다.

기존 DKB 프로젝트 정책은 `dev-first`, `automaticProductionApproval=false`다. 자동화는 성공한 정확한 source SHA와 산출물을 DEV에 반영하고, PROD는 사람이 승인한 동일 산출물만 승격하는 경계를 유지해야 한다. 현재 공개 URL이 DKB의 DEV 환경으로 등록되어 있으므로 환경 이름과 실제 공개 동작을 함께 확인한다.

geo의 배포는 웹 이미지 하나로 끝나지 않는다. Coolify application의 검증된 웹 이미지와 별도 private 변환 작업자의 source release를 같은 SHA에 맞추고, 기존 원본·결과·샘플·공간 DB·설정을 보존해야 한다. 배포 완료 증거에는 Coolify `finished`, 실제 이미지·작업자의 revision, health·restart, 공개 페이지·MCP·기존 결과 다운로드와 필요한 실제 변환 검증이 포함된다. 백업 완료는 배포 완료와 따로 기록한다.

AI 복구를 연결할 때는 실패한 SHA·단계·로그를 별도 사건으로 저장하고, 격리 작업트리에서 수정한 뒤 같은 필수 CI를 다시 실행한다. 실패를 검사 skip·규칙 완화로 통과시키지 않는다. 중복 사건·동시 배포를 막는 잠금, 재시도 상한, 중단·재개 상태, 검증된 복구점과 배포 후 종료 백업을 연결해야 한다. 이 연결의 실제 설치·실행 결과는 서버 운영 영수증으로 확인하며, 문서에 적힌 설계만으로 동작을 주장하지 않는다.
