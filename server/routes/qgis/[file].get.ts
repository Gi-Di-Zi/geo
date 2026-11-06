// QGIS 플러그인 저장소: /qgis/plugins.xml과 플러그인 zip (scripts/qgis-plugins.ts가 server/assets/qgis에 만든 것).
// plugins.xml의 내려받기 주소는 이 서버 주소로 채운다 → 공개·로컬·직접 설치한 서버 어디서든 그 서버의 zip을 받는다
export default defineEventHandler(async event => {
  const file = getRouterParam(event, 'file') ?? ''

  if (!/^[a-z_]+(?:\.\d+\.\d+\.\d+)?\.zip$|^plugins\.xml$/.test(file)) throw createError({ statusCode: 404 })
  const raw = await useStorage('assets:server').getItemRaw(`qgis/${file}`)

  if (!raw) throw createError({ statusCode: 404, statusMessage: '플러그인 저장소 없음 (node scripts/qgis-plugins.ts)' })
  setResponseHeaders(event, { 'content-type': file.endsWith('.xml') ? 'application/xml; charset=utf-8' : 'application/zip', 'cache-control': 'public, max-age=300' })

  if (file.endsWith('.xml')) {
    const origin = (process.env.PUBLIC_URL || getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin).replace(/\/$/, '')

    return String(raw).replaceAll('__GEO_ORIGIN__', origin)
  }

  return Buffer.from(raw)
})
