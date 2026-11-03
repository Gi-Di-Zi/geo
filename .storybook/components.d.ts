import ToolChip from '../app/components/ToolChip.vue'
import TermText from '../app/components/TermText.vue'
import NuxtLink from './mocks/NuxtLink.vue'

declare module 'vue' {
  export interface ComponentCustomProperties {
    seconds: typeof import('../app/utils/catalog')['seconds']
  }

  export interface GlobalComponents {
    ToolChip: typeof ToolChip
    TermText: typeof TermText
    NuxtLink: typeof NuxtLink
  }
}

export {}
