// 업로드 결과 파일. COG·PMTiles는 파일 일부만 받는 Range 요청을 쓴다
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'

const types: Record<string, string> = {
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.tif': 'image/tiff',
  '.pbf': 'application/x-protobuf', '.terrain': 'application/vnd.quantized-mesh', '.glb': 'model/gltf-binary',
}

export default defineEventHandler(event => {
  const out = join(jobDir(getRouterParam(event, 'id')), 'upload')
  const file = resolve(out, decodeURIComponent(getRouterParam(event, 'path') ?? ''))
  if (!file.startsWith(out + sep) || !existsSync(file) || !statSync(file).isFile()) throw createError({ statusCode: 404 })
  const size = statSync(file).size
  setResponseHeaders(event, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes' })

  // 범위 하나짜리 요청만 나눠 준다. 여러 범위를 한꺼번에 달라는 요청에는 파일 전체를 준다
  const m = /^bytes=(\d*)-(\d*)$/.exec(getRequestHeader(event, 'range') ?? '')
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      setResponseHeader(event, 'content-range', `bytes */${size}`)
      throw createError({ statusCode: 416 })
    }
    setResponseStatus(event, 206)
    setResponseHeaders(event, { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) })
    return sendStream(event, createReadStream(file, { start, end }))
  }
  setResponseHeader(event, 'content-length', String(size))
  return sendStream(event, createReadStream(file))
})
