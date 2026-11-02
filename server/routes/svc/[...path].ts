// /svc/<도구 id>/** → 그 서버(compose.yaml)의 주소. 서비스 레시피의 서버를 같은 주소 아래로 연다.
// 업로드 작업이 발행한 임시 서비스(up_<작업 id 8자> 레이어)는 발행 완료 후 48시간만: 요청마다 그 작업의 만료 시각을 검사 →
// 정리 작업(server/plugins/service-sweep.ts)이 돌기 전이라도 만료 뒤에는 410. 기록 없는 up_ 레이어는 소유를 알 수 없어 404. 샘플 서비스는 그대로
// (routeRules proxy는 서버 미들웨어보다 먼저 돌아 검사를 건너뛰므로 쓰지 않는다)
// ponytail: 주소는 tools.ts endpoint 고정 (127.0.0.1). 서버를 다른 호스트에 두면 endpoint를 환경 변수로
import { tools } from '#shared/catalog/tools'
import type { ServiceRecord } from '#shared/types'

// 타일 요청마다 작업 폴더를 읽지 않게 기록을 잠깐 기억한다. 만료 판정은 매 요청 지금 시각으로 → 기억이 이용 기간을 늘리지 않는다
const seen = new Map<string, { s: ServiceRecord; at: number }>()

export default defineEventHandler(async event => {
  const rest = event.path.slice('/svc/'.length)
  const id = rest.split(/[/?]/)[0] ?? ''
  const endpoint = tools.find(t => t.id === id)?.endpoint

  if (!endpoint) throw createError({ statusCode: 404, statusMessage: 'Unknown service' })
  let path = event.path

  try { path = decodeURIComponent(path) } catch {}

  for (const layer of new Set(path.toLowerCase().match(/up_[0-9a-f]{8}/g))) {
    const hit = seen.get(layer)
    const s = hit && Date.now() - hit.at < 10_000 ? hit.s : await serviceOf(JOBS_DIR, layer)

    if (s && s !== hit?.s) seen.set(layer, { s, at: Date.now() })
    const state = s ? serviceState(s, Date.now()) : null

    if (state === 'active') continue
    seen.delete(layer)
    setResponseHeader(event, 'Cache-Control', 'no-store')
    throw createError(state
      ? { statusCode: 410, statusMessage: `Service ${state}`, data: { layer, state, expiresAt: s?.expiresAt ?? null, message: '임시 서비스 이용 기간(발행 후 48시간)이 끝났거나 정리된 서비스. 다운로드한 결과 파일은 영향 없음' } }
      : { statusCode: 404, statusMessage: 'Unknown upload service', data: { layer } })
  }

  return proxyRequest(event, endpoint + rest.slice(id.length))
})
