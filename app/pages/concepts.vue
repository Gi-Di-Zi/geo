<script setup lang="ts">
import { terms } from '#shared/catalog/terms'

const label = (id: string) => terms.find(t => t.id === id)!.label
useHead({ title: '개념 | 공간 데이터 웹 처리' })
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <h1>기본 개념</h1>
      <p class="prose lead">확장자 페이지의 점선 밑줄 용어 풀이. 필요한 항목만 골라 읽기.</p>
      <nav class="toc small" aria-label="개념 목록">
        <a v-for="t in terms" :key="t.id" :href="`#${t.id}`" class="chip">{{ t.label }}</a>
      </nav>

      <section id="crs" class="concept">
        <h2>{{ label('crs') }}</h2>
        <div class="prose">
          <p>같은 서울시청의 좌표계별 숫자. 위경도(EPSG:4326): (126.978, 37.567), 웹 지도 메르카토르(EPSG:3857): (14,135,123, 4,518,382)m, 국내 중부원점(EPSG:5186): (198,054, 551,897)m.</p>
          <p>웹 지도 타일은 거의 모두 EPSG:3857 격자 → 국내 좌표계 SHP·GeoTIFF는 전처리에서 좌표계 변환. GeoJSON 표준(RFC 7946)은 위경도만 허용.</p>
          <p>축 순서 함정: EPSG:4326, EPSG:6697 등은 표준상 위도 먼저 → 도구별 경도·위도 순서 확인 필요. 잘못 읽으면 위치가 바다·지구 반대편으로 이동.</p>
        </div>
      </section>

      <section id="tiles" class="concept">
        <h2>{{ label('tiles') }}</h2>
        <div class="split">
          <div class="prose">
            <p>줌 0: 지구 전체가 256px 그림 한 장. 줌 1단계마다 가로·세로 2분할 → 줌 z에 2<sup>z</sup> × 2<sup>z</sup>장. 각 조각 주소: <code>z/x/y</code>.</p>
            <p>미리 잘라 두면 서버 없이 파일만으로 빠른 표시, 대신 파일 수 급증. 서울 일대 줌 14까지만 해도 수백~수천 장 → 샘플은 범위·줌 최소화.</p>
          </div>
          <svg class="fig" viewBox="0 0 360 150" role="img" aria-label="줌 0은 1장, 줌 1은 4장, 줌 2는 16장으로 쪼개지는 타일 피라미드">
            <g v-for="(z, i) in [0, 1, 2]" :key="z" :transform="`translate(${i * 120 + 10}, 10)`">
              <rect v-for="k in 4 ** z" :key="k" :x="((k - 1) % 2 ** z) * (96 / 2 ** z)" :y="Math.floor((k - 1) / 2 ** z) * (96 / 2 ** z)" :width="96 / 2 ** z" :height="96 / 2 ** z" class="cell" />
              <text x="48" y="120" text-anchor="middle">줌 {{ z }}: {{ 4 ** z }}장</text>
            </g>
          </svg>
        </div>
      </section>

      <section id="vector-tiles" class="concept">
        <h2>{{ label('vector-tiles') }}</h2>
        <div class="prose">
          <p>GeoJSON: 도형 전부를 글자(JSON)로 담은 파일 하나. 열어 보기 쉽고 단순, 대신 대용량이면 첫 전체 다운로드 부담.</p>
          <p>MVT: 도형을 타일 한 장 크기로 자르고, 좌표를 타일 안 정수(보통 0~4096)로 줄여 이진(protobuf)으로 저장. 보이는 타일만 요청 → 대용량도 가볍게 표시. 그림이 아닌 도형 → 색·두께는 브라우저가 결정.</p>
          <p>단점: 타일 경계에서 도형 잘림, 낮은 줌에서 작은 도형 제외. 원본 그대로가 필요하면 GeoJSON, 빠른 표시가 우선이면 벡터타일.</p>
        </div>
      </section>

      <section id="fidelity" class="concept">
        <h2>{{ label('fidelity') }}</h2>
        <div class="prose">
          <p>웹 결과물 = 화면에 빨리 그리기 위한 사본. 원본과 달라지는 지점:</p>
          <ul>
            <li>MVT 좌표: 타일 한 장을 4096 × 4096 정수 격자로 반올림 → 서울 위도에서 줌 11은 약 3.8 m, 줌 16은 약 0.12 m 단위.</li>
            <li>타일 경계: 도형이 타일마다 잘려 한 피처가 여러 조각. 면적·길이 계산은 조각이 아닌 원본으로.</li>
            <li>작은 도형·밀집 피처: PostGIS <code>ST_AsMVTGeom</code>은 타일 좌표로 바꾸는 중 도형이 낮은 차원으로 줄거나 사라질 수 있음. tippecanoe <code>--drop-densest-as-needed</code>는 타일 크기 한도를 넘으면 밀집 피처부터 제거.</li>
            <li>GeoJSON 좌표 7자리 ≈ 1 cm. GeoServer WFS 기본 4자리 ≈ 11 m → 이 사이트는 7자리로 지정.</li>
            <li>WMS·WMTS: 서버가 그린 그림 → 화면에서 속성·좌표 직접 조회 불가.</li>
          </ul>
          <p>이 사이트의 구분: 화면 표시 = MVT·PMTiles·WMS·WMTS. 조회·계산 = 전체 속성을 둔 PostGIS 표(서버 레시피, 2D SHP는 원본 좌표계 EPSG:5181 그대로), WFS·GeoJSON(전체 속성, 좌표 7자리).</p>
          <p>확인 방법: 벡터타일 레시피마다 "무결성 확인 (타일 전후 피처 수)" 단계 — 줌별로 남은 피처 수를 변환 전과 비교. 서버 출력은 확인 요청의 응답 크기·피처 수·시간 기록. 래스터·지형·점군은 아직 입력·형식 검사만, 변환 전후 값 비교 없음.</p>
        </div>
      </section>

      <section id="range" class="concept">
        <h2>{{ label('range') }}</h2>
        <div class="split">
          <div class="prose">
            <p>브라우저가 <code>Range: bytes=0-16383</code>처럼 파일 일부만 요청 → 서버는 그 부분만 <code>206 Partial Content</code>로 응답. 정적 파일 서버 대부분 기본 지원.</p>
            <p>COG, PMTiles, FlatGeobuf: 파일 앞에 "어디에 무엇이 있는지" 목차 → 목차 먼저, 필요한 조각만 Range로 요청. 타일 서버 없이 파일 하나로 웹 지도 가능.</p>
          </div>
          <svg class="fig" viewBox="0 0 360 110" role="img" aria-label="파일 앞의 목차를 먼저 받고, 필요한 블록 두 개만 골라 받는 Range 요청">
            <rect x="10" y="30" width="56" height="34" class="hl" />
            <text x="38" y="52" text-anchor="middle" class="on">목차</text>
            <rect v-for="k in 8" :key="k" :x="66 + (k - 1) * 36" y="30" width="36" height="34" :class="k === 3 || k === 4 ? 'hl' : 'cell'" />
            <text x="10" y="20">파일 하나</text>
            <text x="10" y="90">① 목차 받기</text>
            <text x="160" y="90">② 화면에 필요한 블록만 받기</text>
          </svg>
        </div>
      </section>

      <section id="cog" class="concept">
        <h2>{{ label('cog') }}</h2>
        <div class="prose">
          <p>일반 GeoTIFF: 한 줄씩(스트립) 저장, 축소본 없음 → 화면 일부만 보려 해도 앞에서부터 읽기. COG(Cloud Optimized GeoTIFF): 같은 GeoTIFF를 512×512 등 블록으로 분할, 1/2·1/4 축소본(오버뷰) 추가, 목차를 맨 앞에 배치.</p>
          <p>OpenLayers는 COG 직접 읽기. 다른 뷰어는 XYZ 타일로 미리 굽기, 실서버라면 TiTiler 같은 서버가 요청마다 분할.</p>
        </div>
      </section>

      <section id="pmtiles" class="concept">
        <h2>{{ label('pmtiles') }}</h2>
        <div class="prose">
          <p>타일 수천 장을 파일 하나로 묶은 형식. 구성: 127바이트 헤더 → 타일 목차 → 타일 데이터. 비슷한 MBTiles(SQLite 파일)는 서버 필요, PMTiles는 Range 요청만으로 브라우저가 직접 읽기.</p>
          <p>파일 하나 → 업로드·이동 간편, 타일 파일 수만 장 관리 불필요.</p>
        </div>
      </section>

      <section id="ogc-api" class="concept">
        <h2>{{ label('ogc-api') }}</h2>
        <div class="prose">
          <p>도형 데이터를 <code>/collections</code>(목록), <code>/collections/{id}</code>(설명), <code>/collections/{id}/items</code>(GeoJSON 도형)처럼 정해진 주소로 주고받는 웹 표준. WFS의 후속.</p>
          <p>WFS와 차이: XML 요청·GetCapabilities 대신 REST 주소, 응답 기본 GeoJSON, 좌표는 항상 경도·위도. 범위(<code>bbox</code>)·개수(<code>limit</code>, 넘치면 <code>next</code> 링크)·조건(<code>filter</code>, CQL2)은 주소 질의로.</p>
          <p>이 사이트: 서버 방식은 GeoServer 확장(ogcapi-features)이 실제 제공 → WMS·WMTS·WFS와 나란히. 파일 방식 GeoJSON은 같은 경로의 정적 파일로 흉내만 (질의 불가).</p>
        </div>
      </section>

      <section id="3d-tiles" class="concept">
        <h2>{{ label('3d-tiles') }}</h2>
        <div class="split">
          <div class="prose">
            <p><code>tileset.json</code>: 공간을 나눈 나무 구조, 각 칸의 범위·오차(geometricError), 칸별 내용 파일 참조. 뷰어는 오차가 화면에서 몇 픽셀인지 계산해 받을 깊이 결정.</p>
            <p>1.0: 내용별로 b3dm(건물·모델), pnts(점군), i3dm(같은 모델 반복). 1.1: glb 하나로 통일, 나무 구조를 규칙으로만 적는 암시적 타일링(subtree) 추가. 이 사이트: mago·py3dtiles는 1.0, pg2b3dm은 1.1.</p>
          </div>
          <svg class="fig" viewBox="0 0 360 150" role="img" aria-label="tileset.json 아래로 범위를 나눈 자식 타일이 이어지는 나무 구조">
            <rect x="140" y="8" width="80" height="26" class="hl" /><text x="180" y="26" text-anchor="middle" class="on">tileset.json</text>
            <g v-for="(x, i) in [60, 220]" :key="i">
              <path :d="`M180 34 L${x + 40} 62`" class="edge" />
              <rect :x="x" y="62" width="80" height="26" class="cell" /><text :x="x + 40" y="80" text-anchor="middle">멀리서 볼 때</text>
              <g v-for="(dx, j) in [-30, 30]" :key="j">
                <path :d="`M${x + 40} 88 L${x + 40 + dx} 112`" class="edge" />
                <rect :x="x + 40 + dx - 26" y="112" width="52" height="24" class="cell" />
              </g>
            </g>
            <text x="10" y="148">가까이 갈수록 아래 칸(자세한 모양) 요청</text>
          </svg>
        </div>
      </section>

      <section id="terrain" class="concept">
        <h2>{{ label('terrain') }}</h2>
        <div class="split">
          <div class="prose">
            <p>그림 타일에는 실수 높이 값 저장 불가 → Terrain-RGB는 높이를 0.1m 단위 정수로 바꿔 R·G·B 세 바이트에 분배. 높이 = -10000 + (R×65536 + G×256 + B) × 0.1. MapLibre·Deck.gl이 이 PNG 타일로 지형 표시.</p>
            <p>quantized-mesh: 높이를 삼각형 메시로 담은 Cesium용 형식. 평평한 곳은 큰 삼각형, 험한 곳은 작은 삼각형 → 작은 용량. 위경도 격자(TMS) 분할.</p>
          </div>
          <svg class="fig" viewBox="0 0 360 110" role="img" aria-label="색 (1, 134, 160)은 높이 0m, 색 (1, 144, 220)은 남산 높이 262m">
            <rect x="10" y="14" width="40" height="40" fill="rgb(1,134,160)" /><text x="62" y="30">R 1, G 134, B 160</text><text x="62" y="48" class="strong">→ 0m (해수면)</text>
            <rect x="10" y="62" width="40" height="40" fill="rgb(1,144,220)" /><text x="62" y="78">R 1, G 144, B 220</text><text x="62" y="96" class="strong">→ 262m (남산 정상)</text>
          </svg>
        </div>
      </section>

      <section id="lod" class="concept">
        <h2>{{ label('lod') }}</h2>
        <div class="prose">
          <p>3D Tiles의 LOD: "멀리서는 단순하게"라는 화면용 단계. 같은 건물을 거리별로 다르게 요청.</p>
          <p>CityGML의 LOD: 데이터 제작 상세도. LOD0 바닥면, LOD1 상자 모양, LOD2 지붕 모양까지, LOD3 창문·문까지, LOD4 실내까지. 같은 이름, 다른 의미.</p>
        </div>
      </section>

      <section id="gltf" class="concept">
        <h2>{{ label('gltf') }}</h2>
        <div class="prose">
          <p>"3D의 JPEG"이라 불리는 웹용 3D 모델 표준. .gltf: 사람이 읽는 JSON + 외부 파일(.bin, 텍스처), .glb: 파일 하나로 묶은 이진 형태. meshopt·Draco 형상 압축 가능.</p>
          <p>glTF에는 지도 위 위치 없음 → 세울 경위도(이 사이트: 서울광장, 도쿄역 등) 별도 지정, 또는 위치를 담은 3D Tiles로 감싸기. 위쪽 축이 Y → Z가 위인 GIS 도구와 만나면 90° 회전이 흔한 작업.</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; }
.lead { margin-top: 8px; font-size: var(--fs-2); color: var(--ink-2); line-height: 1.55; }
.toc { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.toc a { text-decoration: none; color: var(--ink); }
.concept { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--rule); }
.concept h2 { font-size: var(--fs-3); margin-bottom: 12px; }
.concept p + p { margin-top: 10px; }
.split { display: grid; grid-template-columns: minmax(0, 40rem) minmax(0, 360px); gap: 32px; align-items: start; }
.fig { width: 100%; max-width: 360px; height: auto; font-size: 12px; }
.fig text { fill: var(--ink-2); }
.fig text.on { fill: #fff; }
.fig text.strong { fill: var(--ink); font-weight: 600; }
.fig .cell { fill: var(--surface); stroke: var(--ink-2); stroke-width: 1; }
.fig .hl { fill: var(--ink); stroke: var(--ink); }
.fig .edge { stroke: var(--ink-2); fill: none; }
@media (max-width: 900px) {
  .split { grid-template-columns: 1fr; }
}
</style>
