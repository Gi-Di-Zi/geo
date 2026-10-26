// nuxt.config.ts가 만드는 Nitro(서버) 가상 모듈: 확장자 spec 전체 (#build/catalog-formats와 같은 목록). 앱 타입 검사도 서버 경로 타입을 따라 읽어서 여기(공용)에 둔다
declare module '#catalog-formats' {
  const formats: import('./types').FormatSpec[]
  export default formats
}
