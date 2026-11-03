export {}

declare global {
  const computed: typeof import('vue')['computed']
  const ref: typeof import('vue')['ref']
  const useId: typeof import('vue')['useId']
  const toolOf: typeof import('../app/utils/catalog')['toolOf']
  const seconds: typeof import('../app/utils/catalog')['seconds']
}
