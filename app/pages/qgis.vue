<script setup lang="ts">
// QGIS 플러그인 안내: 사용자 지정 저장소(plugins.xml 하나) 추가 → 두 플러그인 설치. 플러그인 원본은 qgis/, 저장소는 빌드 때 scripts/qgis-plugins.ts가 만든다
useHead({ title: 'QGIS 플러그인 · geo-web-bridge', meta: [{ name: 'description', content: 'QGIS에서 레이어를 웹 지도 결과로 변환하고, 속성 표의 주소·PNU를 코드·위치로 바꾸는 두 플러그인.' }] })
const repo = 'https://geospatial.kro.kr/qgis/plugins.xml'
const copied = ref(false)

function copy() {
  void navigator.clipboard?.writeText(repo).then(() => { copied.value = true; setTimeout(() => { copied.value = false }, 1500) })
}

const plugins = [
  {
    name: 'geo-web-bridge 웹 지도 변환', id: 'geo_web_bridge', menu: '웹 → geo-web-bridge → 웹 지도로 변환…', for: '/viz',
    does: '레이어(2D 벡터·래스터)를 OpenLayers·MapLibre·Deck.gl·CesiumJS용 웹 결과로 변환합니다.',
    steps: [
      '레이어와 대상 라이브러리·목적을 고릅니다. "선택한 피처만"도 됩니다.',
      '최종본 형태를 고릅니다: 결과 파일 + 적용 코드(내 웹 프로젝트에 넣기) 또는 바로 열리는 HTML 지도(결과 + index.html + 라이브러리 한 폴더).',
      '변환이 끝나면 저장 폴더에 결과가 풀리고, 결과(GeoJSON·타일 폴더·COG)를 QGIS에 다시 불러와 확인합니다. 적용 코드는 화면에서 복사합니다.',
    ],
    notes: [
      '벡터는 GeoPackage, 래스터는 GeoTIFF로 보냅니다. 좌표계는 레이어 그대로라 따로 고를 필요가 없습니다.',
      '공개 서버는 파일 200MB, 접속자별 하루 1GiB. 레이어 스타일(색·분류)은 아직 결과에 옮기지 않습니다.',
      '3D(점군·CityGML·IFC 등)는 웹 업로드나 AI 연결에서 다룹니다.',
    ],
  },
  {
    name: 'geo-web-bridge 주소·코드 연계', id: 'geo_address_link', menu: '웹 → geo-web-bridge → 주소·코드 연계…', for: '/link',
    does: '속성 표의 한 열(PNU·법정동코드·행정동코드·지번주소·도로명주소)을 주소·PNU·단계별 코드·행정동·우편번호·위치로 바꿔 새 레이어에 붙입니다.',
    steps: [
      '레이어와 값이 든 열, 입력 종류(자동 판별 가능)를 고릅니다. 도형 없는 표도 됩니다.',
      '붙일 결과를 고릅니다: 주소·PNU, 법정동, 시도·시군구·읍면동·리 코드, 행정동, 우편번호·위치.',
      '원본은 그대로 두고 결과 열을 붙인 새 레이어가 추가됩니다. 위치를 찾으면 점 레이어(EPSG:4326)도 만듭니다.',
    ],
    notes: [
      '같은 이름이 여러 곳이면 임의로 고르지 않고 "확인 사항" 열에 후보를 남깁니다. 옛 시도명·코드, 빠진 상위 단계를 바꾸거나 채운 경우도 적습니다.',
      '위치·우편번호·도로명주소는 외부 조회(VWorld)라 20줄씩, 공개 서버는 접속자별 하루 2,000줄. 끄면 사전만으로 200줄씩, 한도 없이 변환합니다.',
      '코드는 문자열 열로 넣어 앞자리 0과 19자리 PNU가 깨지지 않습니다. 열 이름은 Shapefile 10자 제한에 맞추고 한글 별칭을 붙입니다.',
    ],
  },
]
</script>

<template>
  <div>
    <FlowSteps />
    <main class="wrap page">
      <h1>QGIS 플러그인</h1>
      <p class="prose lead">QGIS에서 쓰던 레이어를 그대로 웹 지도 결과로 바꾸고, 속성 표의 주소·PNU를 코드와 위치로 바꿉니다. 이 사이트의 시각화 도구·주소·코드 연계 도구와 같은 서버·규칙을 씁니다.</p>
      <p class="addr">저장소 주소 <code>{{ repo }}</code> <button class="btn" type="button" @click="copy">{{ copied ? '복사됨' : '복사' }}</button></p>

      <section class="part" aria-labelledby="install">
        <h2 id="install">설치</h2>
        <ol class="flow prose">
          <li>QGIS 메뉴 <strong>플러그인 → 플러그인 관리 및 설치</strong>를 엽니다.</li>
          <li><strong>설정</strong> 탭에서 <strong>추가…</strong>를 누르고 이름은 <strong>geo-web-bridge</strong>, URL은 위 저장소 주소를 넣습니다.</li>
          <li><strong>모두</strong> 탭에서 "geo-web-bridge"를 찾아 두 플러그인을 설치합니다. 새 버전이 나오면 같은 화면에서 업그레이드됩니다.</li>
        </ol>
        <p class="prose small muted">QGIS 3.28 이상(QGIS 4 포함). 추가 Python 패키지는 필요 없습니다. 인터넷이 막힌 곳은 <a href="/qgis/geo_web_bridge.zip">웹 지도 변환 zip</a>·<a href="/qgis/geo_address_link.zip">주소·코드 연계 zip</a>을 받아 <strong>ZIP에서 설치</strong>로 넣습니다.</p>
      </section>

      <section class="part" aria-labelledby="plugins">
        <h2 id="plugins">플러그인</h2>
        <div class="vendors">
          <article v-for="p in plugins" :key="p.id" class="vendor">
            <h3>{{ p.name }}</h3>
            <p class="prose">{{ p.does }} <NuxtLink :to="p.for">웹에서 보기</NuxtLink></p>
            <p class="small muted">메뉴: {{ p.menu }}</p>
            <ol class="flow small">
              <li v-for="s in p.steps" :key="s">{{ s }}</li>
            </ol>
            <ul class="small limits">
              <li v-for="n in p.notes" :key="n">{{ n }}</li>
            </ul>
          </article>
        </div>
      </section>

      <section class="part" aria-labelledby="server">
        <h2 id="server">서버</h2>
        <p class="prose">기본은 공개 서버(<code>https://geospatial.kro.kr</code>)입니다. 외부로 내보낼 수 없는 자료는 저장소를 받아 직접 설치한 서버 주소를 플러그인의 <strong>서버</strong> 칸에 넣습니다. 변환 규칙·결과는 같습니다.</p>
        <p class="prose small muted">공개 서버에 올린 원본·결과는 운영자가 정리할 때까지 보관되고 결과 주소를 아는 사람은 열 수 있습니다. 민감한 자료는 공개 서버에 올리지 마세요.</p>
      </section>
    </main>
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
.vendors { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 28rem), 1fr)); gap: 14px; }
.vendor { display: grid; align-content: start; gap: 12px; min-width: 0; padding: 16px 18px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.vendor h3 { font-size: var(--fs-2); }
.limits { display: grid; gap: 6px; padding-left: 1.2em; margin: 0; }
</style>
