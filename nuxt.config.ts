import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tools } from './shared/catalog/tools'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'ko' },
      title: '공간 데이터 웹 처리',
      meta: [{ name: 'description', content: '공간 데이터 유형·확장자별 수집, 전처리, 웹 형태 변환 과정. OpenLayers·MapLibre·Deck.gl·Cesium 결과 비교.' }],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap' },
      ],
    },
  },
  runtimeConfig: { public: { vworldKey: '' } },
  modules: [
    // 확장자 spec 목록(#build/catalog-formats)을 만든다. <유형>/<확장자>.ts 하나가 확장자 하나다.
    // import.meta.glob은 서버 빌드에서 shared/ 파일을 상대 경로 외부 모듈로 남겨 Nitro가 찾지 못해서, 절대 경로 import로 쓴다
    // 파일을 추가·삭제하면 개발 서버를 다시 띄워 목록을 새로 만든다 (Vite 감시가 shared/를 보지 않는다)
    (_options, nuxt) => {
      const dir = fileURLToPath(new URL('./shared/catalog', import.meta.url))
      nuxt.options.build.templates.push({
        filename: 'catalog-formats.ts',
        write: true,
        getContents: () => {
          const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
            .map(f => f.replaceAll('\\', '/'))
            .filter(f => /^[^/]+\/[^_/][^/]*\.ts$/.test(f))
            .sort()
          return [
            ...files.map((f, i) => `import f${i} from ${JSON.stringify(`${dir.replaceAll('\\', '/')}/${f}`)}`),
            `export default [${files.map((_, i) => `f${i}`).join(', ')}]`,
          ].join('\n')
        },
      })
      nuxt.hook('vite:serverCreated', (server, { isClient }) => {
        if (!isClient) return
        server.watcher.add(dir)
        const restart = (path: string) => { if (path.startsWith(dir)) nuxt.callHook('restart') }
        server.watcher.on('add', restart)
        server.watcher.on('unlink', restart)
      })
    },
  ],
  nitro: { prerender: { crawlLinks: true, routes: ['/'] } },
  // 서비스 레시피의 서버(compose.yaml)를 같은 주소 아래로 연다: /svc/<도구 id>/** → endpoint
  // ponytail: 주소는 빌드 때 고정 (127.0.0.1). 서버를 다른 호스트에 두면 endpoint를 환경 변수로
  routeRules: Object.fromEntries(tools.filter(t => t.endpoint).map(t => [`/svc/${t.id}/**`, { proxy: `${t.endpoint}/**` }])),
})
