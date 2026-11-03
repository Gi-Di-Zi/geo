import type { ProjectAnnotations, Renderer } from 'storybook/internal/types'
import { getCurrentInstance } from 'vue'
import type { App } from 'vue'
import NuxtLink from './mocks/NuxtLink.vue'
import ToolChip from './source-components/ToolChip.vue'
import TermText from './source-components/TermText.vue'
import '../app/assets/main.css'

const configured = new WeakSet<App>()

const preview = {
  decorators: [() => ({
    setup() {
      const instance = getCurrentInstance()

      if (!instance) throw new Error('Storybook Vue setup context is required')

      const app = instance.appContext.app

      if (!configured.has(app)) {
        app.component('NuxtLink', NuxtLink)
        app.component('ToolChip', ToolChip)
        app.component('TermText', TermText)
        configured.add(app)
      }

      return {}
    },
    template: '<story />',
  })],
  parameters: {
    layout: 'padded',
    docs: { codePanel: true },
  },
} satisfies ProjectAnnotations<Renderer>

export default preview
