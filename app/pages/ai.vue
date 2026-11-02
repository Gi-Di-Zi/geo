<script setup lang="ts">
useHead({ title: 'AI 연결 (MCP Apps · 베타)' })

const origin = ref('https://geospatial.kro.kr')

onMounted(() => { origin.value = location.origin })

const endpoint = computed(() => `${origin.value}/mcp`)
const copied = ref('')

async function copy(key: string, text: string) {
  await navigator.clipboard.writeText(text)
  copied.value = key
}

const clients = computed(() => [
  { name: 'Claude Code', command: `claude mcp add --transport http geo ${endpoint.value}`, check: '/mcp에서 연결 확인' },
  { name: 'Codex CLI', command: `codex mcp add geo --url ${endpoint.value}`, check: 'codex mcp list에서 연결 확인' },
])

const tools = [
  ['geo_identify', '업로드 화면을 엽니다. 대상 라이브러리·목적을 넘기면 화면에 미리 선택됩니다. stage를 주면 맡긴 파일의 형식을 확인하고 추천합니다.'],
  ['geo_recommend', '대상 라이브러리·목적·결과 형식·제공 방식에 맞는 변환 방식과 이유·주의를 추천합니다. 변환은 시작하지 않습니다.'],
  ['geo_convert', '추천 또는 직접 고른 방식으로 작업을 시작합니다. 서버가 조건을 다시 확인합니다.'],
  ['geo_status', '처리 단계·오류, 완료된 주력 결과물·다운로드·적용 코드, 서비스 만료 시각을 확인합니다.'],
  ['geo_formats', '현재 받는 확장자와 파일 변환 경로를 확인합니다.'],
]
</script>

<template>
  <div>
    <FlowSteps />
    <main class="wrap page">
      <h1>AI 연결 (MCP Apps) <small class="beta">베타</small></h1>
      <p class="prose lead">대화 안에서 파일 업로드 → 형식·도구 선택 → 변환 진행 → 지도·결과 파일 확인을 이어갑니다.</p>
      <p class="prose beta-note">MCP Apps 연동은 베타 기능입니다. 대화 안 화면과 파일 내려받기 지원은 호스트에 따라 달라집니다. 연결이 원활하지 않으면 <NuxtLink to="/viz/upload">웹 업로드</NuxtLink>를 이용하세요.</p>
      <p class="addr">연결 주소 <code>{{ endpoint }}</code> <button class="btn" type="button" @click="copy('endpoint', endpoint)">{{ copied === 'endpoint' ? '복사됨' : '복사' }}</button></p>

      <section class="part" aria-labelledby="connect">
        <h2 id="connect">MCP Apps 연결 방법</h2>
        <ol class="flow prose">
          <li>MCP Apps와 Streamable HTTP를 지원하는 호스트의 사용자 지정 MCP 서버·커넥터 추가 화면을 엽니다.</li>
          <li>이름은 <strong>geo</strong>, 서버 URL은 위 연결 주소, 인증 방식은 <strong>인증 없음</strong>으로 등록합니다.</li>
          <li>새 대화에서 geo를 활성화한 뒤 “공간 데이터 업로드 화면을 열어 줘”라고 요청합니다.</li>
          <li>화면에 파일을 올리고 형식·도구를 선택한 뒤 변환을 시작합니다. 채팅 첨부 파일을 서버가 자동으로 읽지는 않습니다.</li>
        </ol>
        <p class="prose small muted">화면 리소스는 <code>ui://geo/app.html</code>입니다. 공식 SDK 브리지로 업로드·변환·지도·내려받기를 확인했습니다. 실제 Claude·ChatGPT 계정에서의 연결은 아직 확인하지 않았습니다.</p>
      </section>

      <section class="part" aria-labelledby="terminal">
        <h2 id="terminal">터미널 클라이언트</h2>
        <div class="vendors">
          <article v-for="client in clients" :key="client.name" class="vendor">
            <h3>{{ client.name }}</h3>
            <div class="cmd"><pre>{{ client.command }}</pre><button class="btn" type="button" @click="copy(client.name, client.command)">{{ copied === client.name ? '복사됨' : '복사' }}</button></div>
            <p class="small muted">{{ client.check }}. MCP Apps 화면을 지원하지 않으면 <NuxtLink to="/viz/upload">웹 업로드</NuxtLink>와 결과 주소를 이용하세요.</p>
          </article>
        </div>
      </section>

      <section class="part" aria-labelledby="tools">
        <h2 id="tools">제공하는 도구</h2>
        <ul class="rows"><li v-for="[name, description] in tools" :key="name"><code>{{ name }}</code><span>{{ description }}</span></li></ul>
        <p class="small muted"><code>geo_stage_chunk</code>는 MCP Apps 화면이 파일을 나눠 보내는 내부 도구입니다.</p>
      </section>

      <section class="part" aria-labelledby="deployment">
        <h2 id="deployment">현재 공개 배포에서 가능한 범위</h2>
        <ul class="prose limits">
          <li>파일은 최대 200MB, 변환은 한 번에 하나입니다. 저장 공간이 부족하거나 다른 작업이 진행 중이면 새 요청을 거절합니다.</li>
          <li>원본과 결과는 운영자가 정리할 때까지 보관합니다. 결과 링크를 아는 사용자가 열 수 있습니다.</li>
          <li>파일 결과를 만드는 경로만 제공합니다. 서버 로컬 파일 경로·외부 URL 가져오기·새 GeoServer/Martin 레이어 발행은 제공하지 않습니다.</li>
          <li>준비된 26개 예시와 기존 공간 서버 데이터는 계속 조회할 수 있습니다.</li>
          <li>Cesium for Unreal 실시간 화면은 비활성화 상태입니다. 웹 CesiumJS 뷰어는 사용할 수 있습니다.</li>
          <li><NuxtLink to="/link">국내 주소·코드 연계 도구</NuxtLink>는 개발 중이며 이 공개 MCP 연결의 도구로 제공하지 않습니다.</li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; }
.beta { display: inline-block; vertical-align: middle; padding: 3px 8px; border: 1px solid var(--rule); border-radius: var(--r-control); font-size: var(--fs-0); font-weight: 500; }
.beta-note { margin-top: 12px; padding: 12px 16px; border-left: 3px solid var(--rule); background: var(--surface); }
.lead { margin-top: 8px; font-size: var(--fs-2); color: var(--ink-2); line-height: 1.55; }
.addr { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 16px; }
.addr code { padding: 3px 8px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-control); word-break: break-all; }
.part { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--rule); }
.part h2 { font-size: var(--fs-3); margin-bottom: 12px; }
.part > * + * { margin-top: 12px; }
.flow { display: grid; gap: 8px; padding-left: 1.4em; margin: 0; }
.flow strong { margin-right: 6px; }
.vendors { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 28rem), 1fr)); gap: 14px; }
.vendor { display: grid; align-content: start; gap: 14px; min-width: 0; padding: 16px 18px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.vendor h3 { display: flex; align-items: baseline; gap: 8px; font-size: var(--fs-2); }
.way { display: grid; gap: 8px; min-width: 0; }
.way + .way { padding-top: 14px; border-top: 1px dashed var(--rule); }
.way h4 { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: var(--fs-1); }
.cmd { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
.steps { display: grid; gap: 4px; padding-left: 1.3em; margin: 0; }
.rows { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--rule); }
.rows li { display: grid; grid-template-columns: minmax(0, 22rem) minmax(0, 1fr); gap: 4px 24px; padding: 10px 4px; border-bottom: 1px solid var(--rule); }
.limits { display: grid; gap: 6px; padding-left: 1.2em; margin: 0; }
@media (max-width: 720px) { .rows li { grid-template-columns: 1fr; } }
</style>
