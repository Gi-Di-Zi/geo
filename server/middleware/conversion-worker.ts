import { timingSafeEqual } from 'node:crypto'

if (process.env.GEO_WORKER_KEY && process.env.GEO_PUBLIC_CONVERSIONS !== '1') throw new Error('Private worker requires public file-only conversion mode')

/** Docker 실행 권한이 있는 작업자는 전용 프록시에서 전달한 요청만 받는다. */
export default defineEventHandler(event => {
  const expected = process.env.GEO_WORKER_KEY

  if (expected) {
    if (event.path === '/__worker/health' && event.method === 'GET') return { ready: true }

    const supplied = getHeader(event, 'x-geo-worker-key') || ''
    const actual = Buffer.from(supplied)
    const key = Buffer.from(expected)

    if (actual.length !== key.length || !timingSafeEqual(actual, key)) {
      throw createError({ statusCode: 403, statusMessage: 'Private conversion worker' })
    }

    // 주소·코드 연계는 즉시 변환·조회·경계만 (일괄 작업·파일 업로드는 공개하지 않음)
    const allowed = event.path === '/mcp' || event.path === '/api/stage' || /^\/api\/jobs(?:\/|$)/.test(event.path)
      || /^\/api\/link\/(?:capabilities|resolve|regions|references|references\/update|boundary)(?:\?|$)/.test(event.path)

    if (!allowed) throw createError({ statusCode: 403, statusMessage: 'Worker route unavailable' })
  }

  if (/^\/api\/jobs(?:\/|$)/.test(event.path)) {
    setResponseHeaders(event, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition',
    })

    if (event.method === 'OPTIONS') {
      setResponseStatus(event, 204)

      return ''
    }
  }

  if (expected || event.path === '/mcp' || event.path.startsWith('/api/')) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  }
})
