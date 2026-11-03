import type { StorybookConfig } from 'storybook/internal/types'
import type { StorybookConfigVite } from '@storybook/builder-vite'
import { fileURLToPath } from 'node:url'
import AutoImport from 'unplugin-auto-import/vite'
import vue from '@vitejs/plugin-vue'

const root = fileURLToPath(new URL('../', import.meta.url))

const config = {
  stories: ['./stories/**/*.stories.ts', './docs/**/*.mdx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-mcp'],
  features: { componentsManifest: true, experimentalDocgenServer: true },
  framework: { name: '@storybook/vue3-vite', options: { docgen: { plugin: 'vue-component-meta', tsconfig: fileURLToPath(new URL('./tsconfig.json', import.meta.url)) } } },
  core: { disableTelemetry: true },
  async viteFinal(value) {
    value.resolve ??= {}
    value.resolve.alias = {
      '#shared': `${root}shared`,
      '#build/catalog-formats': `${root}.storybook/fixtures/catalog-formats.ts`,
      '~': `${root}app`,
    }
    value.resolve.dedupe = ['vue']
    value.resolve.preserveSymlinks = true
    value.server ??= {}
    value.server.fs ??= {}
    value.server.fs.allow = [root]

    if (value.esbuild !== false) {
      value.esbuild ??= {}
      value.esbuild.tsconfigRaw = JSON.stringify({ compilerOptions: { target: 'ES2023', useDefineForClassFields: true, verbatimModuleSyntax: true } })
    }

    value.plugins ??= []
    value.plugins.push(vue())
    value.plugins.push(AutoImport({
      imports: ['vue', { [`${root}app/utils/catalog.ts`]: ['toolOf', 'seconds'] }],
      dts: false,
      vueTemplate: true,
    }))

    return value
  },
} satisfies StorybookConfig & StorybookConfigVite

export default config
