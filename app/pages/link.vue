<script setup lang="ts">
import type { LinkBatch, LinkOptions, LinkResult, LinkConversionKey } from '#shared/link/types'
import { formatLocation, parseLocation, transformLocation } from '#shared/link/location'

useHead({ title: '주소·코드 변환', meta: [{ name: 'description', content: 'PNU·법정동코드·행정동코드·지번·도로명주소·좌표를 넣으면 주소·코드·위치·우편번호를 한 번에. 경계 SHP 다운로드.' }, { name: 'referrer', content: 'no-referrer' }] })
type SearchAddress = { address: string; jibunAddress: string; legalCode: string }
const detectedNames: Record<LinkResult['inputType'], string> = { pnu: 'PNU', code: '법정동코드', administrative: '행정동코드', address: '주소', location: '좌표', postcode: '우편번호' }
// 도로명주소·필지·건물·토지 속성은 PNU가 정해지고 위치 조회를 켠 줄에만 있다
const resultKinds: { id: LinkConversionKey; name: string }[] = [
  { id: 'address', name: '주소' }, { id: 'road_address', name: '도로명주소' }, { id: 'postcode', name: '우편번호' }, { id: 'pnu', name: 'PNU' }, { id: 'legal_region', name: '법정동코드' },
  { id: 'administrative_region', name: '행정동코드' }, { id: 'location', name: '위치' }, { id: 'parcel', name: '필지' }, { id: 'building', name: '건물' }, { id: 'land', name: '토지 속성' },
]
const regionLevels = [['sido', '시도'], ['sigungu', '시군구'], ['eupmyeondong', '읍면동'], ['ri', '리']] as const
const mode = ref<'search' | 'location'>('search'), text = ref(''), searchedAddress = ref<SearchAddress>()
const sourceCrs = ref<NonNullable<LinkOptions['sourceCrs']>>('EPSG:4326'), x = ref(''), y = ref('')
const coordinateSystems = [['EPSG:4326', '위경도 (WGS84)'], ['EPSG:3857', '웹 메르카토르'], ['EPSG:5179', 'UTM-K'], ['EPSG:5186', '중부원점 2010'], ['EPSG:5181', '중부원점']] as const
const addressSearchWidget = ref<{ open: (q?: string) => Promise<boolean> }>(), route = useRoute()
watch(addressSearchWidget, widget => {
  if (!widget || route.query.search !== '1') return
  const q = typeof route.query.q === 'string' ? route.query.q.trim().slice(0, 200) : ''
  if (q) text.value = q
  // 위젯이 막 붙은 시점에는 dialog가 아직 열리지 않으므로 화면 갱신 뒤에 연다.
  void nextTick(() => widget.open(q))
})
const batch = shallowRef<LinkBatch>(), busy = ref(false), error = ref(''), notice = ref('')
const selections = ref<NonNullable<LinkOptions['conversionSelections']>>({})
const legalSelections = ref<Record<string, string>>({})
const downloads = ref<Record<string, { busy: boolean; error: string; message: string }>>({})
const locationViews = ref<Record<string, { crs: string; value: string; error: string }>>({})
let generation = 0, linkedTimer: ReturnType<typeof setTimeout> | undefined, live = true
const canRun = computed(() => (mode.value === 'location' ? !!x.value.trim() && !!y.value.trim() : !!text.value.trim()) && !busy.value)
function clearResult() { generation++; batch.value = undefined; error.value = ''; notice.value = ''; selections.value = {}; legalSelections.value = {}; downloads.value = {}; locationViews.value = {} }
watch(text, () => { searchedAddress.value = undefined; clearResult() })
watch([mode, sourceCrs, x, y], clearResult)
async function selectAddress(value: SearchAddress) { text.value = value.address; await nextTick(); searchedAddress.value = value; await run() }
// 코드와 여러 줄은 입력 그대로 찾고, 주소 한 줄은 그 검색어로 주소 검색을 열어 후보에서 고르게 한다.
async function submit() {
  if (!canRun.value) return
  const query = text.value.trim()
  if (mode.value === 'location' || searchedAddress.value || /[\r\n]/.test(query) || !addressSearchWidget.value) return run()
  if (/^\d+$/.test(query)) {
    await run()
    // 시군구로 없는 5자리는 우편번호다. 그 번호로 주소 검색을 열어 주소를 고르게 한다.
    if (batch.value?.rows[0]?.inputType === 'postcode') await addressSearchWidget.value.open(query)
    return
  }
  if (await addressSearchWidget.value.open(query)) return
  await run()
  if (batch.value) notice.value = '주소 검색에 연결하지 못해 입력한 그대로 찾았습니다.'
}
// Enter는 검색, Shift+Enter는 줄바꿈. 한글 조합 중 Enter는 글자 확정이므로 무시한다.
function enter(event: KeyboardEvent) { if (event.isComposing || event.keyCode === 229) return; event.preventDefault(); void submit() }
const messageOf = (value: unknown) => {
  const e = value as { data?: { data?: { message?: string }; message?: string }; message?: string }
  return e.data?.data?.message || e.data?.message || e.message || '변환하지 못했습니다. 입력을 확인해 주세요.'
}
async function run() {
  if (!canRun.value) return
  const inputText = mode.value === 'location' ? x.value + ', ' + y.value : text.value
  if (inputText.includes('\t')) { error.value = '한 줄에 값 하나씩 입력해 주세요. 표나 파일 붙여넣기는 현재 지원하지 않습니다.'; return }
  const me = ++generation
  busy.value = true; error.value = ''; notice.value = ''; downloads.value = {}
  const selected = mode.value === 'search' ? searchedAddress.value : undefined
  const inputType = mode.value === 'location' ? 'location' : !selected ? 'auto' : selected.jibunAddress ? 'address' : 'code'
  const options: Partial<LinkOptions> = { inputType, target: 'all', sourceCrs: sourceCrs.value, outputCrs: 'EPSG:4326', selections: legalSelections.value, conversionSelections: selections.value }
  try {
    const input = selected ? { rows: [{ id: '입력:1', value: selected.jibunAddress || selected.legalCode, original: { 주소: selected.address, 지번주소: selected.jibunAddress } }] } : { text: inputText }
    const result = await $fetch<LinkBatch>('/api/link/resolve', { method: 'POST', body: { ...input, options } })
    if (me !== generation || !live) return
    locationViews.value = {}
    batch.value = result
    if (selected && !selected.jibunAddress) notice.value = '확정된 지번이 없는 검색 결과입니다. 법정동은 확인하되 전체 PNU는 만들지 않습니다.'
  } catch (e) { if (me === generation && live) { batch.value = undefined; error.value = messageOf(e) } }
  finally { if (me === generation && live) busy.value = false }
}
async function choose(row: LinkResult, kind: LinkConversionKey, candidateId: string) {
  if (kind !== 'administrative_region' && /^\d{10}$/.test(candidateId)) {
    legalSelections.value = { ...legalSelections.value, [row.inputId]: candidateId }
    selections.value = Object.fromEntries(Object.entries(selections.value).map(([key, values]) => [key, key === 'administrative_region' ? values : Object.fromEntries(Object.entries(values || {}).filter(([id]) => id !== row.inputId))]))
  } else selections.value = { ...selections.value, [kind]: { ...selections.value[kind], [row.inputId]: candidateId } }
  await run()
}
/** 필지 경계를 GeoJSON 파일로 (결과에 받은 도형 그대로, EPSG:4326) */
function downloadParcel(row: LinkResult) {
  const parcel = row.conversions?.parcel
  if (!parcel?.geometry) return
  const feature = { type: 'Feature', properties: { pnu: row.output.pnu, address: row.output.address, ...parcel.details, source: 'VWorld 연속지적도 (참고 도면)' }, geometry: parcel.geometry }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'FeatureCollection', features: [feature] })], { type: 'application/geo+json' })), anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'parcel-' + row.output.pnu + '.geojson'; anchor.click(); URL.revokeObjectURL(url)
}
async function downloadBoundary(row: LinkResult) {
  const legal = row.conversions?.legal_region
  if (legal?.status !== 'ok' || !legal.code || downloads.value[row.id]?.busy) return
  const me = generation
  downloads.value = { ...downloads.value, [row.id]: { busy: true, error: '', message: '' } }
  try {
    const blob = await $fetch<Blob>('/api/link/boundary', { method: 'POST', body: { codes: [legal.code], crs: 'EPSG:4326' }, responseType: 'blob' })
    if (me !== generation || !live) return
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'legal-boundary-' + legal.code + '.zip'; anchor.click(); URL.revokeObjectURL(url)
    downloads.value[row.id] = { busy: false, error: '', message: '경계 SHP 묶음을 내려받았습니다. EPSG:4326입니다.' }
  } catch (e) {
    if (me !== generation || !live) return
    let message = messageOf(e)
    const data = (e as { data?: unknown }).data
    if (data instanceof Blob) { try { const body = JSON.parse(await data.text()); message = body.data?.message || body.message || message } catch {} }
    downloads.value[row.id] = { busy: false, error: message, message: '' }
  }
}
const locationView = (row: LinkResult) => locationViews.value[row.id] || { crs: row.output.crs || 'EPSG:4326', value: row.conversions?.location.value || '', error: '' }
const resultValue = (row: LinkResult, kind: LinkConversionKey) => kind === 'location' ? locationView(row).value : row.conversions?.[kind]?.value || ''
function changeLocationCrs(row: LinkResult, event: Event) {
  const crs = (event.target as HTMLSelectElement).value
  try {
    const point = parseLocation(`${row.output.x}, ${row.output.y}`, row.output.crs)
    locationViews.value[row.id] = { crs, value: formatLocation(transformLocation(point, crs)), error: '' }
  } catch (e) {
    locationViews.value[row.id] = { crs, value: '', error: (e as Error).message || '이 좌표계로 표시할 수 없습니다.' }
  }
}
const legacyValue = (row: LinkResult) => row.output.name || row.output.code || ''
async function copy() {
  if (!batch.value) return
  const safe = (value: string) => (/^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? "'" + value : value).replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ')
  const lines = batch.value.rows.map(row => [row.original.주소 || row.value, ...resultKinds.map(kind => resultValue(row, kind.id) || (kind.id === 'location' ? locationView(row).error : '') || row.conversions?.[kind.id]?.errors.map(issue => issue.message).join(' / ') || ''), row.conversions?.legal_region.name || '', row.conversions?.administrative_region.name || '', ...regionLevels.flatMap(([level]) => [row.output[level + '_name'] || '', row.output[level + '_code'] || '']), row.output.crs ? locationView(row).crs : '', !row.conversions ? legacyValue(row) : ''].map(safe).join('\t'))
  try { await navigator.clipboard.writeText([['입력', ...resultKinds.map(kind => kind.name), '법정동명', '행정동명', ...regionLevels.flatMap(([, name]) => [name + ' 명칭', name + ' 코드']), '좌표계', '이전 작업 결과'].join('\t'), ...lines].join('\n')); notice.value = '전체 결과를 복사했습니다.' }
  catch { error.value = '클립보드에 접근할 수 없습니다. 결과를 선택해 복사해 주세요.' }
}
// 이전 MCP 작업 링크도 소유권과 만료를 확인한 뒤 원래 결과로 표시한다.
async function loadLinked(id: string, current: number) {
  const job = await $fetch<{ state: string; result?: LinkBatch; total: number; error?: { message?: string } }>('/api/link/jobs/' + encodeURIComponent(id))
  if (!live || current !== generation) return
  if (job.state === 'queued' || job.state === 'running') { linkedTimer = setTimeout(() => { loadLinked(id, current).catch(e => { error.value = messageOf(e) }) }, 500); return }
  if (!job.result) { error.value = job.error?.message || '이전 작업 결과를 읽지 못했습니다.'; return }
  locationViews.value = {}
  batch.value = job.result
  if (job.total > job.result.rows.length) notice.value = '이전 작업의 처음 ' + job.result.rows.length + '행을 표시합니다.'
}
onMounted(async () => {
  const fragment = new URLSearchParams(location.hash.slice(1)), id = fragment.get('job'), token = fragment.get('token'), current = generation
  if (id || token) history.replaceState(null, '', location.pathname + location.search)
  try {
    if (id && /^[0-9a-f-]{36}$/.test(id)) {
      if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) await $fetch('/api/link/jobs/' + id + '/claim', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: { accessToken: token } })
      await loadLinked(id, current)
    }
  } catch (e) { if (id) error.value = messageOf(e) }
})
onBeforeUnmount(() => { live = false; generation++; clearTimeout(linkedTimer) })
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap link-page">
      <header>
        <p class="eyebrow">국내 주소·코드 연계</p>
        <h1>주소·코드 변환</h1>
        <p class="lead">주소나 코드를 넣으면 주소·우편번호·PNU·법정동·행정동·위치를 한 번에 보여줍니다.</p>
        <p class="input-hint">속성 표 전체는 <NuxtLink to="/qgis">QGIS 플러그인</NuxtLink>으로 열 단위로 바꿉니다.</p>
      </header>
      <form class="converter" @submit.prevent="submit">
        <template v-if="mode === 'search'">
          <div class="search-row">
            <textarea id="link-input" v-model="text" aria-label="주소·코드 입력" placeholder="주소, PNU, 법정동·행정동 코드, 우편번호" :disabled="busy" rows="1" spellcheck="false" @keydown.enter.exact="enter" />
            <button class="btn primary" type="submit" :disabled="!canRun">{{ busy ? '검색 중…' : '검색' }}</button>
          </div>
          <p class="input-hint">코드는 바로 찾고, 주소와 우편번호는 주소 검색 후보에서 고릅니다. 여러 개는 Shift+Enter로 줄을 나눠 최대 20개까지 입력한 그대로 찾습니다.</p>
          <p v-if="searchedAddress?.jibunAddress && searchedAddress.address !== searchedAddress.jibunAddress" class="input-hint">선택한 주소에 연결된 지번: {{ searchedAddress.jibunAddress }}</p>
          <div class="tools"><button class="btn" type="button" :disabled="busy" @click="mode = 'location'">좌표로 찾기</button></div>
        </template>
        <template v-else>
          <label>입력 좌표계<select v-model="sourceCrs" aria-label="입력 좌표계" :disabled="busy"><option v-for="[code, name] in coordinateSystems" :key="code" :value="code">{{ name }} · {{ code }}</option></select></label>
          <div class="xy-fields"><label>{{ sourceCrs === 'EPSG:4326' ? '경도(X)' : 'X' }}<input id="link-x" v-model="x" :aria-label="sourceCrs === 'EPSG:4326' ? '경도(X)' : 'X'" inputmode="decimal" :disabled="busy"></label><label>{{ sourceCrs === 'EPSG:4326' ? '위도(Y)' : 'Y' }}<input v-model="y" :aria-label="sourceCrs === 'EPSG:4326' ? '위도(Y)' : 'Y'" inputmode="decimal" :disabled="busy"></label></div>
          <p class="input-hint">X는 동쪽값·경도, Y는 북쪽값·위도입니다.</p>
          <div class="tools"><button class="btn primary" type="submit" :disabled="!canRun">{{ busy ? '검색 중…' : '검색' }}</button><button class="btn" type="button" :disabled="busy" @click="mode = 'search'">주소·코드로 찾기</button></div>
        </template>
      </form>
      <ClientOnly><AddressSearch ref="addressSearchWidget" @select="selectAddress" /></ClientOnly>
      <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <section v-if="batch" class="result" aria-labelledby="result-heading">
        <div class="result-heading"><h2 id="result-heading">검색 결과</h2><button class="btn" type="button" @click="copy">결과 복사</button></div>
        <div class="table-scroll"><table aria-label="검색 결과"><thead><tr><th scope="col">입력</th><th scope="col">결과</th></tr></thead><tbody>
          <tr v-for="row in batch.rows" :key="row.id"><td class="original">{{ row.original.주소 || row.value || '(빈 값)' }}<small v-if="batch.options.inputType === 'auto' && row.value.trim()" class="detected">{{ detectedNames[row.inputType] }}로 인식</small></td><td>
            <dl v-if="row.conversions" class="result-fields">
              <div v-for="kind in resultKinds.filter(k => row.conversions?.[k.id])" :key="kind.id" class="result-field" :data-conversion="kind.id">
                <dt>{{ kind.name }}</dt><dd>
                  <span v-if="resultValue(row, kind.id)" class="value" :class="{ identifier: ['pnu', 'legal_region', 'administrative_region', 'location', 'postcode'].includes(kind.id) }">{{ resultValue(row, kind.id) }}</span>
                  <label v-if="kind.id === 'location' && row.conversions.location?.status === 'ok'" class="location-crs">좌표계<select :value="locationView(row).crs" :aria-label="row.inputId + ' 위치 결과 좌표계'" :disabled="busy" @change="changeLocationCrs(row, $event)"><option v-for="[code, name] in coordinateSystems" :key="code" :value="code">{{ name }} · {{ code }}</option></select></label>
                  <p v-if="kind.id === 'location' && locationView(row).error" class="row-error" role="alert">{{ locationView(row).error }}</p>
                  <template v-if="kind.id === 'legal_region' && row.conversions.legal_region?.status === 'ok'">
                    <ul class="region-levels"><li v-for="[level, name] in regionLevels.filter(([level]) => row.output[level + '_code'])" :key="level"><span>{{ name }} <span v-if="row.output[level + '_name']">{{ row.output[level + '_name'] }}</span></span><code>{{ row.output[level + '_code'] }}</code></li></ul>
                    <button class="btn boundary" type="button" :disabled="busy || downloads[row.id]?.busy || !row.conversions.legal_region.code" @click="downloadBoundary(row)">{{ downloads[row.id]?.busy ? '경계 다운로드 중…' : '법정동 경계 SHP 다운로드' }}</button>
                    <p v-if="downloads[row.id]?.error" class="row-error" role="alert">{{ downloads[row.id].error }}</p><p v-if="downloads[row.id]?.message" class="input-hint" role="status">{{ downloads[row.id].message }}</p>
                  </template>
                  <ul v-if="(kind.id === 'land' || kind.id === 'parcel') && row.conversions[kind.id]?.details" class="region-levels"><li v-for="[name, value] in Object.entries(row.conversions[kind.id]?.details || {})" :key="name"><span>{{ name }}</span><code>{{ value }}</code></li></ul>
                  <button v-if="kind.id === 'parcel' && row.conversions.parcel?.geometry" class="btn boundary" type="button" @click="downloadParcel(row)">필지 경계 GeoJSON 다운로드</button>
                  <p v-if="(kind.id === 'parcel' || kind.id === 'building') && row.conversions[kind.id]?.status === 'ok' && row.conversions[kind.id]?.warnings[0]" class="input-hint">{{ row.conversions[kind.id]?.warnings[0] }}</p>
                  <p v-for="issue in row.conversions[kind.id]?.errors || []" :key="issue.code" class="row-issue">{{ issue.message }}</p>
                  <p v-if="!row.conversions[kind.id]?.value && !row.conversions[kind.id]?.errors.length && !row.conversions[kind.id]?.candidates.length" class="muted">확인할 수 없습니다.</p>
                  <ul v-if="row.conversions[kind.id]?.candidates.length" class="candidates"><li v-for="candidate in row.conversions[kind.id].candidates" :key="candidate.id"><span>{{ candidate.name }} <small>{{ candidate.code }}</small></span><button class="btn" type="button" :disabled="busy" :aria-label="kind.name + ': ' + candidate.name + ' 선택'" @click="choose(row, kind.id, candidate.id)">선택</button></li></ul>
                  <p v-if="kind.id === 'location' && row.output.location_method === 'region_representative'" class="input-hint">구역 명칭으로 조회한 대표 위치입니다. 구역 중심점·개별 필지 좌표가 아닙니다.</p>
                  <p v-else-if="kind.id === 'location' && row.output.location_method === 'address_point'" class="input-hint">원천의 주소 대표점입니다. 필지 중심점은 아닙니다.</p>
                </dd>
              </div>
            </dl>
            <template v-else><span class="value">{{ legacyValue(row) }}</span><p v-for="issue in row.errors" :key="issue.code" class="row-issue">{{ issue.message }}</p></template>
          </td></tr>
        </tbody></table></div>
      </section>
      <footer class="support-note"><p>법정동과 행정동은 서로 다른 사전으로 조회합니다. 필지 존재·경계는 연속지적도(참고 도면), 건물은 도로명주소가 부여된 건물, 토지 속성은 토지특성 기준입니다.</p><NuxtLink to="/link/reference">기준 자료·업데이트 →</NuxtLink></footer>
    </div>
  </div>
</template>

<style scoped>
.link-page { max-width: 960px; padding-top: 44px; padding-bottom: 64px; }.eyebrow { color: var(--ink-2); font-size: var(--fs-0); font-weight: 600; }h1 { margin-top: 6px; font-size: var(--fs-5); }.lead { margin-top: 10px; color: var(--ink-2); }
.converter { margin-top: 28px; padding: 26px; border: 1px solid var(--rule); border-radius: var(--r-panel); background: var(--surface); }
textarea, select, .xy-fields input { width: 100%; padding: 10px 12px; border: 1px solid var(--rule); border-radius: var(--r-control); color: var(--ink); background: var(--surface); font: inherit; }.xy-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }.xy-fields label { display: grid; gap: 6px; }textarea { display: block; line-height: 1.7; resize: vertical; field-sizing: content; min-height: 46px; max-height: 14em; }.input-hint { margin-top: 7px; color: var(--ink-2); font-size: var(--fs-0); }.result small.input-hint { display: block; }
.search-row { display: flex; gap: 10px; align-items: flex-start; }.search-row textarea { flex: 1; min-width: 0; }.search-row .primary { flex: none; }.tools { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }.detected { display: block; margin-top: 4px; color: var(--ink-2); font-family: var(--font); font-size: .75rem; }.primary { min-height: 44px; padding-inline: 24px; background: var(--ink); color: white; font-weight: 600; }.btn:disabled { opacity: .5; cursor: default; }
.error, .notice { margin-top: 18px; padding: 10px 14px; border-radius: var(--r-control); }.error { background: #fff1ef; color: #a3251b; }.notice { background: #eef9f2; color: #236339; }.result { margin-top: 30px; }.result-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }.result-heading h2 { font-size: var(--fs-2); }.table-scroll { overflow: auto; border: 1px solid var(--rule); border-radius: var(--r-panel); background: var(--surface); }table { width: 100%; border-collapse: collapse; text-align: left; font-size: var(--fs-0); table-layout: fixed; }th, td { padding: 16px; border-bottom: 1px solid var(--rule); vertical-align: top; overflow-wrap: anywhere; }th { background: var(--paper); }th:first-child { width: 31%; }tbody tr:last-child td { border-bottom: 0; }.original, .identifier { font-family: var(--mono); }.original, .value { white-space: pre-wrap; }.result-fields { margin: 0; display: grid; gap: 14px; }.result-field { display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: 12px; }.result-field + .result-field { padding-top: 14px; border-top: 1px solid var(--rule); }dt { color: var(--ink-2); font-weight: 600; }dd { margin: 0; min-width: 0; }.row-issue { color: #865209; }.row-error { color: #a3251b; margin-top: 8px; }.boundary { margin-top: 10px; font-size: .8rem; }.region-levels { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 4px; }.region-levels li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; }.region-levels code { font-size: .85em; }.candidates { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 8px; }.candidates li { display: flex; align-items: center; gap: 10px; justify-content: space-between; }.candidates small { display: block; color: var(--ink-2); }.candidates button { flex: none; }.support-note { margin-top: 24px; font-size: .8rem; color: var(--ink-2); }
.location-crs { display: grid; gap: 6px; max-width: 280px; margin-top: 10px; color: var(--ink-2); font-size: .8rem; }
@media (max-width: 580px) { .link-page { padding-top: 28px; }.converter { padding: 18px; }th, td { padding: 12px; }th:first-child { width: 30%; }.result-field { grid-template-columns: 1fr; gap: 5px; } }
</style>
