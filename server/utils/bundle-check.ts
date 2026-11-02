// 파일 방식 결과물 검사: 내려받아 다른 웹 서버에 올려도 그대로 쓰이는지 결과 파일로 확인한다.
// 형식 머리글, 여러 파일 결과(3D Tiles·quantized-mesh·타일 폴더)의 참조 파일 존재, 결과 안의 절대 주소(geo 서버 임시 URL 등) 의존.
// 브라우저에서 실제로 그려지는지는 여기서 확인하지 않는다 (지도 화면·시험이 따로)
import { existsSync, readdirSync, statSync } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Output } from '../../shared/types.ts'

export interface BundleCheck {
  ok: boolean
  /** 실제로 확인한 항목 */
  checked: string[]
  problems: string[]
  files: number
  bytes: number
  /** GeoJSON 첫 피처의 속성 이름 (앞 64KB 안에서) */
  fields?: string[]
}

/** 스킴이 있는 주소 (http://, https:// …). data: URI는 파일 안에 담긴 것이라 제외 */
const ABSOLUTE = /^[a-z][a-z0-9+.-]*:\/\//i

async function head(file: string, n: number) {
  const f = await open(file, 'r')

  try {
    const { bytesRead, buffer } = await f.read(Buffer.alloc(n), 0, n, 0)

    return buffer.subarray(0, bytesRead)
  } finally {
    await f.close()
  }
}

/** 결과 경로(파일 또는 폴더) 안의 파일 목록·크기 */
interface Walked { files: number; bytes: number; list: string[] }

function walk(path: string): Walked {
  if (!existsSync(path)) return { files: 0, bytes: 0, list: [] }
  const st = statSync(path)

  if (st.isFile()) return { files: 1, bytes: st.size, list: [path] }
  const list = readdirSync(path, { recursive: true, encoding: 'utf8' }).map(n => join(path, n)).filter(p => statSync(p).isFile())

  return { files: list.length, bytes: list.reduce((a, p) => a + statSync(p).size, 0), list }
}

/** 3D Tiles: tileset.json부터 내용(content uri·url, contents[])과 외부 tileset을 따라가며 파일 존재·상대 경로 확인 */
async function checkTileset(file: string, problems: string[], seen = new Set<string>()) {
  if (seen.has(file) || seen.size > 1000) return seen
  seen.add(file)
  const json: { root?: TileNode } = JSON.parse(await readFile(file, 'utf8'))
  const refs: string[] = []

  const visit = (t: TileNode) => {
    for (const c of [t.content, ...(t.contents ?? [])]) if (c?.uri ?? c?.url) refs.push(c.uri ?? c.url ?? '')

    for (const child of t.children ?? []) visit(child)
  }

  if (!json.root) problems.push(`${file}: root 없음`)
  else visit(json.root)

  for (const ref of refs) {
    if (ABSOLUTE.test(ref)) { problems.push(`절대 주소 참조: ${ref}`); continue }

    const target = resolve(dirname(file), decodeURIComponent(ref.split('?')[0] ?? ''))

    if (!existsSync(target)) problems.push(`참조 파일 없음: ${ref}`)
    else if (target.endsWith('.json')) await checkTileset(target, problems, seen)
  }

  return seen
}

interface TileNode { content?: { uri?: string; url?: string }; contents?: { uri?: string; url?: string }[]; children?: TileNode[] }

/** glb: 머리글 + JSON 조각의 buffers·images uri가 파일 안(data:·bufferView)이거나 옆 파일인지 */
async function checkGlb(file: string, problems: string[], checked: string[]) {
  const b = await readFile(file)

  if (b.toString('latin1', 0, 4) !== 'glTF' || b.readUInt32LE(4) !== 2) { problems.push('glTF 2.0 바이너리 머리글 아님');

 return }

  const gltf: { buffers?: { uri?: string }[]; images?: { uri?: string }[] } = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)))

  for (const ref of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
    if (!ref.uri || ref.uri.startsWith('data:')) continue

    if (ABSOLUTE.test(ref.uri)) problems.push(`절대 주소 참조: ${ref.uri}`)
    else if (!existsSync(resolve(dirname(file), ref.uri))) problems.push(`참조 파일 없음: ${ref.uri}`)
  }

  checked.push('glTF 2.0 바이너리 머리글, 버퍼·텍스처가 파일 안 또는 옆 파일')
}

/**
 * 결과물 하나 검사. out = 작업 결과 폴더(upload/), target = 내려받기 대상 경로(파일 또는 폴더, delivery.ts downloadOf).
 * 문제가 없고 확인한 항목이 있을 때만 ok
 */
export async function checkBundle(out: string, o: Output, target: string): Promise<BundleCheck> {
  const checked: string[] = [], problems: string[] = []
  const path = join(out, target)
  const { files, bytes, list } = walk(path)
  let fields: string[] | undefined

  if (!files) return { ok: false, checked, problems: [`결과 파일 없음: ${target}`], files, bytes }
  const main = join(out, o.path.split('{')[0] ?? '')

  try {
    if (o.kind === 'geojson') {
      const text = (await head(path, 1 << 16)).toString('utf8').replace(/^\uFEFF/, '')

      if (!/^\s*\{/.test(text) || !/"type"\s*:\s*"FeatureCollection"/.test(text)) problems.push('GeoJSON FeatureCollection 아님')
      else checked.push('GeoJSON FeatureCollection')
      const props = /"properties"\s*:\s*\{([^{}]*)\}/.exec(text)?.[1]

      if (props !== undefined) fields = [...props.matchAll(/"([^"\\]{1,80})"\s*:/g)].map(m => m[1] ?? '')
    } else if (o.kind === 'pmtiles') {
      const h = await head(path, 8)

      if (h.toString('latin1', 0, 7) !== 'PMTiles' || h[7] !== 3) problems.push('PMTiles v3 머리글 아님')
      else checked.push('PMTiles v3 단일 아카이브 머리글')
    } else if (o.kind === 'cog') {
      const h = (await head(path, 400)).toString('latin1')

      if (!/^(II\*\0|MM\0\*|II\+\0|MM\0\+)/.test(h)) problems.push('TIFF 머리글 아님')
      else checked.push(h.includes('LAYOUT=COG') ? 'TIFF + COG 구조 표기(LAYOUT=COG)' : 'TIFF 머리글 (COG 구조 표기 없음)')
    } else if (o.kind === 'image') {
      const h = (await head(path, 12)).toString('latin1')

      if (!/^(\x89PNG|\xFF\xD8\xFF|RIFF....WEBP)/s.test(h)) problems.push('PNG·JPEG·WebP 머리글 아님')
      else checked.push('이미지 머리글 (네 모서리 범위는 결과 정보·코드 예시에 따로)')
    } else if (o.kind === 'glb') await checkGlb(path, problems, checked)
    else if (o.kind === '3dtiles') {
      const n = (await checkTileset(main, problems)).size

      if (!problems.length) checked.push(`tileset.json ${n}개가 가리키는 타일·모델 파일 모두 있음, 상대 경로만`)
    } else if (o.kind === 'quantized-mesh') {
      const layer = join(path, 'layer.json')

      if (!existsSync(layer)) problems.push('layer.json 없음')
      else {
        const meta: { tiles?: string[] } = JSON.parse(await readFile(layer, 'utf8'))

        if ((meta.tiles ?? []).some(t => ABSOLUTE.test(t))) problems.push('layer.json의 tiles가 절대 주소')
        const tiles = list.filter(p => p.endsWith('.terrain')).length

        if (!tiles) problems.push('.terrain 타일 없음')
        else checked.push(`layer.json(상대 tiles 주소) + .terrain 타일 ${tiles.toLocaleString()}개`)
      }
    } else {
      // z/x/y 타일 폴더 (MVT·XYZ·Terrain-RGB): 템플릿 확장자의 타일이 있는지, 함께 나온 JSON에 절대 주소가 없는지
      const ext = /\.[a-z0-9]+$/.exec(o.path)?.[0] ?? ''
      const tiles = list.filter(p => p.endsWith(ext)).length

      if (!tiles) problems.push(`${ext} 타일 없음`)
      else checked.push(`z/x/y 타일 ${tiles.toLocaleString()}개 (${ext})`)
    }

    for (const json of list.filter(p => p.endsWith('.json') && statSync(p).size < 1 << 20)) {
      if (/"(?:https?:)?\/\/[^"]*\/api\/jobs\//.test(await readFile(json, 'utf8'))) problems.push(`geo 서버 작업 주소 참조: ${json.slice(out.length + 1)}`)
    }
  } catch (e) {
    problems.push(`검사 실패: ${e instanceof Error ? e.message : String(e)}`)
  }

  return { ok: !problems.length && checked.length > 0, checked, problems, files, bytes, ...(fields && { fields }) }
}
