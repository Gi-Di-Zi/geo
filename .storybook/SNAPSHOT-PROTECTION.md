# 초기 UI snapshot 보호

기존 MD와 생성한 UI 명세는 초기 이관 snapshot이다. `migration-state.json`의 `snapshot-protected`는 검토 승인이나 DKB 참조 전환 완료가 아니다. `approval:unknown`, `dkbReference:pending-permission`을 유지한다.

명시적 `npm run check:migration`과 Storybook 전용 `npm run lint`는 이관한 UI 출처만 고정 Git 원문의 SHA·절 범위와 대조한다. 해당 UI 절의 변경·누락·symlink·원본 commit 부재는 실패하며 상태를 다시 캡처하지 않는다. 비UI 문서와 같은 README의 다른 운영 절은 정상 수정할 수 있고, UI 앞의 행 추가도 허용한다. 원본 Git 이력과 초기 provenance SHA는 유지한다. 원본 commit이 없는 shallow clone은 해당 정확한 revision을 가져온 뒤 검사해야 한다.

초기 `sync-ui-specs.py`/`generate-ui-specs.py` 명령은 보호 상태 이후 읽기 전용 reconcile이다. UI 명세 변경은 보존하고 `editedSnapshots`로 보고하며 원본 MD로 덮어쓰지 않는다. 원본 MD의 보호한 UI 절이 바뀌면 자동 재생성 대신 충돌로 멈춘다. 비UI 변경은 `nonUiSourceChanges`로 표시하며 기존 UI snapshot을 갱신하지 않는다. 이후 변경의 승인·출처 전환과 새 문서 도입은 별도 검토가 필요하다. 새 초기 snapshot이나 state 재생성을 자동 허용하는 CLI는 없다.

`npm run test:migration`은 실제 임시 Git 저장소에서 UI 수정 보존, 원문 충돌, hash만 바꾼 재캡처 거절, 무수정 반복 실행과 경로/누락/상태 위조 거절을 검사한다. 현재 운영 DKB의 참조 우선순위·자동 Storybook 배포·토큰 발급은 활성화하지 않는다.

실행 환경은 Python 3와 Git, `sourceRevision`의 원본 Git object를 포함한 source 검증 환경이다. 일반 앱의 Node-alpine/slim Docker build와 루트 lint/prebuild/pretest는 원래대로 유지해 새 Python/Git 요구를 추가하지 않는다. DKB는 기존 native python-tests의 자동 discover 경로에 실제 state 검사와 회귀를 연결했다. 다른 네 프로젝트의 일반 앱 CI 자동 편입은 아직 미자격이며, 현재 보장은 명시적 source check와 Storybook 검증 경로까지다.
