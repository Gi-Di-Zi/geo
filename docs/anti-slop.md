# MCP·업로드 변경의 anti-slop 검사

2026-11-01에 MCP Apps와 업로드 변환 경로를 수정하면서 검사기를 연결했습니다. 이번 린트 범위는 해당 변경 경로와 그 회귀 검사입니다. 기존 저장소 전체를 이전하거나 모든 과거 코드가 통과했다고 주장하지 않습니다.

## 원본과 의존성

- 공식 원본: https://github.com/dmmulroy/anti-slop
- 고정 commit: `13909c9e07590f5a85d93c62712259fe14a883f7`
- 공식 fresh installer가 `skills/install-anti-slop/assets/anti-slop/`를 `tools/oxlint/anti-slop/`에 새로 복사했습니다. 기존 경로를 덮어쓰지 않았고 복사한 모든 원본 파일의 bytes를 대조했습니다.
- 원본 commit의 MIT LICENSE, 내장 `vendor/eslint-stylistic/LICENSE` 및 `UPSTREAM.md`를 보존했습니다. 프로젝트 설치 경로·옵션·출처는 플러그인 옆 `UPSTREAM.md`에 기록합니다.
- 기존 Oxlint가 없으므로 설치 시 npm registry의 두 버전을 각각 조회한 뒤, 일치하는 `oxlint` / `@oxlint/plugins` **1.90.0**을 dev dependency에 exact 고정했습니다. 기존 package manager와 다른 의존성 범위는 유지했습니다.
- 실제 실행 환경은 Node24.19.0입니다. 저장소의 기존 Node engine 범위를 임의로 확장하거나 축소하지 않았습니다.

## 실제 검사 범위

`npm run lint`는 `scripts/lint-scope.mjs`를 실행합니다. 스크립트가 아래 파일의 존재를 모두 확인한 뒤, 같은 `.oxlintrc.json`과 `--deny-warnings`로 실제 Oxlint를 실행합니다. 파일이 누락되거나 검사기/플러그인 로딩이 실패하면 성공으로 처리하지 않습니다.

- `server/routes/mcp.ts`
- `server/utils/jobs.ts`, `stage.ts`, `catalog.ts`, `upload-storage.ts`, `job-files.ts`
- `server/middleware/conversion-worker.ts`
- `server/services/link/reference-updates.ts`, `tests/link/reference-updates.test.ts`
- `server/api/jobs.post.ts`, `server/api/stage.ts`
- `server/api/jobs/[id]/files/[...path].get.ts`
- `server/api/jobs/[id]/download/[output].ts`
- `shared/conversion.ts`
- `app/pages/ai.vue`, `app/pages/viz/upload.vue`의 SFC script
- `scripts/pipeline.ts`
- `scripts/lint-scope.mjs`, `scripts/lint-scope.test.mjs`
- `tests/viz/mcp-app.test.ts`, `tests/viz/mcp-app-host.ts`

국내 주소·코드 연계에서는 동시 사전 갱신을 수정한 파일과 회귀 검사를 포함합니다. 변경 없는 연계 구현과 나머지 기존 뷰어·카탈로그·스크립트는 이번 부분 이전의 대상이 아닙니다. 범위를 줄여 신규 위반을 허용한 baseline은 없습니다. `node_modules`, Nuxt 생성물, 업로드/파이프라인 결과, 비공개 agent 자산, vendored 검사기는 애플리케이션 검사에서 제외합니다. 모든 숨김 디렉터리나 모든 도구·테스트를 통째로 제외하지 않습니다.

## 활성 기준과 진입점

일반 규칙18개와 native `oxc/no-accumulating-spread`를 모두 `error`로 등록했습니다. Effect 직접 의존성이나 사용 요청이 없어 opt-in Effect 규칙은 켜지 않았습니다. `no-runtime-typeof`에는 공식 `allowInTypeGuards:true`를 사용해 명시적 type predicate/assertion의 경계 검사만 허용하며, 그 밖의 임의 타입 분기는 오류로 남습니다. 이 옵션은 데이터의 업무 유효성을 대신 검증하지 않습니다. assertion에 형식적인 주석만 붙여 통과시키지 않고 실제 불변 조건을 확인해야 합니다.

`.github/workflows/quality.yml`은 PR 및 `main`·`deploy/**` push에서 Node24의 `npm ci → npm run lint → npm run test:lint → npm run test:reference-updates → npm run build`를 실행합니다. 공식 `actions/checkout`·`actions/setup-node` v7 태그를 upstream에서 조회해 각각 `3d3c42e5aac5ba805825da76410c181273ba90b1`·`949feb2413d6458794dcd2491c4babbbce0c15c1` commit으로 고정했습니다. 워크플로 작성과 GitHub에서 실제 통과한 상태는 구분합니다. 자동 배포·추가 secret·다른 프로젝트 작업은 넣지 않았습니다.

기존 명령은 보존하고 `dev`, `build`, `generate`, `setup`, `pipeline`, `check`, `test:viz`, `test:mcp-app`, `test:lint`, `test:reference-updates`, `test:link:unit`, `test:link`의 npm 선행 hook에 린트를 연결했습니다. 데이터 준비나 웹 시작보다 먼저 검사합니다. 직접 Node/CLI를 호출하는 실행까지 자동 통제한다는 뜻은 아닙니다. 배포 전에 정식 npm 진입점과 필요한 실제 검증을 실행해야 합니다.

```sh
npm run lint
npm run test:lint
npm run build
```

`npm run lint -- --fix`는 이 명시 범위에 spacing fix를 적용합니다. 이 저장소에는 기존 formatter가 없으므로 임의 formatter preset을 추가하지 않았습니다. 의미 변경은 각 소유 파일의 기능 검증과 리뷰가 필요하고, fix 후 두 번째 실행이 파일을 바꾸지 않는지 확인합니다.

## 도입 검증과 초기 진단

초기7개 기존 파일에서224개 오류를 실제 검출했습니다(206 spacing,13 assertion 불변 조건,3 known-value widening,1 chained assertion,1 runtime typeof). 이 수치를 baseline으로 허용하지 않으며 새 범위의 모든 오류를 고친 뒤 lint 성공이 배포 조건입니다. 실제 도입 중간/최종 실행 상태는 작업 증거에 별도 기록합니다.

`scripts/lint-scope.test.mjs`는 모듈을 mock하지 않고 실제 설치된 CLI·동일 설정을 호출합니다. 정상 JavaScript와 Vue script는 성공하고 새 JavaScript 위반과 Vue script의 chained assertion은 비0 종료와 해당 규칙 진단을 내는지 확인했습니다. 초기 contract 테스트3개가 통과했습니다. 품질 스크립트 자체도 검사하며 두 번째 spacing fix가 bytes를 바꾸지 않음을 확인했습니다. 기존 build·portfolio·전체 데이터 검사와 실제 MCP Apps/업로드 검증을 대체하지 않습니다.

원본 대조·초기 진단·실행 증거는 `ops/runs/20261101-geo-mcp-upload/anti-slop-*.json` 및 `anti-slop-contract.log`에 보존합니다. 기준선·규칙 disable·severity 강등·검사 실패 무시는 사용하지 않았습니다. 이후 JS/TS/Vue 파일을 추가로 변경하면 이 명시 범위에도 넣습니다.

초기 도입 연결 확인: 정식 `npm run lint`가19개 명시 파일에서 exit0으로 끝났고, 이어서 `npm run test:lint`도 선행 lint와 실제 검사기 contract3개를 모두 통과했습니다. 정상 JS/Vue는 exit0, 신규 JS/Vue 위반은 exit1과 해당 규칙 진단을 냈습니다. MCP Apps 브라우저 호스트가 직접 사용하는 esbuild는 기존에 해석된0.28.2 그대로 exact dev dependency로 명시했습니다. GitHub workflow의 YAML·명령 순서·공식 action SHA는 확인했으나 원격 CI 성공은 push 이후 실제 run으로 별도 확인해야 합니다.

MCP Apps 베타 표시 후 전체 회귀 검사에서 사전 갱신의 중복 예약과 ISO 임대 기한 처리 오류를 찾아 수정했습니다. 검사 범위는 21개 파일로 확장했으며, 전용 갱신 회귀 11개를 `npm run test:reference-updates`와 필수 CI에 연결했습니다. 격리된 공식 법정동·행정동 사전을 준비한 전체 연계 검사 130개도 통과했습니다. 테스트 원문·이전 실패·수정 전후 증거는 `ops/runs/20261101-geo-mcp-beta`에 보존하며 해당 사전을 공개 운영 경로에 활성화하지 않았습니다.
