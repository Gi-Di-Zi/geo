# UI 명세와 Storybook

`manifest.json`은 원본 commit·파일 SHA·제목·줄 번호를 보존합니다. 문서 분류는 UI·혼합·콘텐츠·운영·도구·역사 자료를 구분하며, 혼합 문서의 UI 구간은 `.storybook/docs/web/sources`에서 확인합니다. 원문은 유지합니다.

화면별 MDX는 `.storybook/docs/web/screens`에 있습니다. `approval: unknown`은 사용자 승인 근거를 확인하지 못했다는 뜻입니다. 구현 소스의 존재를 요구 확정이나 운영 검증으로 승격하지 않습니다.

별도 개발 패키지 실행:

```sh
cd .storybook
npm ci --ignore-scripts
npm run build
npm run dev
```

Vue 3 원본 컴포넌트를 재사용합니다. Storybook 문서 렌더러의 React 의존성은 원래 Vue 앱의 프레임워크를 바꾸지 않습니다. 지도/GDAL·DB·문의 전송·실제 로그인·배포는 실행하지 않습니다. 앱 manifest와 lockfile은 변경하지 않습니다.

검사 범위와 도구 버전:

- 원본 Vue 버전은 유지하고 Storybook 개발 패키지만 공식 호환 Vite 7.3.7·TypeScript 5.9.2를 고정합니다. 앱의 Nuxt/Vite manifest와 lockfile은 변경하지 않습니다.
- `vue-tsc`는 strict·라이브러리 검사까지 실행하며 skipLibCheck를 사용하지 않습니다. Storybook 10.6.5의 사용하지 않는 실험적 VueMeta 선언 오류를 피하기 위해 안정된 CSF3 core 타입과 실제 Vue SFC props를 연결합니다. node_modules 패치는 없습니다.
- Geo는 실제 도구/용어/단계 컴포넌트를 재사용하고 파일·서버 변환과 지도 렌더링은 실행하지 않습니다. 링크는 preview 안에서 이동을 막습니다. KDJ는 실제 한국어 사전과 preview용 호환 i18n provider를 사용합니다. 실제 로그인·게시글/문의 쓰기 API는 호출하지 않습니다.
- 원본 앱의 전체 Nuxt 타입 검사·네이티브 CI를 Storybook 통과로 간주하지 않습니다. Storybook의 lint·원문 보존·SFC typecheck·static build·브라우저 검증은 별도입니다.
