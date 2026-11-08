import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createError, defineEventHandler, getCookie, getHeader, getRequestURL, setCookie, setResponseHeader } from 'h3'
import type { H3Event } from 'h3'
import { LinkServiceError, linkLimits } from './files.ts'
import { dailyCounter } from '../../utils/upload-storage.ts'
import { z } from 'zod'

export interface LinkAccess { owner?: string; token?: string }

export const newAccessToken = () => randomBytes(32).toString('base64url')
export const hashAccess = (value: string) => createHash('sha256').update(value).digest('hex')

export function hasAccess(stored: { ownerHash?: string; tokenHash: string; grants?: string[] }, access: LinkAccess) {
  const ownerHash = access.owner && hashAccess(access.owner)

  if (ownerHash && (stored.ownerHash === ownerHash || stored.grants?.includes(ownerHash))) return true

  if (!access.token || !/^[A-Za-z0-9_-]{43}$/.test(access.token)) return false

  return timingSafeEqual(Buffer.from(hashAccess(access.token)), Buffer.from(stored.tokenHash))
}

export function getLinkOwner(event: H3Event) {
  let owner = getCookie(event, 'geo_link_owner')

  if (!owner || !/^[A-Za-z0-9_-]{43}$/.test(owner)) {
    owner = newAccessToken()
    setCookie(event, 'geo_link_owner', owner, { httpOnly: true, sameSite: 'strict', secure: getRequestURL(event).protocol === 'https:', path: '/', maxAge: Math.ceil(linkLimits.ttlMs / 1000) })
  }

  return owner
}

export function linkAccess(event: H3Event): LinkAccess {
  const auth = getHeader(event, 'authorization')

  if (auth && !/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) throw createError({ statusCode: 401, statusMessage: '올바른 Bearer 접근 토큰이 필요합니다.' })

  return { owner: getLinkOwner(event), token: auth?.slice(7) }
}

export function assertSameOrigin(event: H3Event) {
  if (getHeader(event, 'authorization')) return
  const origin = getHeader(event, 'origin')

  if (origin && origin !== getRequestURL(event).origin) throw createError({ statusCode: 403, statusMessage: '다른 출처의 요청은 허용하지 않습니다.' })
}

export async function readLimitedBody(event: H3Event, maximum = linkLimits.bytes + 1024 ** 2) {
  const declared = getHeader(event, 'content-length')

  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new LinkServiceError('FILE_TOO_LARGE', '요청 크기 한도를 넘었습니다.', 413)
  const parts: Buffer[] = []
  let size = 0

  for await (const part of event.node.req) {
    size += Buffer.byteLength(part)

    if (size > maximum) throw new LinkServiceError('FILE_TOO_LARGE', '요청 크기 한도를 넘었습니다.', 413)
    parts.push(Buffer.from(part))
  }

  return Buffer.concat(parts)
}

export async function readLinkJson(event: H3Event) {
  assertSameOrigin(event)

  try { return lookupInputSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readLimitedBody(event)))) }
  catch (error) {
    if (error instanceof LinkServiceError) throw error
    throw new LinkServiceError('INVALID_JSON', '올바른 JSON 요청이 필요합니다.')
  }
}

/** 공개 배포에서 외부 원천(VWorld 지오코더·검색·경계)을 부르는 행 수의 접속자별 하루 한도. 사전만 쓰는 변환(PNU·법정동·지번주소)은 세지 않는다 */
export const LINK_DAILY_LOOKUPS = 2000
const chargeLookups = dailyCounter(LINK_DAILY_LOOKUPS)

const lookupInputSchema = z.looseObject({
  codes: z.array(z.unknown()).optional(), rows: z.array(z.unknown()).optional(), text: z.string().optional(),
  options: z.looseObject({ target: z.string().optional(), inputType: z.string().optional(), lookups: z.boolean().optional() }).optional(),
})

type LookupInput = z.infer<typeof lookupInputSchema>

function lookupInputRows(input: LookupInput) {
  if (input.codes) return input.codes.length

  if ((input.options?.target === 'all' && input.options.lookups === false) || (!['all', 'location', 'legal_boundary'].includes(String(input.options?.target)) && input.options?.inputType !== 'location')) return 0

  return input.rows?.length ?? input.text?.split(/\r?\n/).filter(line => line.trim()).length ?? 0
}

export function lookupRows(raw: LookupInput) {
  const input = lookupInputSchema.safeParse(raw)

  if (!input.success) throw new LinkServiceError('INVALID_INPUT', '입력·옵션 형식을 확인하세요.')

  return lookupInputRows(input.data)
}

/** client: 공개 배포에서 전용 프록시가 넣는 접속자 IP. 비공개 실행(로컬·사내)은 세지 않는다 */
export function chargeLinkLookups(client: string | undefined, raw: LookupInput) {
  if (process.env.GEO_PUBLIC_CONVERSIONS !== '1' || client === undefined) return
  const input = lookupInputSchema.safeParse(raw)

  if (!input.success) throw new LinkServiceError('INVALID_INPUT', '입력·옵션 형식을 확인하세요.')

  if (!chargeLookups(client || 'unknown', lookupInputRows(input.data))) throw new LinkServiceError('DAILY_LOOKUP_LIMIT', `위치·우편번호·경계 조회는 접속자마다 하루 ${LINK_DAILY_LOOKUPS}행까지입니다. 내일 다시 시도하거나, 코드·지번주소 변환(위치 제외)을 이용하세요.`, 429)
}

export const linkClient = (event: H3Event) => getHeader(event, 'x-real-ip') || ''
const httpErrorSchema = z.looseObject({ issues: z.unknown().optional(), statusCode: z.unknown().optional() })

export function linkHttpError(error: Error): never {
  if (error instanceof LinkServiceError) throw createError({ statusCode: error.statusCode, data: { code: error.code, message: error.message }, message: error.message })
  const known = httpErrorSchema.safeParse(error)

  if (known.success && 'issues' in known.data) throw createError({ statusCode: 400, data: { code: 'INVALID_INPUT' }, message: '입력·옵션 형식을 확인하세요.' })

  if (known.success && 'statusCode' in known.data) throw error
  throw createError({ statusCode: 500, data: { code: 'LINK_INTERNAL_ERROR' }, message: '주소 연계 처리 중 오류가 발생했습니다.' })
}

export function linkHandler<T>(handler: (event: H3Event) => Promise<T>) {
  return defineEventHandler(async event => {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
    setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')

    try { return await handler(event) } catch (error) { return linkHttpError(error instanceof Error ? error : new Error('Unexpected link failure')) }
  })
}
