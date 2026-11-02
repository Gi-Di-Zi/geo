// 올린 파일이 어느 유형/확장자(spec)인지 고른다. 확장자 → 후보, 후보가 여럿이거나 zip이면 내용(머리글·zip 목차·.dbf 열 이름)으로 순위.
// 변환 전에 알 수 있는 문제(좌표계 없음, 평면 좌표, 래스터 PMTiles …)도 여기서 짚는다.
// 파일 전체를 읽지 않고 필요한 조각만 읽는다. 브라우저(업로드 상자)와 검사(check.ts)가 같이 쓴다. 서버는 spec의 accept로 다시 확인
import { XY_NAMES } from './catalog/attribute/csv.ts'
import type { FormatSpec } from './types.ts'

/** 건물(2.5D) 판별용 높이·층수 열. pipeline/scripts/fill_height.py의 HEIGHT + FLOORS와 같게 */
const HEIGHT_COLS = ['height', 'hgt_median_m', 'building:height', 'bld_hgt', 'hgt', 'build_height', '높이', 'num_floors', 'building:levels', 'levels', 'floors', 'grnd_flr', 'gro_flo_co', '지상층수']
/** 확장자별 파일 첫 바이트 */
const MAGIC: Record<string, string> = {
  '.las': 'LASF', '.laz': 'LASF', '.gpkg': 'SQLite format 3', '.fgb': 'fgb', '.pmtiles': 'PMTiles', '.glb': 'glTF',
  '.ifc': 'ISO-10303-21', '.img': 'EHFA_HEADER_TAG', '.zip': 'PK', '.png': '\x89PNG', '.jpg': '\xFF\xD8\xFF', '.webp': 'RIFF',
}
/** 그림의 좌표를 담는 월드파일 확장자 */
const WORLD_FILES = ['.jgw', '.jpgw', '.pgw', '.pngw', '.wld', '.webpw', '.tfw']
/** PMTiles 머리글 99번째 바이트(타일 종류) */
const PMTILES_TYPES: Record<number, string> = { 1: 'MVT(벡터)', 2: 'PNG', 3: 'JPEG', 4: 'WebP', 5: 'AVIF' }

export interface Sniff {
  ext: string
  /** 확장자만으로 받는 spec */
  byExt: FormatSpec[]
  /** 내용 판별 근거 (화면에 한 줄씩) */
  facts: string[]
  /** 맞는 spec, 가능성 높은 순. 비면 note에 이유 */
  picks: FormatSpec[]
  note?: string
  /** 변환은 되지만 알아 둘 점 (서울시청 앞 배치, 일부 행 제외 …) */
  warns: string[]
  /** 파일에 좌표계가 없어 골라야 변환 가능. guess = 미리 골라 둘 값 (좌표가 위경도 범위면 EPSG:4326) */
  srs?: { why: string; guess?: string }
  /** 피처·점·행 수. 머리글에 적혀 있거나 파일 전체를 읽은 경우만 (추정하지 않는다) */
  count?: number
  /** 형식은 맞지만 이대로는 변환이 실패하는 이유 (변환 시작 전에 막는다) */
  blocked?: string
  /** 머리글의 스키마·판 (IFC FILE_SCHEMA) */
  schema?: string
}

/** LAS 점 형식 중 RGB가 있는 것 (LAS 1.4 표 7) */
const LAS_RGB = [2, 3, 5, 7, 8, 10]

export async function sniff(file: Blob, name: string, formats: FormatSpec[]): Promise<Sniff> {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
  const id = (f: FormatSpec) => `${f.category}/${f.id}`
  const byExt = formats.filter(f => !f.closed && 'accept' in f.upload && f.upload.accept.includes(ext))
  const facts: string[] = [], warns: string[] = []
  const stop = (note: string): Sniff => ({ ext, byExt, facts, warns, picks: [], note })
  if (!byExt.length) {
    // 아는 확장자인데 그대로는 못 받는 경우(.shp 단독, 타일 한 장) → 그 확장자의 업로드 안내
    const known = formats.find(f => !f.closed && f.extensions.includes(ext))
    return stop(known ? ('unsupported' in known.upload ? known.upload.unsupported : known.upload.note) : `${ext || '확장자 없는 파일'}: 받는 형식 아님`)
  }
  const magic = MAGIC[ext]
  if (magic) {
    const head = String.fromCharCode(...new Uint8Array(await file.slice(0, magic.length).arrayBuffer()))
    if (head !== magic) { facts.push('머리글 불일치'); return stop(`${ext} 파일 머리글 아님 — 확장자만 바뀐 파일?`) }
    if (ext !== '.zip') facts.push(`머리글 확인: ${magic.replace(/[^\x20-\x7E]/g, '') || 'JPEG'}`)
  }

  let order: string[] = []
  let srs: Sniff['srs']
  let count: number | undefined
  let blocked: string | undefined
  let schema: string | undefined
  const seoul = '좌표 없음 → 서울시청 앞에 1픽셀 = 1m로 배치'
  if (ext === '.tif' || ext === '.tiff') {
    const t = await tiffInfo(file)
    if (!t) { facts.push('TIFF 머리글 없음'); return stop('TIFF 파일 아님') }
    // DEM: 높이값 1밴드 = 부호 있는 16비트 정수(SRTM·ASTER 등) 또는 실수. 32비트 정수·부호 없는 값은 등급·분류 영상으로 본다
    const dem = t.bands === 1 && (t.float || (t.bits === 16 && t.signed))
    const cog = t.tiled && t.overviews
    facts.push(`${t.width?.toLocaleString() ?? '?'}×${t.height?.toLocaleString() ?? '?'} 픽셀 · 밴드 ${t.bands}개${t.bands === 1 ? ` · ${t.bits}비트 ${t.float ? '실수' : t.signed ? '정수' : '양의 정수'}` : ''}${t.tiled ? ' · 타일 구조' : ''}${t.overviews ? ' · 내부 축소판' : ''}`)
    facts.push(dem ? '높이값 1밴드 → DEM' : cog ? '타일 + 축소판 → COG' : t.bands === 1 ? '값·등급 1밴드 영상' : '색 영상')
    order = dem ? ['terrain/tif'] : cog ? ['raster/cog', 'raster/tif'] : ['raster/tif', 'raster/cog']
    // 좌표: 기준점·변환 태그 = 위치, GeoKey = 좌표계. .tfw·.aux.xml 같은 별도 파일은 함께 못 올림
    if (!t.placed) warns.push(dem ? '좌표 없는 DEM → 위치를 몰라 지형 변환 실패. .tfw 등 별도 파일의 좌표는 함께 못 올림' : `${seoul}. .tfw 등 별도 파일의 좌표는 함께 못 올림`)
    else if (!t.keyed && dem) warns.push('좌표계 표기(GeoKey) 없음 → 지형 변환 실패 가능')
    else if (!t.keyed) srs = { why: '위치는 있으나 좌표계 표기(GeoKey) 없음' }
  } else if (ext === '.geojson' || ext === '.json') {
    const head = await text(file, 1 << 20)
    const poly = /"type"\s*:\s*"(Multi)?Polygon"/.test(head)
    const col = heightCol([...head.matchAll(/"([^"\\]{1,40})"\s*:/g)].map(m => m[1]!))
    facts.push(poly ? '도형: 면(Polygon)' : '도형: 점·선', col ? `높이·층수 열: ${col}` : '높이·층수 열 없음')
    // 앞부분이 파일 전체일 때만 센다
    if (file.size <= 1 << 20) { count = head.match(/"type"\s*:\s*"Feature"/g)?.length ?? 0; facts.push(`피처 ${count.toLocaleString()}개`) }
    order = poly && col ? ['vector-25d/geojson', 'vector-2d/geojson'] : ['vector-2d/geojson', 'vector-25d/geojson']
    // crs 표기가 없으면 GDAL은 위경도로 본다 → 미터 단위 값이면 좌표계를 골라야 한다
    const xy = head.match(/"coordinates"\s*:\s*[[\s]*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)/)
    if (/"crs"\s*:/.test(head)) facts.push('좌표계 표기(crs) 있음')
    else if (xy && planar(Number(xy[1]), Number(xy[2]))) srs = { why: `crs 표기 없음 · 좌표 (${xy[1]}, ${xy[2]}) → 평면 좌표(TM 등)로 보임` }
  } else if (ext === '.csv') {
    const src = await text(file, 1 << 18)
    const rows = csvRows(src, 200)

    if (file.size <= 1 << 18) count = Math.max(0, src.split(/\r?\n/).filter(l => l.trim()).length - 1)
    const xi = colOf(rows[0] ?? [], XY_NAMES.x), yi = colOf(rows[0] ?? [], XY_NAMES.y)
    facts.push(`열 ${rows[0]?.length ?? 0}개: ${(rows[0] ?? []).slice(0, 8).join(', ')}${(rows[0]?.length ?? 0) > 8 ? ' …' : ''}`)
    if (xi < 0 || yi < 0) return stop(`좌표 열을 못 찾음 — 열 이름: ${[...XY_NAMES.x, ...XY_NAMES.y].join(', ')} (* = 아무 글자)`)
    const pts = rows.slice(1).map(r => [Number(r[xi]), Number(r[yi])] as const).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (x || y))
    facts.push(`좌표 열: ${rows[0]![xi]} · ${rows[0]![yi]}`)
    if (!pts.length) warns.push(`앞 ${rows.length - 1}행에 좌표 값 없음`)
    else if (pts.filter(([x, y]) => planar(x, y)).length > pts.length / 2) srs = { why: `좌표 값 (${pts[0]![0]}, ${pts[0]![1]}) → 평면 좌표(TM 등, 미터)로 보임` }
    else {
      const out = pts.filter(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 90).length
      facts.push('값이 위경도 범위')
      if (out) warns.push(`앞 ${pts.length}행 중 ${out}행 위경도 범위 밖 → 제외 (위도·경도 뒤바뀜 등)`)
    }
  } else if (ext === '.ifc') {
    schema = /FILE_SCHEMA\s*\(\s*\(\s*'([^']{1,40})'/i.exec(await text(file, 1 << 14))?.[1]?.toUpperCase()
    facts.push(schema ? `IFC 스키마: ${schema}` : '머리글에 FILE_SCHEMA 없음')
  } else if (ext === '.gml') {
    const head = await text(file, 1 << 16)
    const city = /citygml/i.test(head)
    const srsName = /srsName\s*=\s*"([^"]{1,120})"/.exec(head)?.[1]
    facts.push(city ? 'CityGML 이름공간 → 3D 도시 모델' : '일반 GML (CityGML 이름공간 없음)')

    if (city) facts.push(srsName ? `좌표계 표기(srsName): ${srsName}` : '앞 64KB에 좌표계 표기(srsName) 없음')
    order = city ? ['model-3d/citygml', 'vector-2d/gml'] : ['vector-2d/gml', 'model-3d/citygml']
  } else if (ext === '.pmtiles') {
    const type = new Uint8Array(await file.slice(99, 100).arrayBuffer())[0]!
    facts.push(`타일 종류: ${PMTILES_TYPES[type] ?? `알 수 없음(${type})`}`)
    if (type !== 1) return stop('래스터 PMTiles 미지원 — 벡터(MVT) PMTiles만')
  } else if (ext === '.las' || ext === '.laz') {
    const l = await lasInfo(file)
    count = l.points
    facts.push(`LAS ${l.version} · 점 ${l.points.toLocaleString()}개 · 점 형식 ${l.format}${LAS_RGB.includes(l.format) ? ' (RGB 있음)' : ' (RGB 없음)'}`)
    facts.push(l.crs ? '좌표계 기록(VLR) 있음' : l.extended ? '좌표계: 확장 VLR(파일 끝)은 확인 안 함' : '좌표계 기록(VLR) 없음')
    // 업로드 점군 변환은 파일의 좌표계만 쓴다 (첫 단계에서 없으면 중단)
    if (!l.crs && !l.extended) blocked = '좌표계 기록 없음 → 지도 위치 불명. 점군 변환은 파일 안 좌표계만 사용 → 좌표계를 넣은 파일로 다시 (예: pdal translate --writers.las.a_srs=EPSG:5186)'
  } else if (['.jpg', '.png', '.webp'].includes(ext)) {
    warns.push(`${seoul}. 제자리 배치는 그림 + 월드파일 + .prj를 zip 하나로`)
  } else if (ext === '.zip') {
    const list = (await zipList(file))?.filter(e => !e.name.endsWith('/'))
    if (!list) { facts.push('zip 목차 없음'); return stop('깨진 zip') }
    const lower = list.map(e => e.name.toLowerCase())
    const find = (x: string) => list[lower.findIndex(n => n.endsWith(x))]
    const stem = (e: Entry) => e.name.toLowerCase().replace(/\.[^./]+$/, '')
    const exts = new Map<string, number>()
    for (const n of lower) { const x = n.match(/\.[a-z0-9]+$/)?.[0] ?? '(확장자 없음)'; exts.set(x, (exts.get(x) ?? 0) + 1) }
    facts.push(`zip 안 파일 ${list.length.toLocaleString()}개: ${[...exts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([x, n]) => n > 1 ? `${x} ${n.toLocaleString()}` : x).join(' · ')}`)
    const top = (x: string) => lower.some(n => n.split('/').pop() === x)
    // SHP는 가장 큰 .shp 한 벌만 변환 (pipeline/scripts/shp_unpack.py와 같은 규칙)
    const shps = list.filter(e => e.name.toLowerCase().endsWith('.shp')).sort((a, b) => b.usize - a.usize)
    const image = ['.jpg', '.png', '.webp'].find(x => find(x))
    if (shps.length) {
      const shp = shps[0]!
      const part = (x: string) => list.find(e => stem(e) === stem(shp) && e.name.toLowerCase().endsWith(x))
      const dbf = part('.dbf')
      const h = new DataView((await entryHead(file, shp, 68)).buffer)
      const [x0, y0, x1, y1] = [36, 44, 52, 60].map(o => h.getFloat64(o, true)) as [number, number, number, number]
      const dbfHead = dbf ? await entryHead(file, dbf, 8192) : undefined
      const cols = dbfHead ? dbfFields(dbfHead) : []
      const col = heightCol(cols)
      const type = h.getInt32(32, true)
      const poly = [5, 15, 25].includes(type)
      // .dbf 머리글 4번째 바이트부터 = 레코드(피처) 수
      count = dbfHead ? new DataView(dbfHead.buffer).getUint32(4, true) : undefined
      facts.push(`SHP 도형: ${poly ? '면' : type === 1 || type === 11 ? '점' : '선 등'}${count === undefined ? '' : ` · 피처 ${count.toLocaleString()}개`} · 속성 열 ${cols.length}개`, col ? `높이·층수 열: ${col}` : '높이·층수 열 없음')
      facts.push(part('.cpg') ? '인코딩: .cpg 따름' : '인코딩: .cpg 없음 → 변환 때 .dbf 내용으로 판별')
      order = poly && col ? ['vector-25d/shp', 'vector-2d/shp'] : ['vector-2d/shp', 'vector-25d/shp']
      if (shps.length > 1) warns.push(`.shp ${shps.length}개 → 가장 큰 1벌(${shp.name.split('/').pop()})만 변환`)
      const range = `x ${fmt(x0)} ~ ${fmt(x1)}, y ${fmt(y0)} ~ ${fmt(y1)}`
      if (!part('.prj')) srs = { why: `.prj 없음 · 좌표 범위 ${range}`, guess: planar(x1, y1) ? undefined : 'EPSG:4326' }
    } else if (top('layer.json') && find('.terrain')) order = ['terrain/terrain']
    else if (top('tileset.json') && find('.pnts')) order = ['pointcloud/pnts']
    else if (top('tileset.json') && find('.i3dm')) order = ['model-3d/i3dm']
    else if (top('tileset.json')) return stop('3D Tiles 중 pnts(점군)·i3dm(인스턴스)만 받음 — b3dm·glb 타일셋은 미지원')
    else if (find('.gltf')) order = ['model-3d/gltf']
    else if (image) {
      order = [`raster/${image.slice(1)}`]
      // to_rgb.py: 월드파일 + .prj → 제자리, 월드파일만 → 좌표계를 골라야, 둘 다 없으면 서울시청 앞
      if (!WORLD_FILES.some(w => find(w))) warns.push(seoul)
      else if (!find('.prj')) srs = { why: '월드파일만 있고 .prj(좌표계) 없음' }
    }
  }
  const ranked = order.map(o => byExt.find(f => id(f) === o)).filter(f => !!f)
  // zip은 내용으로 고른 것만, 나머지는 확장자로 받는 spec을 뒤에 붙여 바꿔 고를 수 있게
  const picks = ext === '.zip' ? ranked : [...ranked, ...byExt.filter(f => !ranked.includes(f))]
  if (!facts.length) facts.push('확장자로 결정')
  return { ext, byExt, facts, picks, warns, srs, count, blocked, schema, note: picks.length ? undefined : 'zip 안에서 받는 형식을 못 찾음 (SHP 묶음, 3D Tiles·지형 타일셋, glTF, 영상 + 월드파일)' }
}

/** 미터 단위 평면 좌표(TM 등)로 보이는 값. 위경도는 ±180·±90 안 */
const planar = (x: number, y: number) => Math.abs(x) > 1000 || Math.abs(y) > 1000
const fmt = (v: number) => Math.round(v).toLocaleString()
/** 앞 n바이트를 글자로. UTF-8로 안 읽히면 국내 파일에 흔한 CP949 (stream: 잘린 마지막 글자는 오류로 보지 않음) */
async function text(file: Blob, n: number) {
  const buf = await file.slice(0, n).arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf, { stream: true }) } catch { return new TextDecoder('euc-kr').decode(buf) }
}
const heightCol = (cols: string[]) => cols.find(c => HEIGHT_COLS.includes(c.toLowerCase()))

/** CSV 앞 n행. 구분자는 머리글에 가장 많은 , ; 탭 | (GDAL CSV 드라이버처럼), 큰따옴표 안 구분자는 무시 */
function csvRows(src: string, n: number) {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim()).slice(0, n + 1)
  const sep = [',', ';', '\t', '|'].map(s => [s, lines[0]?.split(s).length ?? 0] as const).sort((a, b) => b[1] - a[1])[0]![0]
  return lines.map(line => {
    const cells = ['']
    let quoted = false
    for (const ch of line) {
      if (ch === '"') quoted = !quoted
      else if (ch === sep && !quoted) cells.push('')
      else cells[cells.length - 1] += ch
    }
    return cells.map(c => c.trim())
  })
}
/** GDAL X/Y_POSSIBLE_NAMES 규칙: 대소문자 무시, 앞·뒤 * = 아무 글자. 열 순서대로 첫 일치 */
function colOf(header: string[], names: string[]) {
  const like = (h: string, p: string) => {
    const [a, b] = [h.toLowerCase(), p.toLowerCase()]
    if (b.startsWith('*') && b.endsWith('*')) return a.includes(b.slice(1, -1))
    if (b.startsWith('*')) return a.endsWith(b.slice(1))
    if (b.endsWith('*')) return a.startsWith(b.slice(0, -1))
    return a === b
  }
  return header.findIndex(h => names.some(p => like(h, p)))
}

/** TIFF 첫 IFD: 밴드 수, (1밴드면) 비트·실수 여부, 타일 구조, 다음 IFD(내부 축소판), 위치 태그·좌표계 태그 유무. BigTIFF 포함 */
async function tiffInfo(file: Blob) {
  const h = new DataView(await file.slice(0, 16).arrayBuffer())
  if (h.byteLength < 8 || (h.getUint16(0) !== 0x4949 && h.getUint16(0) !== 0x4d4d)) return
  const le = h.getUint16(0) === 0x4949
  const big = h.getUint16(2, le) === 43
  const at = big ? Number(h.getBigUint64(8, le)) : h.getUint32(4, le)
  const c = new DataView(await file.slice(at, at + 8).arrayBuffer())
  const n = big ? Number(c.getBigUint64(0, le)) : c.getUint16(0, le)
  const size = big ? 20 : 12
  const d = new DataView(await file.slice(at + (big ? 8 : 2), at + (big ? 8 : 2) + n * size + 8).arrayBuffer())
  // 값의 첫 칸만 읽는다 (1밴드의 BitsPerSample처럼 값이 칸 안에 들어가는 태그만 씀)
  const tag = (want: number) => {
    for (let i = 0; i < n; i++) {
      if (d.getUint16(i * size, le) !== want) continue
      const v = i * size + (big ? 12 : 8)
      return d.getUint16(i * size + 2, le) === 3 ? d.getUint16(v, le) : d.getUint32(v, le)
    }
  }
  const bands = tag(277) ?? 1
  return {
    width: tag(256), height: tag(257),
    bands, bits: tag(258) ?? 1, float: tag(339) === 3, signed: tag(339) === 2, tiled: tag(322) !== undefined,
    overviews: (big ? Number(d.getBigUint64(n * size, le)) : d.getUint32(n * size, le)) !== 0,
    // 33922 기준점(ModelTiepoint), 34264 변환 행렬(ModelTransformation), 34735 GeoKey 목록(좌표계)
    placed: tag(33922) !== undefined || tag(34264) !== undefined, keyed: tag(34735) !== undefined,
  }
}

/**
 * LAS·LAZ 공개 머리글(LAZ도 압축 안 됨): 판, 점 형식(LAZ는 위 2비트가 압축 표시), 점 수(1.4는 64비트 칸),
 * 머리글과 점 사이 VLR 중 좌표계 기록(LASF_Projection 34735 GeoKey · 2111·2112 WKT). 1.4의 파일 끝 확장 VLR은 읽지 않는다
 */
async function lasInfo(file: Blob) {
  const h = new DataView(await file.slice(0, 375).arrayBuffer())
  const minor = h.getUint8(25)
  const size = h.getUint16(94, true), start = h.getUint32(96, true), vlrs = h.getUint32(100, true)
  const wide = minor >= 4 && h.byteLength >= 255
  const points = wide ? Number(h.getBigUint64(247, true)) : h.getUint32(107, true)
  const v = new DataView(await file.slice(size, Math.min(start, size + (1 << 20))).arrayBuffer())
  const ascii = new TextDecoder('ascii')
  let crs = false

  for (let p = 0, i = 0; i < vlrs && p + 54 <= v.byteLength; i++) {
    const user = ascii.decode(new Uint8Array(v.buffer, p + 2, 16)).replace(/\0.*$/s, '')
    const id = v.getUint16(p + 18, true), len = v.getUint16(p + 20, true)
    const body = new DataView(v.buffer, p + 54, Math.min(len, v.byteLength - p - 54))

    // 기록만 있고 값이 비거나(LOCAL_CS·빈 WKT) 사용자 정의(32767)면 PDAL도 좌표계 없음으로 본다
    if (user === 'LASF_Projection' && id === 2112) crs ||= /^\s*(PROJCS|GEOGCS|COMPD_CS|PROJCRS|GEOGCRS|COMPOUNDCRS|GEODCRS)\[/.test(ascii.decode(body))

    if (user === 'LASF_Projection' && id === 34735) {
      for (let k = 8; k + 8 <= body.byteLength; k += 8) {
        const key = body.getUint16(k, true), value = body.getUint16(k + 6, true)

        if ((key === 3072 || key === 2048) && value > 0 && value < 32767) crs = true
      }
    }

    p += 54 + len
  }

  return { version: `${h.getUint8(24)}.${minor}`, format: h.getUint8(104) & 0x3f, points, crs, extended: wide && h.getUint32(243, true) > 0 }
}

type Entry = { name: string; method: number; size: number; usize: number; at: number }

/** zip 목차(중앙 디렉터리). 항목 65535개를 넘는 ZIP64도 읽는다 */
export async function zipList(file: Blob): Promise<Entry[] | undefined> {
  const t = new DataView(await file.slice(Math.max(0, file.size - 65_557)).arrayBuffer())
  let i = t.byteLength - 22
  while (i >= 0 && t.getUint32(i, true) !== 0x06054b50) i--
  if (i < 0) return
  let size = t.getUint32(i + 12, true), offset = t.getUint32(i + 16, true)
  if (offset === 0xffffffff || t.getUint16(i + 10, true) === 0xffff) {
    if (i < 20 || t.getUint32(i - 20, true) !== 0x07064b50) return
    const at = Number(t.getBigUint64(i - 12, true))
    const z = new DataView(await file.slice(at, at + 56).arrayBuffer())
    size = Number(z.getBigUint64(40, true)); offset = Number(z.getBigUint64(48, true))
  }
  const cd = new DataView(await file.slice(offset, offset + size).arrayBuffer())
  const utf8 = new TextDecoder()
  const list: Entry[] = []
  for (let p = 0; p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50;) {
    const n = cd.getUint16(p + 28, true)
    list.push({
      name: utf8.decode(new Uint8Array(cd.buffer, p + 46, n)), method: cd.getUint16(p + 10, true),
      size: cd.getUint32(p + 20, true), usize: cd.getUint32(p + 24, true), at: cd.getUint32(p + 42, true),
    })
    p += 46 + n + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true)
  }
  return list
}

/** zip 항목의 앞 want 바이트. deflate는 앞부분만 풀고 멈춘다 (잘라 넣은 끝에서 나는 오류는 무시 — 필요한 만큼은 이미 나옴) */
async function entryHead(file: Blob, e: Entry, want: number) {
  const out = new Uint8Array(want)
  const h = new DataView(await file.slice(e.at, e.at + 30).arrayBuffer())
  const start = e.at + 30 + h.getUint16(26, true) + h.getUint16(28, true)
  const raw = file.slice(start, start + Math.min(e.size, want + 1024))
  if (e.method === 0) { out.set(new Uint8Array(await raw.slice(0, want).arrayBuffer())); return out }
  if (e.method !== 8) return out
  const r = raw.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  let len = 0
  try {
    while (len < want) {
      const { done, value } = await r.read()
      if (done) break
      out.set(value.subarray(0, want - len), len)
      len += Math.min(value.length, want - len)
    }
  } catch {}
  r.cancel().catch(() => {})
  return out
}

/** .dbf 머리글의 열 이름. UTF-8로 안 읽히면 국내 SHP에 흔한 CP949 */
function dbfFields(b: Uint8Array) {
  const names: string[] = []
  for (let p = 32; p + 32 <= b.length && b[p] !== 0x0d && b[p] !== 0; p += 32) {
    const raw = b.subarray(p, p + 11)
    const name = raw.subarray(0, raw.indexOf(0) < 0 ? 11 : raw.indexOf(0))
    try { names.push(new TextDecoder('utf-8', { fatal: true }).decode(name)) } catch { names.push(new TextDecoder('euc-kr').decode(name)) }
  }
  return names
}
