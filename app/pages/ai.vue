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
  { name: 'Claude Code', command: `claude mcp add --transport http geo-web-bridge ${endpoint.value}`, check: '/mcp에서 연결 확인' },
  { name: 'Codex CLI', command: `codex mcp add geo-web-bridge --url ${endpoint.value}`, check: 'codex mcp list에서 연결 확인' },
])

// 요청 → 모델이 도구에 넘기는 조건 → 서버 추천 (shared/recommend.ts, 시험 파일 기준)
const examples = [
  ['이 SHP를 MapLibre에서 대용량으로 쓰게', 'viewer=maplibre · priority=large_data', 'tippecanoe → PMTiles (대안: GDAL → MVT)'],
  ['CesiumJS에서 쓸 수 있게 (SHP)', 'viewer=cesium', 'GDAL → GeoJSON. CesiumJS는 벡터타일 미지원'],
  ['PMTiles로만 만들어 줘', 'outputKind=pmtiles', '라이브러리를 묻지 않고 tippecanoe → PMTiles'],
  ['이 LAS를 OpenLayers에서', 'viewer=ol', '미지원 이유(2D 지도)와 대안: Deck.gl·CesiumJS → 3D Tiles'],
  ['원본 정밀도를 최대한 살려서 (LAZ, CesiumJS)', 'viewer=cesium · priority=fidelity', 'py3dtiles → 3D Tiles (좌표 양자화 없음)'],
  ['WMS 응답을 시험해 보고 싶어', 'delivery=service', '허용 서버: GeoServer 48시간 임시 서비스. 공개 서버: 미지원 이유와 파일 대안'],
]

const tools = [
  ['geo_identify', '업로드 화면을 엽니다. 대상 라이브러리·목적을 넘기면 화면에 미리 선택됩니다. stage를 주면 맡긴 파일의 형식을 확인하고 추천합니다.'],
  ['geo_recommend', '대상 라이브러리·목적·결과 형식·제공 방식에 맞는 변환 방식과 이유·주의를 추천합니다. 변환은 시작하지 않습니다.'],
  ['geo_convert', '추천(방식 생략) 또는 직접 고른 방식으로 작업을 시작합니다. 서버가 조건을 다시 확인하고 맞지 않으면 시작하지 않습니다.'],
  ['geo_status', '처리 단계·오류, 완료된 주력 결과물·내려받기·리소스 URL·적용 코드·결과 파일 검사, 서비스 만료 시각을 확인합니다.'],
  ['geo_formats', '받는 확장자, 파일 변환 방식, 뷰어별 지원을 확인합니다.'],
]
</script>

<template>
  <div>
    <FlowSteps />
    <main class="wrap page">
      <h1>AI 연결 (MCP Apps) <small class="beta">베타</small></h1>
      <p class="prose lead">쓸 웹 지도 라이브러리와 목적을 말하면 → 파일을 올리고 → 서버가 맞는 변환을 추천하고 → 확인·변경한 조건으로 변환해 → 그 라이브러리에 바로 쓸 결과 파일·주소·적용 코드를 받습니다. 변환 도구 이름을 몰라도 됩니다.</p>
      <p class="prose beta-note">MCP Apps 연동은 베타 기능입니다. 대화 안 화면과 파일 내려받기 지원은 호스트에 따라 달라집니다. 연결이 원활하지 않으면 <NuxtLink to="/viz/upload">웹 업로드</NuxtLink>를 이용하세요. 웹 업로드도 같은 추천 규칙을 씁니다.</p>
      <p class="addr">연결 주소 <code>{{ endpoint }}</code> <button class="btn" type="button" @click="copy('endpoint', endpoint)">{{ copied === 'endpoint' ? '복사됨' : '복사' }}</button></p>

      <section class="part" aria-labelledby="connect">
        <h2 id="connect">연결과 사용</h2>
        <ol class="flow prose">
          <li>MCP Apps와 Streamable HTTP를 지원하는 호스트의 사용자 지정 MCP 서버·커넥터 추가 화면을 엽니다. 이름은 <strong>geo-web-bridge</strong>, 서버 URL은 위 연결 주소, 인증 방식은 <strong>인증 없음</strong>으로 등록합니다.</li>
          <li>새 대화에서 geo-web-bridge를 켜고 원하는 결과를 말합니다. 예: “이 SHP를 MapLibre에서 대용량으로 쓰게 변환해 줘”. 모델이 대상 라이브러리·목적·결과 형식·제공 방식을 읽어 넘기면, 그 조건이 미리 선택된 업로드 화면이 열립니다.</li>
          <li>화면에 파일을 올리면 추천 카드가 나옵니다: 변환 방식 → 대상 라이브러리용 주력 결과물 → 추천 이유 → 주의사항(손실·배치 제약). 라이브러리·목적을 바꾸면 다시 계산되고, <strong>다른 방식 보기</strong>에서 직접 고를 수도 있습니다. 화면에서 바꾼 조건이 그대로 변환에 쓰입니다.</li>
          <li>변환이 끝나면 주력 결과물·내려받기·리소스 URL·적용 코드·호스팅 조건·결과 파일 검사와 결과 지도를 확인합니다. 결과 지도의 <strong>선택</strong> 버튼을 켜고 누르면 피처 속성, 모델·타일셋, 래스터·지형 레이어 정보가 보입니다.</li>
        </ol>
        <p class="prose small muted">채팅 첨부 파일을 서버가 자동으로 읽지는 않습니다. 화면 리소스는 <code>ui://geo/app.html</code>입니다.</p>
      </section>

      <section class="part" aria-labelledby="examples">
        <h2 id="examples">요청 예시</h2>
        <p class="prose small muted">추천은 별도 AI 모델이 아니라 서버의 명시 규칙(뷰어별 지원 결과, 목적, 파일 크기·피처 수·좌표계 등)으로 계산합니다. 지원하지 않는 조합은 이유와 실제 가능한 대안을 줍니다.</p>
        <ul class="rows ex">
          <li v-for="[ask, args, result] in examples" :key="ask"><span>“{{ ask }}”</span><code>{{ args }}</code><span>{{ result }}</span></li>
        </ul>
      </section>

      <section class="part" aria-labelledby="delivery">
        <h2 id="delivery">결과 제공 방식</h2>
        <div class="vendors">
          <article class="vendor">
            <h3>파일 <small class="muted">기본</small></h3>
            <p class="prose">실제 웹 프로젝트에서 사용할 수 있는 공간데이터 파일을 만듭니다. 내려받아 자신의 웹 서버나 애플리케이션에서 씁니다.</p>
            <ul class="small limits">
              <li>여러 파일 결과(타일 폴더·3D Tiles·지형)는 폴더 구조 그대로 zip. 결과 안에 이 서버 주소 의존이 없는지 서버가 검사</li>
              <li>좌표계·범위·레이어 이름, 형식별 호스팅 조건(MIME·Range 요청·CORS), 대상 라이브러리 적용 코드 제공</li>
              <li>내려받은 파일은 이 서버와 무관하게 계속 사용. 서버의 사본과 내려받기 주소는 운영자가 정리할 때까지 보관(기간 보장 없음)</li>
            </ul>
          </article>
          <article class="vendor">
            <h3>서비스 <small class="muted">48시간 임시</small></h3>
            <p class="prose">WMS·WFS·OGC API Features·벡터타일 등 공간 서비스의 실제 응답과 웹 지도 연동을 확인하는 용도입니다.</p>
            <ul class="small limits">
              <li>발행 완료 후 48시간이 지나면 자동 만료(이후 410). 연장·자동 갱신 없음</li>
              <li>만료되면 이 작업의 DB 표·레이어를 정리. 계속 쓰려면 파일로 변환해 직접 호스팅</li>
              <li><strong>공개 배포에서는 제공하지 않습니다.</strong> 요청하면 파일로 바꾸지 않고 이유와 파일 대안을 안내</li>
            </ul>
          </article>
        </div>
      </section>

      <section class="part" aria-labelledby="terminal">
        <h2 id="terminal">터미널 클라이언트 · 앱 화면 없이 쓰기</h2>
        <div class="vendors">
          <article v-for="client in clients" :key="client.name" class="vendor">
            <h3>{{ client.name }}</h3>
            <div class="cmd"><pre>{{ client.command }}</pre><button class="btn" type="button" @click="copy(client.name, client.command)">{{ copied === client.name ? '복사됨' : '복사' }}</button></div>
            <p class="small muted">{{ client.check }}.</p>
          </article>
        </div>
        <p class="prose small">MCP Apps 화면을 지원하지 않는 클라이언트도 <code>geo_identify</code> → <code>geo_recommend</code> → <code>geo_convert</code> → <code>geo_status</code>로 같은 추천·결과·만료 정보를 텍스트로 받습니다. 파일은 <NuxtLink to="/viz/upload">웹 업로드</NuxtLink>로 올리고, 만든 작업 id를 stage로 넘기면 같은 파일을 다른 조건으로 다시 변환할 수 있습니다.</p>
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
          <li>파일 결과를 만드는 경로만 제공합니다. 서버 로컬 파일 경로·외부 URL 가져오기·새 공간 서비스 발행은 제공하지 않습니다.</li>
          <li>서버의 원본·결과는 운영자가 정리할 때까지 보관하며 기간은 보장하지 않습니다. 결과 링크를 아는 사용자가 열 수 있습니다.</li>
          <li>준비된 26개 예시와 기존 공간 서버 데이터는 계속 조회할 수 있습니다.</li>
          <li>Cesium for Unreal 실시간 화면은 비활성화 상태입니다. 웹 CesiumJS 뷰어는 사용할 수 있습니다.</li>
          <li><NuxtLink to="/link">국내 주소·코드 연계 도구</NuxtLink>는 개발 중이며 이 공개 MCP 연결의 도구로 제공하지 않습니다.</li>
        </ul>
      </section>

      <section class="part" aria-labelledby="verified">
        <h2 id="verified">검증 범위</h2>
        <ul class="prose limits">
          <li>공식 SDK 브리지 시험: AI가 넘긴 라이브러리로 화면이 열리고, 사용자가 바꾼 라이브러리가 추천·변환 인자·결과에 반영됨. 변환·결과 지도·내려받기까지 확인했습니다.</li>
          <li>시험 파일 33종(25개 형식과 좌표계·인코딩·폴더 구조 경계 사례)을 추천 방식으로 변환하고 결과 파일 검사·결과 지도 표시를 확인했습니다.</li>
          <li>서비스 48시간 만료는 서비스를 허용한 로컬 시험 서버에서 만료 전 응답 → 만료 뒤 차단 → 정리까지 확인했습니다.</li>
          <li>실제 Claude·ChatGPT 계정에서의 연결과 호스트별 앱 표시·도구 승인·내려받기는 아직 확인하지 않았습니다.</li>
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
.vendors { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 28rem), 1fr)); gap: 14px; }
.vendor { display: grid; align-content: start; gap: 14px; min-width: 0; padding: 16px 18px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.vendor h3 { display: flex; align-items: baseline; gap: 8px; font-size: var(--fs-2); }
.cmd { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
.rows { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--rule); }
.rows li { display: grid; grid-template-columns: minmax(0, 22rem) minmax(0, 1fr); gap: 4px 24px; padding: 10px 4px; border-bottom: 1px solid var(--rule); }
.rows.ex li { grid-template-columns: minmax(0, 18rem) minmax(0, 16rem) minmax(0, 1fr); }
.rows.ex code { font-size: var(--fs-0); overflow-wrap: anywhere; }
.limits { display: grid; gap: 6px; padding-left: 1.2em; margin: 0; }
@media (max-width: 720px) { .rows li, .rows.ex li { grid-template-columns: 1fr; } }
</style>
