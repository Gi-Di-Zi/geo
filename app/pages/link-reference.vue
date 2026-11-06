<script setup lang="ts">
definePageMeta({ path: '/link/reference' })
useHead({ title: '주소·코드 기준자료' })
type Source = { id: string; label: string; available: boolean; source: string; sourceUrl: string; version: string; count: number; relationCount?: number; sourceDate?: string | null; publishedAt?: string | null; checkedAt?: string | null; activatedAt?: string | null; ingestedAt?: string | null; warning?: string; state: string; message?: string }
type Status = { day: string; state: 'ready' | 'checking' | 'done' | 'failed'; canUpdate: boolean; retryAt?: string; message: string; lastCheckedAt: string | null; lastUpdatedAt: string | null; sources: Source[] }
// 갱신은 서버가 하루 한 번 자동으로 한다 (server/plugins/link-reference.ts). 이 화면은 상태만 본다
const data = ref<Status>(), error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined, live = true
const stamp = (value?: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미제공'
function schedule() {
  clearTimeout(timer)
  if (data.value?.state === 'checking') timer = setTimeout(() => { load().catch(showError) }, 1500)
}
function showError(value: unknown) {
  const e = value as { data?: { data?: { message?: string }; message?: string }; message?: string }
  if (live) error.value = e.data?.data?.message || e.data?.message || '기준자료 상태를 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
}
async function load() {
  const result = await $fetch<Status>('/api/link/references')
  if (live) { data.value = result; schedule() }
}
onMounted(() => { load().catch(showError) })
onBeforeUnmount(() => { live = false; clearTimeout(timer) })
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap reference-page">
      <NuxtLink to="/link" class="back">← 주소·코드 변환</NuxtLink>
      <header><p class="eyebrow">공식 자료와 업데이트</p><h1>기준자료</h1><p class="lead">주소·코드 연계 도구가 쓰는 기준자료와 업데이트 상태입니다.</p></header>
      <section class="update-panel" aria-labelledby="update-heading" :aria-busy="data?.state === 'checking'">
        <div class="update-top"><h2 id="update-heading">자동 업데이트</h2><span class="badge">매일 자동 확인</span></div>
        <dl v-if="data" class="times">
          <div><dt>마지막 확인</dt><dd>{{ stamp(data.lastCheckedAt) }}</dd></div>
          <div><dt>마지막 변경</dt><dd>{{ stamp(data.lastUpdatedAt) }}</dd></div>
        </dl>
        <p v-if="data" role="status">{{ data.message }}</p><p v-else>기준자료 상태를 읽고 있습니다.</p>
        <p class="small muted">서버가 한국 시간 기준 하루 한 번 공식 제공처를 확인합니다. 원본이 같으면 다시 적용하지 않고(마지막 확인만 바뀜), 실패하면 이전 정상 자료로 계속 변환합니다.</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </section>
      <section v-for="source in data?.sources || []" :key="source.id" class="source-card" :aria-labelledby="source.id + '-heading'">
        <div class="card-title"><h2 :id="source.id + '-heading'">{{ source.label }}</h2><span class="badge">{{ source.available ? '사용 중' : '자료 미설정' }}</span></div>
        <p>{{ source.source }}</p><p class="small muted">{{ source.message }}</p>
        <dl>
          <div><dt>버전</dt><dd><code>{{ source.version }}</code></dd></div>
          <div><dt>확보 범위</dt><dd>{{ source.count.toLocaleString() }}개 코드<span v-if="source.relationCount !== undefined"> · 관할 관계 {{ source.relationCount.toLocaleString() }}개</span></dd></div>
          <div><dt>원천 기준일</dt><dd>{{ source.sourceDate || '원천에서 제공하지 않음' }}</dd></div>
          <div v-if="source.publishedAt"><dt>원천 게시일</dt><dd>{{ source.publishedAt }}</dd></div>
          <div><dt>마지막 확인</dt><dd>{{ stamp(source.checkedAt) }}</dd></div>
          <div><dt>반영 시각</dt><dd>{{ stamp(source.activatedAt) }}</dd></div>
        </dl>
        <p v-if="source.warning" class="small warning">{{ source.warning }}</p>
        <a :href="source.sourceUrl" target="_blank" rel="noopener noreferrer">공식 제공처 보기 →</a>
      </section>
      <section class="source-card" aria-labelledby="live-sources-heading">
        <h2 id="live-sources-heading">주소 검색·위치·경계</h2>
        <p>주소 검색은 카카오 주소 검색, 위치·우편번호와 법정구역 경계는 VWorld 원천을 요청할 때 조회합니다.</p>
        <p class="small muted">자동 업데이트는 법정동·행정동 코드 사전만 확인합니다. 외부 서비스의 원천 자료를 갱신하지 않습니다. 위치는 주소 대표점이며, SHP 다운로드는 VWorld 2D 데이터 API로 공식 경계를 조회합니다.</p>
      </section>
      <p class="small muted">코드 사전·관할 관계 확인과 실제 필지 존재 확인은 다릅니다. 자료 갱신에 실패하면 이전 정상 자료로 계속 변환합니다.</p>
    </div>
  </div>
</template>

<style scoped>
.reference-page { max-width: 900px; padding-top: 32px; padding-bottom: 64px; display: grid; gap: 22px; }.back { font-size: var(--fs-0); }.eyebrow { font-size: var(--fs-0); font-weight: 600; color: var(--ink-2); }h1 { margin-top: 5px; font-size: var(--fs-5); }.lead { margin-top: 10px; color: var(--ink-2); }
.times { font-size: var(--fs-1); }
.update-panel, .source-card { display: grid; gap: 12px; padding: 24px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }.update-top, .card-title { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }h2 { font-size: var(--fs-2); }.badge { font-size: .75rem; color: var(--ink-2); padding: 3px 8px; border: 1px solid var(--rule); border-radius: 999px; }
dl { display: grid; gap: 6px; margin: 4px 0; font-size: var(--fs-0); }dl > div { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: 12px; }dt { color: var(--ink-2); }dd { margin: 0; overflow-wrap: anywhere; }.warning { color: #865209; }.error { color: #a3251b; }
@media (max-width: 520px) { .update-panel, .source-card { padding: 18px; }dl > div { grid-template-columns: 1fr; gap: 1px; } }
</style>
