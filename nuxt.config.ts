import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'ko' },
      title: 'geo · 공간 데이터 시각화',
      meta: [
        { name: 'description', content: '실제 공개 공간데이터의 수집·전처리·웹 변환 과정과 지도·3D 결과를 비교하는 공간 데이터 시각화 도구.' },
        // 링크 공유 미리보기. og:image는 공개 주소(절대 URL)가 생기면
        { property: 'og:type', content: 'website' },
        { property: 'og:locale', content: 'ko_KR' },
        { property: 'og:title', content: 'geo · 공간 데이터 시각화' },
        { property: 'og:description', content: 'CityGML·LAS·CSV의 처리 방식과 웹 지도·3D 결과를 실제 공개 데이터로 비교합니다.' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
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
      const getContents = () => {
        const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
          .map(f => f.replaceAll('\\', '/'))
          .filter(f => /^[^/]+\/[^_/][^/]*\.ts$/.test(f))
          .sort()
        return [
          ...files.map((f, i) => `import f${i} from ${JSON.stringify(`${dir.replaceAll('\\', '/')}/${f}`)}`),
          `export default [${files.map((_, i) => `f${i}`).join(', ')}]`,
        ].join('\n')
      }
      nuxt.options.build.templates.push({ filename: 'catalog-formats.ts', write: true, getContents })
      // 서버(Nitro)는 #build 별칭을 쓸 수 없다 → 같은 목록을 가상 모듈 #catalog-formats로 (MCP·업로드 판별)
      nuxt.hook('nitro:config', config => { config.virtual = { ...config.virtual, '#catalog-formats': getContents } })
      nuxt.hook('vite:serverCreated', (server, { isClient }) => {
        if (!isClient) return
        server.watcher.add(dir)
        const restart = (path: string) => { if (path.startsWith(dir)) nuxt.callHook('restart') }
        server.watcher.on('add', restart)
        server.watcher.on('unlink', restart)
      })
    },
  ],
  nitro: {
    // SDK 자산의 raw import를 외부 패키지 경로로 바꾸면 Nitro가 파일을 읽지 못한다.
    externals: { inline: ['@modelcontextprotocol/ext-apps'] },
    prerender: { crawlLinks: true, routes: ['/'] },
    // MCP App 화면에 SDK를 통째로 넣는다 (CDN 없이 뜨게). 설치된 버전 그대로 → useStorage('assets:mcp-sdk')
    serverAssets: [{ baseName: 'mcp-sdk', dir: fileURLToPath(new URL('./node_modules/@modelcontextprotocol/ext-apps/dist/src', import.meta.url)), pattern: 'app-with-deps.js' }],
  },
  // 서비스 레시피의 서버(compose.yaml)는 /svc/<도구 id>/** 로 연다: server/routes/svc/[...path].ts (업로드 임시 서비스 만료 검사 뒤 프록시)
})
