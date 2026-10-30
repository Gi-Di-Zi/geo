<script setup lang="ts">
// AI 연결(MCP) 안내: 사이트 공용 서버 /mcp(server/routes/mcp.ts)에 붙는 방법 (헤더 오른쪽 버튼). 주소는 이 화면을 연 주소 기준
useHead({ title: 'AI 연결 (MCP)' })

// 미리 그린 화면과 어긋나지 않게 브라우저에 붙은 뒤에 실제 주소로 바꾼다
const origin = ref('http://localhost:3000')
onMounted(() => { origin.value = location.origin })
const endpoint = computed(() => `${origin.value}/mcp`)
// 웹 서비스(claude.ai·ChatGPT)는 회사 클라우드에서 접속 → 공개 https 주소여야 한다
const isPublic = computed(() => /^https:\/\/[^/:]+\.[^/:]+/.test(origin.value) && !/^https:\/\/(localhost|127\.|10\.|192\.168\.)/.test(origin.value))

const copied = ref('')
async function copy(key: string, text: string) {
  await navigator.clipboard.writeText(text)
  copied.value = key
}

// 터미널(CLI) = 지금 이 PC에서, 웹 = 공개 https 배포 후. checked = 직접 연결해 본 것 (웹은 아직 없음)
const vendors = computed(() => [
  {
    name: 'Claude', by: 'Anthropic',
    cli: { name: 'Claude Code', checked: true, cmd: `claude mcp add --transport http geo ${endpoint.value}`, check: '/mcp 로 연결 확인' },
    web: { name: 'claude.ai', steps: ['Customize › Connectors › + Add › Add custom connector', '이름 geo, URL에 연결 주소 → Authentication: No sign in', '대화 입력창 + › Connectors에서 geo 켜기'], note: '무료 요금제는 커스텀 커넥터 1개. 사내망 서버는 Anthropic IP 허용 필요' },
  },
  {
    name: 'OpenAI', by: 'Codex · ChatGPT',
    cli: { name: 'Codex CLI', checked: false, cmd: `codex mcp add geo --url ${endpoint.value}`, check: 'codex mcp list 로 연결 확인 (설정: ~/.codex/config.toml)' },
    web: { name: 'ChatGPT', steps: ['chatgpt.com/plugins › + › Add custom MCP server', 'Connection에 연결 주소 (/mcp 포함) → 인증 없음 → 위험 안내 확인', 'Create as a plugin → 대화에서 켜기'], note: '사내망 서버는 공개 주소 대신 Secure MCP Tunnel(워크스페이스 기능)' },
  },
])

const tools = [
  ['geo_identify', '파일 맡기기·형식 판별. 내려받기 링크(url), 이 PC 파일 경로(path, 로컬 연결만), 이전 작업 id(stage). 셋 다 없으면 대화 안에 업로드 화면(웹)'],
  ['geo_convert', '고른 형식·방식·도구로 변환 시작 → 작업 id. 이전 작업 id를 주면 같은 원본으로 다시 변환'],
  ['geo_status', '진행 단계·실패 이유. 끝나면 지도 화면·결과 파일(지도용 주소 + 내려받기)·서비스 주소'],
  ['geo_engine', '3D Tiles·지형 결과를 이 PC 언리얼(Cesium for Unreal)로 띄워 Pixel Streaming 플레이어 주소'],
  ['geo_formats', '받는 형식 전체와 형식별 방식·도구'],
]
const linkTools = [
  ['geo_link_capabilities', '지원 입력과 실제 기준 자료의 상태·버전 확인'],
  ['geo_link_resolve', '직접 입력한 주소·코드·위치 변환. 입력이 없으면 유형을 선택하는 화면 열기'],
  ['geo_link_regions', '법정동·행정동 체계를 구분한 코드·명칭 및 하위 구역 조회'],
]
const asks = [
  ['C:\\data\\상권.zip 웹 지도로 바꿔 줘', '터미널: 이 PC 파일 경로로 판별 → 형식·방식 후보를 글로'],
  ['SHP 파일을 웹 지도로 바꾸고 싶어', '웹: 대화 안에 업로드 화면 → 판별 → 방식 카드'],
  ['https://…/data.geojson 받아서 벡터타일로 만들어 줘', '링크로 받아 판별 → PMTiles·MVT 방식'],
  ['방금 결과를 GeoServer 서비스로 다시 만들어 줘', '같은 원본 → 서버 방식 → WMS·WFS 주소'],
  ['3D Tiles 결과 언리얼로 보여 줘', '엔진 실시간 보기 → 플레이어 주소'],
]
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <h1>AI 연결 (MCP)</h1>
      <p class="prose lead">
        Claude·Codex·ChatGPT 대화 안에서 <NuxtLink to="/viz/upload">내 파일로 해 보기</NuxtLink>와 같은 처리. 파일 맡기기 → 형식 판별 → 형식·방식·도구 고르기 → 변환 → 결과 내려받기·서비스 주소.
      </p>
      <p class="prose small muted">같은 연결에서 <NuxtLink to="/link">국내 주소·코드 연계</NuxtLink>도 사용합니다. 입력 유형과 값을 정하면 주소·PNU·법정동·행정동·위치를 한 번에 확인합니다.</p>
      <p class="addr">연결 주소 <code>{{ endpoint }}</code> <button class="btn" type="button" @click="copy('addr', endpoint)">{{ copied === 'addr' ? '복사됨' : '복사' }}</button></p>

      <section class="part" aria-labelledby="connect">
        <h2 id="connect">연결 방법</h2>
        <p class="prose small muted">
          두 갈래. <strong>터미널</strong>(Claude Code·Codex CLI): 이 서버와 같은 PC에서 바로, 결과는 글로. <strong>웹</strong>(claude.ai·ChatGPT): 회사 클라우드에서 이 서버로 접속 → 공개 https 주소 필요, 대신 대화 안에 업로드·고르기·진행·지도 화면(MCP Apps).
        </p>
        <div class="vendors">
          <article v-for="v in vendors" :key="v.name" class="vendor">
            <h3>{{ v.name }} <span class="muted small">{{ v.by }}</span></h3>
            <div class="way">
              <h4>{{ v.cli.name }} <span class="sk sk-domestic">지금 · 글로</span><span v-if="!v.cli.checked" class="sk sk-wip">미검증</span></h4>
              <div class="cmd">
                <pre>{{ v.cli.cmd }}</pre>
                <button class="btn" type="button" @click="copy(v.cli.name, v.cli.cmd)">{{ copied === v.cli.name ? '복사됨' : '복사' }}</button>
              </div>
              <p class="small muted">{{ v.cli.check }}. 파일은 경로나 링크로 말하기.</p>
            </div>
            <div class="way">
              <h4>{{ v.web.name }} <span v-if="isPublic" class="sk sk-domestic">대화 안 화면</span><span v-else class="sk sk-none">공개 https 주소 필요</span><span class="sk sk-wip">미검증</span></h4>
              <ol class="small steps">
                <li v-for="s in v.web.steps" :key="s">{{ s }}</li>
              </ol>
              <p class="small muted">{{ v.web.note }}.</p>
            </div>
          </article>
        </div>
        <p v-if="!isPublic" class="small muted">
          지금 주소(<code>{{ origin }}</code>)는 이 PC·사내망 안 → 웹 연결 불가. 서버 PC에 공개 도메인을 붙이고(https, 환경 변수 <code>PUBLIC_URL</code>) 그 주소로 이 화면을 열면 웹 연결 주소로 바뀜.
        </p>
        <p class="small muted">그 밖: Streamable HTTP를 받는 MCP 클라이언트면 같은 주소. 데스크톱 앱(Claude Desktop 등)도 연결 가능, MCP Apps 지원 여부에 따라 화면 또는 글.</p>
      </section>

      <section class="part" aria-labelledby="flow">
        <h2 id="flow">대화 안에서 하는 일</h2>
        <ol class="flow prose">
          <li><strong>파일 맡기기</strong> 터미널은 이 PC 파일 경로·내려받기 링크로. 웹은 대화 안 업로드 화면으로 (채팅 첨부 파일은 도구로 넘길 수 없음).</li>
          <li><strong>판별·고르기</strong> 형식 후보·근거·주의, 방식(파일·서버)·도구. AI와 정하거나 화면에서 직접. 좌표계 없는 파일은 EPSG 번호.</li>
          <li><strong>변환</strong> 도구 호출 시간 제한 때문에 작업 id부터 받고 AI가 진행 확인.</li>
          <li><strong>결과</strong> 출력마다 내려받기·지도용 주소, 서버 방식은 GeoServer·martin 서비스 주소. 3D Tiles·지형은 언리얼 실시간 보기. 같은 파일을 다른 방식으로 다시 변환 가능.</li>
        </ol>
      </section>

      <section class="part" aria-labelledby="ask">
        <h2 id="ask">말 걸기 예</h2>
        <ul class="rows">
          <li v-for="[say, then] in asks" :key="say"><q>{{ say }}</q><span class="muted small">{{ then }}</span></li>
        </ul>
      </section>

      <section class="part" aria-labelledby="tools">
        <h2 id="tools">도구</h2>
        <p class="small muted">AI가 고르는 도구. 업로드 화면 전용 조각 올리기(<code>geo_stage_chunk</code>)는 AI에게 안 보임.</p>
        <ul class="rows">
          <li v-for="[name, does] in tools" :key="name"><code>{{ name }}</code><span>{{ does }}</span></li>
        </ul>
      </section>

      <section class="part" aria-labelledby="link-tools">
        <h2 id="link-tools">국내 주소·코드 연계 도구</h2>
        <p class="prose small muted"><NuxtLink to="/link/reference">기준자료와 업데이트</NuxtLink>에서 확보 범위와 버전을 확인하세요. 법정동과 행정동은 별도 코드 체계이며 검증된 관계만 연결합니다. 코드 사전이나 위치 조회만으로 실제 필지 존재를 확인한 결과는 아닙니다. 법정동 경계 SHP는 출력 전용이며 VWorld 경계 API 권한이 필요합니다.</p>
        <ul class="rows"><li v-for="[name, does] in linkTools" :key="name"><code>{{ name }}</code><span>{{ does }}</span></li></ul>
        <p class="prose small muted">MCP Apps 화면은 <code>ui://geo/link.html</code>이며 기존 <code>ui://geo/app.html</code>도 유지합니다. 화면 미지원 호스트는 도구 결과와 웹 주소를 이용하세요. 새 주소·코드 화면의 실제 AI 호스트 동작은 미검증이며, 프로토콜·리소스 검증과 구분합니다.</p>
        <p class="prose small muted">PNU·법정동코드 / 행정동코드 / 주소 / 위치 중 입력 유형을 먼저 고르고 값을 넣으면 모든 결과를 함께 보여 줍니다. 직접 도구를 호출할 때는 <code>options.target="all"</code>을 사용합니다. SHP는 법정구역 결과의 별도 다운로드 버튼으로만 요청합니다. 위치는 위경도 또는 EPSG와 X·Y를 입력하며 주소·지역의 좌표는 대표점입니다. 웹 주소 검색은 선택한 주소에 확인된 지번이 있을 때 연결합니다. CSV·XLSX 파일 처리는 현재 제외했습니다. 채팅 첨부파일·외부 URL·서버 로컬 경로는 자동으로 읽지 않습니다.</p>
      </section>

      <section class="part" aria-labelledby="limits">
        <h2 id="limits">한계</h2>
        <ul class="prose limits">
          <li>기존 시각화 도구는 인증 없음 → 지금은 같은 PC·사내망 전제. 공개 배포 전 인증 필요. 주소·코드 도구는 별도의 작업 접근 권한을 적용합니다.</li>
          <li>직접 확인: Claude Desktop(mcp-remote, 대화 안 화면), Claude Code(연결). 미검증: Codex CLI, 웹(claude.ai·ChatGPT — 공개 주소 배포 후).</li>
          <li>파일 경로(path)는 서버와 같은 PC의 터미널 연결에서만.</li>
          <li>기존 시각화 파일은 200MB까지, 한 번에 한 작업. 결과 파일·서비스(GeoServer·martin 레이어, DB 표)는 24시간 뒤 정리 대상입니다. 주소·코드 화면의 전체 변환은 위치 조회를 포함해 한 번에 20개까지입니다.</li>
          <li>엔진 실시간 보기: 이 PC·사내망 브라우저에서만, 한 번에 하나, 첫 실행은 셰이더 컴파일로 수 분.</li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; }
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
