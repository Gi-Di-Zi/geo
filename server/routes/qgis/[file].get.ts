// QGIS 플러그인 저장소: /qgis/plugins.xml과 플러그인 zip (scripts/qgis-plugins.ts가 server/assets/qgis에 만든 것)
export default defineEventHandler(async event => {
  const file = getRouterParam(event, 'file') ?? ''

  if (!/^[a-z_]+(?:\.\d+\.\d+\.\d+)?\.zip$|^plugins\.xml$/.test(file)) throw createError({ statusCode: 404 })
  const raw = await useStorage('assets:server').getItemRaw(`qgis/${file}`)

  if (!raw) throw createError({ statusCode: 404, statusMessage: '플러그인 저장소 없음 (node scripts/qgis-plugins.ts)' })
  setResponseHeaders(event, { 'content-type': file.endsWith('.xml') ? 'application/xml; charset=utf-8' : 'application/zip', 'cache-control': 'public, max-age=300' })

  return Buffer.from(raw)
})
