<script setup lang="ts">
import type { FormatSpec } from '#shared/types'

const props = defineProps<{ spec: FormatSpec }>()
const router = useRouter()
const up = props.spec.upload
const accept = 'accept' in up ? up.accept : []
const file = ref<File | null>(null)
const sending = ref(false)
const error = ref('')

const pick = (e: Event) => {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null
  error.value = file.value && !accept.some(a => file.value!.name.toLowerCase().endsWith(a))
    ? `${accept.join(', ')} 파일만 가능.`
    : ''
}

async function send() {
  if (!file.value || error.value) return
  sending.value = true
  const body = new FormData()
  body.append('format', `${props.spec.category}/${props.spec.id}`)
  body.append('file', file.value)
  try {
    const { id } = await $fetch<{ id: string }>('/api/jobs', { method: 'POST', body })
    await router.push({ path: stepPath(props.spec, 'view'), query: { job: id } })
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? '업로드 실패. 서버 실행 여부 확인.'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <p v-if="'unsupported' in up" class="small muted">{{ up.unsupported }}</p>
  <form v-else @submit.prevent="send">
    <p class="small muted">{{ up.note }}</p>
    <label class="small">
      <span class="sr-only">올릴 파일</span>
      <input type="file" :accept="accept.join(',')" @change="pick">
    </label>
    <button class="btn" type="submit" :disabled="!file || !!error || sending">{{ sending ? '올리는 중…' : '변환하기' }}</button>
    <p v-if="error" class="small err" role="alert">{{ error }}</p>
    <p class="small muted">최대 200MB. 올린 파일·결과는 24시간 뒤 삭제.</p>
  </form>
</template>

<style scoped>
form { display: grid; gap: 8px; }
form .btn { justify-self: start; }
input[type='file'] { max-width: 100%; }
.err { color: #B42318; }
</style>
