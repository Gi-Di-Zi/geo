<script setup lang="ts">
// QGIS 연결 방법: ① 플러그인(사용자 지정 저장소 plugins.xml 하나) ② 결과 주소를 QGIS에 바로 ③ 공간 서비스(WMS·WMTS·WFS·OGC API·벡터 타일) 연결.
// 예시 주소는 공개 사이트의 예시 결과·서버이며 QGIS 3.44에서 열리는 것을 확인한 것. 플러그인 원본은 qgis/, 저장소는 빌드 때 scripts/qgis-plugins.ts
useHead({ title: 'QGIS 연결 (개발 중) · geo-web-bridge', meta: [{ name: 'description', content: 'QGIS에서 geo-web-bridge를 쓰는 방법: 플러그인 두 개(웹 지도 변환·주소·코드 연계), 결과 주소 바로 열기, WMS·WFS·OGC API·벡터 타일 연결.' }] })
const site = 'https://geospatial.kro.kr'
const repo = `${site}/qgis/plugins.xml`
const copied = ref('')

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => { copied.value = text; setTimeout(() => { copied.value = '' }, 1500) })
}

const ways = [
  { href: '#plugins', title: '플러그인', text: '레이어를 웹 지도 결과로 변환하고, 속성 표의 주소·PNU를 코드·위치로 바꿉니다. 저장소 주소 하나로 설치·업데이트.' },
  { href: '#urls', title: '결과 주소로 바로 열기', text: '웹·AI·플러그인이 만든 GeoJSON·PMTiles·COG·타일·3D Tiles를 내려받지 않고 주소로 엽니다.' },
  { href: '#services', title: '공간 서비스 연결', text: '예시 공간 서버의 WMS·WMTS·WFS·OGC API Features·벡터 타일을 QGIS 연결로 등록합니다.' },
]

const plugins = [
  {
    name: 'geo-web-bridge 웹 지도 변환', id: 'geo_web_bridge', menu: '웹 → geo-web-bridge → 웹 지도로 변환 (오른쪽 패널)', for: '/viz',
    does: '레이어(2D 벡터·래스터)를 OpenLayers·MapLibre·Deck.gl·CesiumJS용 웹 결과로 변환합니다.',
    steps: [
      '레이어를 고릅니다. "예시 데이터로 해 보기"에서 확장자별 공개 예시(GeoPackage·FlatGeobuf·GeoJSON·SHP·GML·GeoTIFF·PNG·JPG·WebP·IMG)를 불러와 바로 해 볼 수도 있습니다.',
      '대상 라이브러리(자동 추천 가능)를 고릅니다. "선택한 피처만"도 됩니다.',
      '최종본 형태를 고릅니다: 결과 파일 + 적용 코드(내 웹 프로젝트에 넣기) 또는 바로 열리는 HTML 지도(결과 + index.html + 라이브러리 한 폴더).',
      '변환이 끝나면 저장 폴더에 결과가 풀리고, 결과(GeoJSON·타일 폴더·COG)를 QGIS에 다시 불러와 확인합니다. 적용 코드는 패널의 결과 칸에 나옵니다. 저장 폴더와 폴더 열기는 옵션에 있습니다.',
    ],
    notes: [
      '벡터는 GeoPackage, 래스터는 GeoTIFF로 보냅니다. 좌표계는 레이어 그대로라 따로 고를 필요가 없습니다.',
      '공개 서버는 파일 200MB, 접속자별 하루 1GiB. 레이어 스타일(색·분류)은 아직 결과에 옮기지 않습니다.',
      '3D(점군·CityGML·IFC 등)는 웹 업로드나 AI 연결에서 다룹니다.',
    ],
  },
  {
    name: 'geo-web-bridge 주소·코드 연계', id: 'geo_address_link', menu: '웹 → geo-web-bridge → 주소·코드 연계 (오른쪽 패널)', for: '/link',
    does: '웹처럼 주소·코드·좌표를 바로 찾거나, 속성 표의 한 열(PNU·법정동코드·행정동코드·지번주소·도로명주소) 또는 레이어의 도형 위치를 주소·PNU·단계별 코드·행정동·우편번호·위치·도로명주소·건물 유무·필지 실재·토지 속성으로 바꿔 새 레이어에 붙입니다.',
    steps: [
      '직접 검색 탭: 주소·코드·좌표(경도, 위도)를 한 줄에 하나씩(최대 20줄) 넣거나 지도에서 찍기로 그 지점의 필지를 찾습니다. 결과는 패널에 보이고(값을 두 번 누르면 복사), 점·필지 레이어로 추가할 수 있습니다.',
      '레이어 값 탭: 레이어와 값이 든 열, 입력 종류(자동 판별 가능)를 고릅니다. 도형 없는 표도 됩니다. 점·면 레이어는 "도형 위치"를 고르면 그 지점의 필지를 찾습니다.',
      '붙일 결과를 고릅니다: 주소·PNU, 법정동, 시도·시군구·읍면동·리 코드, 행정동, 우편번호·위치, 도로명주소·건물 유무, 필지 실재·토지 속성(면적·공시지가는 숫자 열).',
      '원본은 그대로 두고 결과 열을 붙인 새 레이어가 추가됩니다. 위치로 점 레이어, 필지 경계(연속지적도)로 면 레이어도 만들 수 있습니다(EPSG:4326).',
    ],
    notes: [
      '같은 이름이 여러 곳이면 임의로 고르지 않고 "확인 사항" 열에 후보를 남깁니다. 옛 시도명·코드를 바꾸거나 빠진 상위 단계를 채운 경우도 적습니다.',
      '위치·우편번호·도로명주소는 외부 조회(VWorld)라 20줄씩, 공개 서버는 접속자별 하루 2,000줄. 끄면 사전만으로 200줄씩, 한도 없이 변환합니다.',
      '코드는 문자열 열로 넣어 앞자리 0과 19자리 PNU가 깨지지 않습니다. 열 이름은 Shapefile 10자 제한에 맞추고 한글 별칭을 붙입니다.',
    ],
  },
]

// 결과 주소로 바로 열기: 결과 종류 → QGIS에서 여는 곳 → 예시 주소(공개 사이트의 예시 결과)
const urls = [
  { kind: 'GeoJSON', how: '레이어 → 레이어 추가 → 벡터 레이어 → 원본 유형 "프로토콜: HTTP(S), 클라우드 등" → URI에 주소', url: `${site}/data/vector-2d/geojson/gdal/ogc/collections/areas/items.json` },
  { kind: 'PMTiles (벡터)', how: '벡터 레이어 추가에서 원본 유형 "파일" → 주소 앞에 /vsicurl/ 을 붙여 넣기 (QGIS에 들어 있는 GDAL의 PMTiles 읽기)', url: `/vsicurl/${site}/data/vector-2d/fgb/tippecanoe/countries.pmtiles` },
  { kind: 'COG (영상)', how: '레이어 추가 → 래스터 레이어 → 원본 유형 "프로토콜: HTTP(S), 클라우드 등" → URI. 보이는 부분만 범위 요청', url: `${site}/data/raster/cog/gdal/seoul_3857.tif` },
  { kind: 'MVT 타일 폴더', how: '탐색기 패널 → 벡터 타일 → 새 일반 연결 → URL과 최소·최대 줌', url: `${site}/data/vector-2d/geojson/gdal/tiles/{z}/{x}/{y}.pbf` },
  { kind: '래스터 타일 (XYZ)', how: '탐색기 패널 → XYZ Tiles → 새 연결 → URL과 최대 줌', url: `${site}/data/raster/cog/gdal/tiles/{z}/{x}/{y}.png` },
  { kind: '3D Tiles', how: 'QGIS 3.34 이상: 레이어 → 레이어 추가 → 타일 장면 레이어 추가(Add Tiled Scene Layer) → Cesium 3D Tiles 새 연결 → tileset.json 주소. 3D 지도 보기에서 입체로', url: `${site}/data/model-3d/citygml/mago/tiles/tileset.json` },
]

// 공간 서비스: 예시 공간 서버(GeoServer·martin)의 읽기 전용 서비스
const services = [
  { kind: 'WMS', how: '데이터 원본 관리자 → WMS/WMTS → 새 연결 → URL → 연결 → 레이어 고르기', url: `${site}/svc/geoserver/wms` },
  { kind: 'WMTS', how: '같은 화면에서 WMTS 주소로 새 연결 (GeoWebCache 타일)', url: `${site}/svc/geoserver/gwc/service/wmts` },
  { kind: 'WFS', how: '데이터 원본 관리자 → WFS / OGC API - Features → 새 연결 → 버전 2.0 → 레이어 고르기', url: `${site}/svc/geoserver/ows` },
  { kind: 'OGC API - Features', how: '같은 화면에서 OGC API 주소로 새 연결 (WFS의 후속 표준, GeoJSON)', url: `${site}/svc/geoserver/ogc/features/v1` },
  { kind: '벡터 타일 (martin)', how: '탐색기 패널 → 벡터 타일 → 새 일반 연결 → URL (요청마다 DB에서 만드는 MVT)', url: `${site}/svc/martin/areas/{z}/{x}/{y}` },
]
</script>

<template>
  <div>
    <FlowSteps />
    <main class="wrap page">
      <h1>QGIS 연결 <small class="beta">개발 중</small></h1>
      <p class="prose lead">QGIS에서 geo-web-bridge를 쓰는 세 가지 방법입니다. 이 사이트의 시각화 도구·주소·코드 연계 도구와 같은 서버·규칙을 씁니다.</p>
      <p class="prose beta-note"><strong>개발 중:</strong> 두 플러그인은 실험 버전입니다. 아직 충분히 시험하지 않아 오류가 날 수 있습니다. 문제가 생기면 <a href="https://github.com/Gi-Di-Zi/geo/issues">GitHub 이슈</a>로 알려 주세요.</p>
      <ul class="ways">
        <li v-for="w in ways" :key="w.href"><a :href="w.href"><b>{{ w.title }}</b><span>{{ w.text }}</span></a></li>
      </ul>

      <section id="plugins" class="part" aria-labelledby="install">
        <h2 id="install">① 플러그인 설치</h2>
        <p class="addr">저장소 주소 <code>{{ repo }}</code> <button class="btn" type="button" @click="copy(repo)">{{ copied === repo ? '복사됨' : '복사' }}</button></p>
        <ol class="flow prose">
          <li>QGIS 메뉴 <strong>플러그인 → 플러그인 관리 및 설치</strong>를 엽니다.</li>
          <li><strong>설정</strong> 탭에서 <strong>추가…</strong>를 누르고 이름은 <strong>geo-web-bridge</strong>, URL은 위 저장소 주소를 넣습니다. 같은 탭의 <strong>실험적인 플러그인도 표시</strong>(Show also experimental plugins)를 켭니다. 두 플러그인은 실험 버전이라 이 항목을 켜야 목록에 나옵니다.</li>
          <li><strong>모두</strong> 탭에서 "geo-web-bridge"를 찾아 두 플러그인을 설치합니다. 새 버전이 나오면 <strong>업그레이드 가능</strong> 탭에 나옵니다.</li>
        </ol>
        <p class="prose small muted">QGIS 3.28 이상(QGIS 4 포함), 추가 Python 패키지 없음. 저장소에 접속할 수 없는 곳은 <a href="/qgis/geo_web_bridge.zip">웹 지도 변환 zip</a>·<a href="/qgis/geo_address_link.zip">주소·코드 연계 zip</a>을 받아 <strong>ZIP에서 설치</strong>로 넣습니다.</p>

        <h3 class="sub">플러그인 쓰기</h3>
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

      <section id="urls" class="part" aria-labelledby="urls-title">
        <h2 id="urls-title">② 결과 주소로 바로 열기</h2>
        <p class="prose">결과를 내려받지 않고 QGIS에서 주소로 엽니다. 예시 주소는 이 사이트의 예시 결과입니다. 내 파일 변환 결과는 결과 화면·플러그인·AI가 주는 <strong>리소스 URL</strong>을 같은 방법으로 엽니다(서버 사본은 보관 기간을 보장하지 않으니 계속 쓰려면 내려받기).</p>
        <ul class="rows">
          <li v-for="u in urls" :key="u.kind">
            <b>{{ u.kind }}</b>
            <span>{{ u.how }}</span>
            <span class="url"><code>{{ u.url }}</code> <button class="btn" type="button" @click="copy(u.url)">{{ copied === u.url ? '복사됨' : '복사' }}</button></span>
          </li>
        </ul>
      </section>

      <section id="services" class="part" aria-labelledby="services-title">
        <h2 id="services-title">③ 공간 서비스 연결</h2>
        <p class="prose">예시 공간 서버(GeoServer·martin)의 읽기 전용 서비스입니다. 한 번 연결해 두면 레이어 목록에서 골라 씁니다.</p>
        <ul class="rows">
          <li v-for="s in services" :key="s.kind">
            <b>{{ s.kind }}</b>
            <span>{{ s.how }}</span>
            <span class="url"><code>{{ s.url }}</code> <button class="btn" type="button" @click="copy(s.url)">{{ copied === s.url ? '복사됨' : '복사' }}</button></span>
          </li>
        </ul>
        <p class="prose small muted">업로드한 내 파일의 임시 공간 서비스(48시간)는 공개 서버에서 제공하지 않습니다. 직접 설치한 서버에서는 결과 화면의 서비스 주소를 같은 방법으로 연결합니다.</p>
      </section>

      <section class="part" aria-labelledby="server">
        <h2 id="server">서버 고르기</h2>
        <p class="prose">플러그인은 공개 서버(<code>{{ site }}</code>)를 씁니다. 화면에 서버 칸은 없습니다. 외부로 내보낼 수 없는 자료는 저장소를 받아 서버를 직접 설치하고, QGIS <strong>설정 → 옵션 → 고급</strong>의 고급 설정 편집기에서 <code>geo_web_bridge/server_override</code>·<code>geo_address_link/server_override</code>를 그 서버 주소로 넣습니다(패널에 개발 서버로 표시).</p>
        <p class="prose small muted">공개 서버에 올린 원본·결과는 운영자가 정리할 때까지 보관되고 결과 주소를 아는 사람은 열 수 있습니다. 민감한 자료는 공개 서버에 올리지 마세요.</p>
        <details class="dev">
          <summary>개발·시험 (저장소를 받은 경우)</summary>
          <ul class="small limits">
            <li><code>npm run qgis:dev</code> — 이 PC의 QGIS 프로필에 저장소의 플러그인을 바로가기로 연결하고, 두 플러그인을 켜고, 숨은 설정 <code>server_override</code>를 <code>http://localhost:3000</code>으로 맞춥니다(QGIS가 꺼져 있을 때). 코드를 고친 뒤 QGIS를 다시 켜면 반영됩니다. 되돌리기는 <code>npm run qgis:dev -- --remove</code>.</li>
            <li><code>npm run test:qgis</code> — 설치된 QGIS로 흐름 시험(내보내기 → 실제 변환 → 결과 레이어, 주소·코드 연계)과 데스크톱 시험(임시 프로필로 띄워 메뉴·오른쪽 패널·닫기)을 돌립니다. 서버는 <code>QGIS_TEST_URL</code>(기본 로컬).</li>
          </ul>
        </details>
      </section>

      <section class="part" aria-labelledby="trouble">
        <h2 id="trouble">문제가 생기면</h2>
        <ul class="prose limits">
          <li><strong>저장소에 플러그인이 안 보임:</strong> 설정 탭의 <strong>실험적인 플러그인도 표시</strong>를 켰는지 확인하고 <strong>모든 저장소 다시 불러오기</strong>. QGIS 3.28보다 낮으면 표시되지 않습니다.</li>
          <li><strong>사내망·프록시:</strong> 플러그인은 운영체제(Windows) 프록시 설정으로 서버에 접속합니다. 저장소에 못 가면 ZIP으로 설치하고, 외부 접속이 막히면 직접 설치한 서버를 쓰세요.</li>
          <li><strong>하루 한도(429):</strong> 공개 서버의 업로드 1GiB·외부 조회 2,000줄을 넘었습니다. 다음 날 다시 하거나, 주소·코드 연계는 외부 조회를 끄고(사전만) 변환하세요.</li>
          <li><strong>PNU가 1.11E+18처럼 보임:</strong> CSV를 숫자로 읽어 자릿수가 이미 사라진 값입니다. 구분자로 분리된 텍스트 추가에서 "필드 형식 감지"를 끄고 문자열로 다시 불러오세요. 플러그인은 이런 값을 정밀도 손실로 알려 줍니다.</li>
          <li><strong>결과 열 이름이 짧음:</strong> Shapefile로 저장해도 깨지지 않게 10자 이하로 짓고, 레이어 속성의 별칭에 한글 이름이 있습니다.</li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; }
.beta { display: inline-block; vertical-align: middle; padding: 3px 8px; border: 1px solid var(--rule); border-radius: var(--r-control); font-size: var(--fs-0); font-weight: 500; }
.beta-note { margin-top: 16px; padding: 12px 16px; border-left: 3px solid #C9A227; background: var(--surface); }
.lead { margin-top: 8px; font-size: var(--fs-2); color: var(--ink-2); line-height: 1.55; }
.ways { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); gap: 12px; list-style: none; padding: 0; margin: 20px 0 0; }
.ways a { display: grid; gap: 6px; height: 100%; padding: 14px 16px; color: inherit; text-decoration: none; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.ways a:hover { border-color: var(--ink-2); }
.ways span { font-size: var(--fs-0); color: var(--ink-2); }
.addr { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.addr code, .url code { padding: 3px 8px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-control); word-break: break-all; }
.part { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--rule); }
.part h2 { font-size: var(--fs-3); margin-bottom: 12px; }
.part > * + * { margin-top: 12px; }
.sub { margin-top: 28px; font-size: var(--fs-2); }
.flow { display: grid; gap: 8px; padding-left: 1.4em; margin: 0; }
.vendors { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 28rem), 1fr)); gap: 14px; }
.vendor { display: grid; align-content: start; gap: 12px; min-width: 0; padding: 16px 18px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.vendor h3 { font-size: var(--fs-2); }
.limits { display: grid; gap: 6px; padding-left: 1.2em; margin: 0; }
.rows { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--rule); }
.rows li { display: grid; grid-template-columns: minmax(0, 9rem) minmax(0, 1fr) minmax(0, 1.2fr); gap: 6px 20px; align-items: start; padding: 12px 4px; border-bottom: 1px solid var(--rule); }
.url { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--fs-0); }
.dev { padding: 10px 14px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.dev summary { cursor: pointer; }
.dev ul { margin-top: 10px; }
@media (max-width: 860px) { .rows li { grid-template-columns: 1fr; } }
</style>
