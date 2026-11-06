// 독립 HTML 지도(결과 zip의 index.html)가 쓰는 라이브러리 묶음 → server/assets/standalone/<뷰어>/ + manifest.json
// 적용 코드(shared/snippets.ts)와 배경지도 코드(shared/standalone.ts)에 나오는 모듈만 뷰어별로 묶는다. 모듈 이름마다 진입 파일 하나,
// 코드 분할로 공용 부분(deck.gl core 등)은 한 벌 → 페이지의 importmap이 모듈 이름 → 파일. CesiumJS는 수십 MB라 묶지 않고 CDN
// 설치(postinstall)·빌드(prebuild) 때 실행. 결과는 Git에 넣지 않는다
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { usage } from '../shared/snippets.ts'
import { basemapCode } from '../shared/standalone.ts'
import { viewerKinds } from '../shared/viewers.ts'
import type { StandaloneLib } from '../shared/standalone.ts'
import type { Output, ViewerId } from '../shared/types.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = join(root, 'server/assets/standalone')
const version = (name: string): string => JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version

/** 모든 결과 종류의 적용 코드를 만들기 위한 자리 값 (모듈 목록만 본다) */
const sample = (kind: Output['kind']): Output => ({ id: 'x', kind, path: 'x', label: '', why: '', layer: 'x', bounds: [0, 0, 1, 1], anchor: [0, 0, 0], minzoom: 1, maxzoom: 2 })

/** import 문 → 모듈 이름과 기본(default) 가져오기 여부 */
function modules(viewer: ViewerId) {
  const found = new Map<string, boolean>()
  const code = [basemapCode[viewer], ...viewerKinds[viewer].map(kind => usage(viewer, sample(kind), 'x').code)].join('\n')

  for (const [, clause, name] of code.matchAll(/^import\s+(.+?)\s+from\s+'([^']+)'/gm)) {
    const usesDefault = !clause!.startsWith('{') && !clause!.startsWith('*')

    found.set(name!, (found.get(name!) ?? false) || usesDefault)
  }

  return found
}

rmSync(out, { recursive: true, force: true })

const lib: StandaloneLib = { imports: {}, files: {}, versions: {
  'ol': version('ol'), 'ol-pmtiles': version('ol-pmtiles'), 'maplibre-gl': version('maplibre-gl'), 'pmtiles': version('pmtiles'),
  'deck.gl': version('@deck.gl/core'), 'loaders.gl': version('@loaders.gl/core'), 'cesium': version('cesium'),
} }

for (const viewer of ['ol', 'maplibre', 'deck'] as const) {
  const dir = join(out, viewer)
  const names = [...modules(viewer)]
  const entries = Object.fromEntries(names.map((_, i) => [`m${i}`, `entry:${i}`]))

  await build({
    entryPoints: entries, bundle: true, splitting: true, format: 'esm', outdir: dir, chunkNames: 'c-[hash]',
    minify: true, target: 'es2022', platform: 'browser', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'entries',
      setup(b) {
        b.onResolve({ filter: /^entry:/ }, a => ({ path: a.path, namespace: 'entry' }))
        b.onLoad({ filter: /.*/, namespace: 'entry' }, a => {
          const [name, usesDefault] = names[Number(a.path.slice(6))]!

          return { contents: `export * from '${name}'\n${usesDefault ? `export { default } from '${name}'\n` : ''}`, resolveDir: root, loader: 'js' }
        })
      },
    }],
  })

  // MapLibre 6은 워커를 자기 파일 옆(maplibre-gl-worker.mjs)에서 찾는다 → 묶음 옆에 둔다
  if (viewer === 'ol') copyFileSync(join(root, 'node_modules/ol/ol.css'), join(dir, 'ol.css'))
  else {
    copyFileSync(join(root, 'node_modules/maplibre-gl/dist/maplibre-gl.css'), join(dir, 'maplibre-gl.css'))
    copyFileSync(join(root, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'), join(dir, 'maplibre-gl-worker.mjs'))
  }

  lib.imports[viewer] = Object.fromEntries(names.map(([name], i) => [name, `./lib/m${i}.js`]))
  lib.files[viewer] = readdirSync(dir).sort()
  const bytes = lib.files[viewer]!.reduce((n, f) => n + readFileSync(join(dir, f)).length, 0)

  console.log(`${viewer}: 모듈 ${names.length}개 → 파일 ${lib.files[viewer]!.length}개, ${(bytes / 1024 ** 2).toFixed(1)}MB`)
}

mkdirSync(out, { recursive: true })

writeFileSync(join(out, 'manifest.json'), JSON.stringify(lib, null, 1))
