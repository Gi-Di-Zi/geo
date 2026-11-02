<script setup lang="ts">
const emit = defineEmits<{ select: [value: { address: string; jibunAddress: string; legalCode: string }] }>()
type Postcode = new (options: { oncomplete: (data: unknown) => void; autoMapping: boolean; width: string; height: string }) => { embed: (container: HTMLElement, options?: { q?: string }) => void }
const dialog = ref<HTMLDialogElement>(), container = ref<HTMLDivElement>()
const loading = ref(false), error = ref('')
let live = true, opener: HTMLElement | null = null
const postcode = () => (window as unknown as { kakao?: { Postcode?: Postcode } }).kakao?.Postcode
function load(): Promise<Postcode> {
  const ready = postcode()
  if (ready) return Promise.resolve(ready)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const finish = (failed?: boolean) => {
      clearTimeout(timer); script.onload = null; script.onerror = null
      const constructor = postcode()
      if (failed || !constructor) { script.remove(); reject(new Error('주소 검색을 불러오지 못했습니다.')) }
      else resolve(constructor)
    }
    const timer = setTimeout(() => finish(true), 15_000)
    script.src = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
    script.async = true; script.onload = () => finish(); script.onerror = () => finish(true)
    document.head.append(script)
  })
}
function selected(value: unknown) {
  if (!live || !dialog.value?.open || !value || typeof value !== 'object') return
  const data = value as Record<string, unknown>
  const field = (key: string) => typeof data[key] === 'string' && data[key].length <= 2000 ? data[key].trim() : ''
  const jibunAddress = field('jibunAddress'), legalCode = field('bcode')
  const address = (data.userSelectedType === 'R' ? field('roadAddress') : jibunAddress) || field('address')
  if (!address || !/^\d{10}$/.test(legalCode)) { error.value = '선택한 주소 정보를 확인하지 못했습니다. 다른 검색 결과를 선택해 주세요.'; return }
  emit('select', { address, jibunAddress, legalCode })
  dialog.value.close()
}
/** 검색어를 채운 카카오 주소 검색을 연다. 불러오지 못하면 창을 닫고 false를 돌려준다. */
async function open(q = '') {
  if (loading.value) return true
  error.value = ''; loading.value = true; opener = document.activeElement as HTMLElement | null
  if (!dialog.value?.open) dialog.value?.showModal()
  container.value?.replaceChildren()
  try {
    const Constructor = await load()
    if (live && dialog.value?.open && container.value) new Constructor({ oncomplete: selected, autoMapping: false, width: '100%', height: '100%' }).embed(container.value, { q })
    return true
  } catch { dialog.value?.close(); return false }
  finally { if (live) loading.value = false }
}
function closed() { if (live) opener?.focus() }
defineExpose({ open })
onBeforeUnmount(() => { live = false; dialog.value?.close() })
</script>

<template>
  <dialog ref="dialog" aria-label="주소 검색" @close="closed">
    <div class="search-heading"><h2>주소 검색</h2><button type="button" class="btn" aria-label="검색 닫기" @click="dialog?.close()">닫기</button></div>
    <p class="note">찾는 주소를 선택하세요. 검색어는 이 창에서 고칠 수 있습니다.</p>
    <p v-if="loading" role="status" class="note">주소 검색을 불러오는 중…</p>
    <p v-if="error" role="alert" class="search-error">{{ error }}</p>
    <div ref="container" class="search-container" />
  </dialog>
</template>

<style scoped>
dialog { width: min(580px, calc(100vw - 28px)); max-height: calc(100dvh - 32px); padding: 18px; border: 1px solid var(--rule); border-radius: var(--r-panel); background: var(--surface); color: var(--ink); }
dialog::backdrop { background: rgb(22 32 42 / .45); }
.search-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.search-heading h2 { font-size: var(--fs-2); }
.note { margin: 10px 0; font-size: var(--fs-0); color: var(--ink-2); }.search-error { color: #a3251b; margin-block: 12px; font-size: var(--fs-0); }
.search-container { width: 100%; height: min(500px, calc(100dvh - 180px)); min-height: 260px; }
</style>
