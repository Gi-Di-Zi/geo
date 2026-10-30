import proj4 from 'proj4'

export const LOCATION_CRS = ['EPSG:4326', 'EPSG:3857', 'EPSG:5179', 'EPSG:5186', 'EPSG:5181'] as const
export type LocationCrs = typeof LOCATION_CRS[number]
export interface LocationPoint { x: number; y: number; crs: LocationCrs }
export class LocationError extends Error {
  code: string
  status: 'invalid' | 'not_found' | 'unavailable'
  constructor(code: string, message: string, status: LocationError['status'] = 'invalid') { super(message); this.code = code; this.status = status }
}

proj4.defs('EPSG:5179', '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs')
proj4.defs('EPSG:5186', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs')
proj4.defs('EPSG:5181', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs')

function crsOf(value: string): LocationCrs {
  if (!(LOCATION_CRS as readonly string[]).includes(value)) throw new LocationError('UNSUPPORTED_CRS', '지원하는 EPSG 좌표계를 선택하세요.')
  return value as LocationCrs
}
function validate(point: LocationPoint) {
  crsOf(point.crs)
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new LocationError('INVALID_COORDINATES', 'X·Y는 유한한 숫자여야 합니다.')
  if (point.crs === 'EPSG:4326' && (Math.abs(point.x) > 180 || Math.abs(point.y) > 90)) throw new LocationError('COORDINATE_RANGE', '위경도는 X=경도(-180~180), Y=위도(-90~90) 순서로 입력하세요.')
  if (point.crs === 'EPSG:3857' && (Math.abs(point.x) > 20037508.35 || Math.abs(point.y) > 20037508.35)) throw new LocationError('COORDINATE_RANGE', 'Web Mercator 좌표의 유효 범위를 넘었습니다.')
  if (!['EPSG:4326', 'EPSG:3857'].includes(point.crs) && (Math.abs(point.x) > 10_000_000 || Math.abs(point.y) > 10_000_000)) throw new LocationError('COORDINATE_RANGE', '국내 투영좌표의 입력 범위를 넘었습니다. 좌표계와 X·Y 순서를 확인하세요.')
  return point
}

/** 이 도구의 XY는 GIS 관례인 동쪽값·북쪽값이며 위경도는 경도·위도 순서다. */
export function parseLocation(value: string, crs: string = 'EPSG:4326'): LocationPoint {
  const values = value.trim().split(/[\s,]+/)
  if (values.length !== 2 || values.some(v => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v))) throw new LocationError('INVALID_COORDINATES', '좌표는 X, Y 두 숫자로 입력하세요. 위경도는 경도, 위도 순서입니다.')
  return validate({ x: Number(values[0]), y: Number(values[1]), crs: crsOf(crs) })
}
export function transformLocation(point: LocationPoint, target: string): LocationPoint {
  validate(point)
  const crs = crsOf(target)
  if (point.crs === crs) return { ...point }
  let values: number[]
  try { values = proj4(point.crs, crs, [point.x, point.y]) }
  catch { throw new LocationError('COORDINATE_TRANSFORM_FAILED', '좌표를 변환하지 못했습니다. 원본 EPSG와 X·Y를 확인하세요.') }
  return validate({ x: values[0]!, y: values[1]!, crs })
}
export function toWgs84(point: LocationPoint) {
  const result = transformLocation(point, 'EPSG:4326')
  return { ...result, crs: 'EPSG:4326' as const, lon: result.x, lat: result.y }
}
export function formatLocation(point: LocationPoint) {
  const places = point.crs === 'EPSG:4326' ? 8 : 3
  return point.x.toFixed(places) + ', ' + point.y.toFixed(places)
}
