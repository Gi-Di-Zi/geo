// 맡기기 + 판별: 업로드 위젯(MCP App, 다른 출처의 대화 안 화면)이 파일을 바로 보내는 곳. 응답 = 판별 결과 (server/utils/stage.ts)
// 다른 출처에서 부르므로 CORS 허용. Private-Network: 공개 주소의 화면이 이 PC(localhost) 서버를 부를 때 브라우저가 묻는 허가
export default defineEventHandler(async event => {
  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Private-Network': 'true',
  })

  if (event.method === 'OPTIONS') { setResponseStatus(event, 204);

 return '' }

  if (event.method !== 'POST') throw createError({ statusCode: 405 })

  if (Number(getRequestHeader(event, 'content-length') ?? 0) > UPLOAD_LIMIT + 1024 ** 2) {
    throw createError({ statusCode: 413, statusMessage: `파일이 너무 큼. 최대 ${UPLOAD_LIMIT / 1024 ** 2}MB.` })
  }

  const file = (await readMultipartFormData(event))?.find(p => p.name === 'file' && p.filename)

  if (!file) throw createError({ statusCode: 400, statusMessage: '파일 필요 (file 필드).' })

  return identify(await stageData(file.filename!, file.data))
})
