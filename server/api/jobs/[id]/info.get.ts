// 작업 상태·결과 요약 JSON: MCP geo_status와 같은 내용 (진행, 결과물·내려받기, 적용 코드, 독립 HTML 지도 주소, 주의).
// QGIS 플러그인처럼 MCP가 아닌 HTTP 클라이언트용. 화면용 /api/jobs/<id>는 진행 로그를 함께 준다
export default defineEventHandler(event => {
  const url = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true })

  setResponseHeader(event, 'Cache-Control', 'no-store')

  return jobInfo(getRouterParam(event, 'id') ?? '', (process.env.PUBLIC_URL || url.origin).replace(/\/$/, ''))
})
