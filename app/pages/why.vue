<script setup lang="ts">
// 처음 보는 사람용: 왜 전처리·변환이 필요한지 장면 6개로. 개념 전체(좌표계 수학 등)는 /concepts
// 그림 좌표(why-data.json): 한국 윤곽 = 2D .fgb 샘플(countries.fgb)의 KOR, 점 = 버스정류장 원본 CSV에서 700행마다 1개 / 서울BIS 40개마다 1개
import data from '~/assets/why-data.json'

useHead({ title: '처음이라면 | 공간 데이터 웹 처리' })

// 화면에 들어오면 한 번 재생. "다시 보기" = key를 바꿔 그림을 새로 그림 → CSS 애니메이션이 처음부터
const runs = reactive<Record<string, number>>({})
const replay = (id: string) => { runs[id] = (runs[id] ?? 0) + 1 }
let io: IntersectionObserver | undefined
onMounted(() => {
  io = new IntersectionObserver(es => {
    for (const e of es) {
      const id = (e.target as HTMLElement).dataset.scene!
      if (e.isIntersecting && !runs[id]) runs[id] = 1
    }
  }, { threshold: 0.4 })
  document.querySelectorAll('[data-scene]').forEach(el => io!.observe(el))
})
onBeforeUnmount(() => io?.disconnect())

// 1. 원본 확장자 → 웹 형식
const formatRows = [['.shp', '.pbf'], ['.las', '.pnts'], ['.ifc', '.glb'], ['.img', '.png']]

// 2. 서울시청: 지도 그림 안 위치, 잘못 읽은 점이 떨어지는 바다
const MAP = { x: 20, y: 10 }
const hall = { x: MAP.x + data.cityHall.x, y: MAP.y + data.cityHall.y }
const sea = { x: 205, y: 228 }

// 3. 실제 정류장 이름과, CP949 그대로를 UTF-8로 읽은 결과 (Python으로 만든 실제 깨짐)
const names = [['광화문', '��ȭ��'], ['서울역버스환승센터', '���￪����ȯ�¼���'], ['세종문화회관', '������ȭȸ��']]

// 5. 서울 정류장 점을 4×4 타일로 나눔. 화면(가운데 2×2)에 든 타일만 차례로 받음
const TW = 50, TH = 42.5
const viewTiles = ['1,1', '2,1', '1,2', '2,2']
const tileDots: Record<string, number[][]> = {}
// SAFETY: why-data.json의 점은 생성 스크립트가 만든 [x, y] 고정 데이터 (JSON import 타입이 number[][]라 원소 존재를 모름)
for (const p of data.seoul) (tileDots[`${Math.min(3, Math.floor(p[0]! / TW))},${Math.min(3, Math.floor(p[1]! / TH))}`] ??= []).push(p)

// 6. 점군: 나무 세 그루 + 땅. 점마다 단계(0 멀리서도, 1 중간, 2 가까이서만). 시드 고정 → 서버·브라우저 같은 그림
function rand(seed: number) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const cloud = (() => {
  const r = rand(7)
  const blobs: [cx: number, cy: number, rx: number, ry: number][] = [[300, 100, 42, 52], [362, 82, 48, 62], [418, 112, 34, 44], [360, 186, 110, 14]]
  const colors = ['#2F5D3A', '#3E7A4A', '#5E8F4F', '#93B07A', '#C9D6BC']
  const pts: { x: number; y: number; c: string; l: number }[] = []
  while (pts.length < 330) {
    // SAFETY: r()는 [0, 1) → 아래 두 첨자는 blobs·colors 길이 안
    const [cx, cy, rx, ry] = blobs[r() < 0.82 ? Math.floor(r() * 3) : 3]!
    const a = r() * 2 * Math.PI, d = Math.sqrt(r())
    // 반올림: 서버(Node)와 브라우저의 sin·cos 끝자리가 달라 하이드레이션 경고가 난다
    pts.push({ x: Math.round((cx + Math.cos(a) * rx * d) * 10) / 10, y: Math.round((cy + Math.sin(a) * ry * d) * 10) / 10, c: colors[Math.floor(r() * colors.length)]!, l: r() < 0.22 ? 0 : r() < 0.45 ? 1 : 2 })
  }
  return pts
})()
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap page">
      <header class="head">
        <p class="eyebrow">처음이라면 · 3분</p>
        <h1>지도 파일이 웹에 뜨기까지</h1>
        <p class="lead">
          공간 데이터 원본은 웹 브라우저에서 그대로 안 보임. 그래서 거치는 두 단계 — 원본을 다듬는 <strong>전처리</strong>, 웹용으로 바꾸는 <strong>변환</strong>.
          왜 필요한지만 그림으로. 숫자는 이 사이트가 실제로 처리한 데이터.
        </p>
      </header>

      <!-- 1. 출발점 -->
      <section class="scene" data-scene="formats" aria-labelledby="s-formats">
        <div class="text">
          <p class="eyebrow">출발점</p>
          <h2 id="s-formats">웹 지도가 바로 그리는 형식은 정해져 있음</h2>
          <p>SHP·LAS·IFC 같은 원본은 GIS·측량·설계 프로그램용. 웹 지도는 그림(PNG·JPEG), JSON, 벡터타일, glTF·3D Tiles 같은 웹 형식을 그림 → 원본은 그대로 못 올림.</p>
          <p class="fact"><b>이 사이트</b> 26개 확장자 모두 웹 형식으로 바꿔 웹 지도 4종으로 확인.</p>
          <button class="btn replay" type="button" @click="replay('formats')">다시 보기</button>
        </div>
        <svg :key="runs.formats" class="fig f1" :class="{ play: runs.formats }" viewBox="0 0 480 220" role="img" aria-label="원본 확장자는 브라우저에 튕겨 나가고, 웹 형식으로 바꾼 파일만 들어가 지도가 됨">
          <text x="51" y="18" class="cap" text-anchor="middle">원본</text>
          <text x="171" y="18" class="cap" text-anchor="middle">웹 형식</text>
          <g class="browser">
            <rect x="262" y="26" width="204" height="184" rx="10" class="frame" />
            <path d="M262 50h204" class="frame" />
            <circle cx="276" cy="38" r="3" /><circle cx="287" cy="38" r="3" /><circle cx="298" cy="38" r="3" />
            <text x="452" y="42" class="cap" text-anchor="end">브라우저</text>
            <g class="screen">
              <rect x="270" y="56" width="188" height="148" rx="4" class="sea" />
              <g transform="translate(318 58) scale(0.58)">
                <path class="land" :d="data.korea" /><ellipse class="land" v-bind="data.jeju" />
                <circle v-for="(p, i) in data.nat" :key="i" :cx="p[0]" :cy="p[1]" r="3.4" class="pt" />
              </g>
            </g>
          </g>
          <g v-for="([raw, web], i) in formatRows" :key="raw" :style="{ '--i': i }">
            <path :d="`M206 ${50 + i * 44}C230 ${50 + i * 44} 236 120 262 120`" pathLength="1" class="wire" />
            <g class="raw">
              <rect x="16" :y="37 + i * 44" width="70" height="26" rx="13" class="tag" />
              <text x="51" :y="54 + i * 44" text-anchor="middle" class="mono">{{ raw }}</text>
            </g>
            <text x="96" :y="55 + i * 44" class="x">✕</text>
            <g class="web">
              <rect x="136" :y="37 + i * 44" width="70" height="26" rx="13" class="tag ok" />
              <text x="171" :y="54 + i * 44" text-anchor="middle" class="mono">{{ web }}</text>
            </g>
          </g>
        </svg>
      </section>

      <!-- 2. 전처리 ① 위치 기준 -->
      <section class="scene" data-scene="crs" aria-labelledby="s-crs">
        <div class="text">
          <p class="eyebrow">전처리 ①</p>
          <h2 id="s-crs">위치를 적는 기준이 파일마다 다름</h2>
          <p>같은 서울시청도 국내 파일은 미터 단위 (198,054, 551,897), 웹 지도는 위도·경도 (37.567, 126.978). 기준을 모르고 읽으면 점이 바다나 지도 밖으로 → 웹 지도 기준으로 다시 적기 (좌표계 변환).</p>
          <p class="fact"><b>이 사이트</b> 서울 상권 SHP: 국내 미터 좌표 → 위도·경도. 도쿄역 3D 건물은 위도·경도 순서를 반대로 읽어 바다 위로 갔던 경우. <NuxtLink to="/concepts#crs">좌표계 자세히</NuxtLink></p>
          <button class="btn replay" type="button" @click="replay('crs')">다시 보기</button>
        </div>
        <svg :key="runs.crs" class="fig f2" :class="{ play: runs.crs }" viewBox="0 0 480 260" role="img" aria-label="미터 좌표를 그대로 읽은 점은 바다로 가고, 위도·경도로 바꾼 점은 서울시청에 놓임">
          <rect x="0" y="0" width="250" height="260" rx="10" class="sea" />
          <g :transform="`translate(${MAP.x} ${MAP.y})`"><path class="land" :d="data.korea" /><ellipse class="land" v-bind="data.jeju" /></g>
          <g :transform="`translate(${hall.x} ${hall.y})`">
            <g class="pin-bad" :style="{ '--dx': `${sea.x - hall.x}px`, '--dy': `${sea.y - hall.y}px` }">
              <path d="M0 0C-2-6-8-9-8-15a8 8 0 1 1 16 0c0 6-6 9-8 15z" class="pin bad" /><circle cy="-15" r="3" fill="#fff" />
            </g>
            <g class="pin-good">
              <path d="M0 0C-2-6-8-9-8-15a8 8 0 1 1 16 0c0 6-6 9-8 15z" class="pin good" /><circle cy="-15" r="3" fill="#fff" />
            </g>
            <text x="12" y="-8" class="cap strong">서울시청</text>
          </g>
          <text :x="sea.x" :y="sea.y + 16" text-anchor="middle" class="cap bad-txt l-bad">✕ 그대로 읽음</text>
          <g class="card-a">
            <rect x="266" y="20" width="204" height="82" rx="10" class="card" />
            <text x="280" y="44" class="cap">국내 파일 · 미터 단위</text>
            <text x="280" y="72" class="num">198,054 · 551,897</text>
            <text x="280" y="92" class="cap">중부원점 기준 동·북 거리</text>
          </g>
          <path d="M368 106v42" pathLength="1" class="wire arrow-ab" />
          <g class="chip-ab"><rect x="378" y="114" width="84" height="24" rx="12" class="tag ok" /><text x="420" y="130" text-anchor="middle" class="cap strong">좌표계 변환</text></g>
          <g class="card-b">
            <rect x="266" y="152" width="204" height="82" rx="10" class="card ok-line" />
            <text x="280" y="176" class="cap">웹 지도 · 위도·경도</text>
            <text x="280" y="204" class="num">37.567 · 126.978</text>
            <text x="280" y="224" class="cap good-txt">✓ 서울시청에 정확히</text>
          </g>
        </svg>
      </section>

      <!-- 3. 전처리 ② 글자 -->
      <section class="scene" data-scene="enc" aria-labelledby="s-enc">
        <div class="text">
          <p class="eyebrow">전처리 ②</p>
          <h2 id="s-enc">한글이 깨짐</h2>
          <p>국내 공공 데이터는 옛 한글 저장 방식(CP949)이 많고 웹은 UTF-8. 그대로 읽으면 이름·주소가 깨진 글자 → 저장 방식 바꾸기.</p>
          <p class="fact"><b>이 사이트</b> 버스정류장 CSV의 첫 단계가 UTF-8 변환. SHP는 파일 내용으로 저장 방식 판별.</p>
          <button class="btn replay" type="button" @click="replay('enc')">다시 보기</button>
        </div>
        <svg :key="runs.enc" class="fig f3" :class="{ play: runs.enc }" viewBox="0 0 480 200" role="img" aria-label="깨진 정류장 이름이 UTF-8로 바꾼 뒤 광화문, 서울역버스환승센터, 세종문화회관으로 보임">
          <rect x="20" y="14" width="440" height="172" rx="10" class="card" />
          <text x="40" y="40" class="cap strong">정류장명</text>
          <g class="chip-raw"><rect x="300" y="24" width="144" height="24" rx="12" class="tag" /><text x="372" y="40" text-anchor="middle" class="cap">CP949 그대로 읽음</text></g>
          <g class="chip-utf"><rect x="300" y="24" width="144" height="24" rx="12" class="tag ok" /><text x="372" y="40" text-anchor="middle" class="cap strong">UTF-8로 바꾼 뒤</text></g>
          <path d="M20 54h440" class="rule" />
          <g v-for="([good, bad], i) in names" :key="good" :style="{ '--i': i }">
            <path v-if="i" :d="`M20 ${54 + i * 44}h440`" class="rule" />
            <text x="40" :y="82 + i * 44" class="row bad-row">{{ bad }}</text>
            <text x="40" :y="82 + i * 44" class="row good-row">{{ good }}</text>
          </g>
          <rect x="20" y="55" width="6" height="130" class="scan" />
        </svg>
      </section>

      <!-- 4. 전처리 ③ 범위·오류 -->
      <section class="scene" data-scene="filter" aria-labelledby="s-filter">
        <div class="text">
          <p class="eyebrow">전처리 ③</p>
          <h2 id="s-filter">필요한 만큼, 잘못된 것 빼고</h2>
          <p>원본은 보통 필요보다 크고 실수도 섞임. 미리 걸러야 지도에 엉뚱한 점·겹친 점이 안 생김.</p>
          <p class="fact"><b>이 사이트</b> 전국 버스정류장 227,065행 → 좌표가 뒤바뀌거나 빈 행 12개, 서울·경기에 같은 번호로 두 번 등록된 서울 정류장 3,844개 확인 → 서울 12,956개만.</p>
          <button class="btn replay" type="button" @click="replay('filter')">다시 보기</button>
        </div>
        <svg :key="runs.filter" class="fig f4" :class="{ play: runs.filter }" viewBox="0 0 480 260" role="img" aria-label="전국 정류장 점 중 잘못된 점을 지우고 서울 정류장만 남김">
          <rect x="0" y="0" width="250" height="260" rx="10" class="sea" />
          <g :transform="`translate(${MAP.x} ${MAP.y})`">
            <path class="land" :d="data.korea" /><ellipse class="land" v-bind="data.jeju" />
            <circle v-for="(p, i) in data.nat" :key="i" :cx="p[0]" :cy="p[1]" r="1.8" class="pt dot" :class="{ keep: p[2] }" :style="{ '--d': `${i * 3}ms` }" />
            <circle :cx="data.cityHall.x" :cy="data.cityHall.y" r="11" pathLength="1" class="ring" />
          </g>
          <g class="baddots">
            <circle cx="214" cy="40" r="3" /><circle cx="226" cy="58" r="3" /><circle cx="208" cy="74" r="3" /><circle cx="230" cy="90" r="3" />
            <text x="220" y="112" text-anchor="middle" class="cap bad-txt">좌표 이상</text>
          </g>
          <g class="c1"><text x="266" y="36" class="cap">전국</text><text x="470" y="36" text-anchor="end" class="num">227,065</text></g>
          <g class="c2"><text x="266" y="62" class="cap bad-txt">좌표 이상 빼기</text><text x="470" y="62" text-anchor="end" class="num bad-txt">−12</text></g>
          <g class="c3"><text x="266" y="88" class="cap">서울만 · 중복 정리</text><text x="470" y="88" text-anchor="end" class="num keep-txt">12,956</text></g>
          <g class="inset">
            <path :d="`M${hall.x + 11} ${hall.y}L266 116`" class="lead-line" />
            <rect x="266" y="108" width="204" height="144" rx="8" class="card" />
            <g transform="translate(284 113) scale(0.82)">
              <circle v-for="(p, i) in data.seoul" :key="i" :cx="p[0]" :cy="p[1]" r="2" class="pt keep" />
            </g>
          </g>
        </svg>
      </section>

      <!-- 5. 변환 ① 타일 -->
      <section class="scene" data-scene="tiles" aria-labelledby="s-tiles">
        <div class="text">
          <p class="eyebrow">변환 ①</p>
          <h2 id="s-tiles">한 번에 다 받기 대신 보이는 조각만</h2>
          <p>다듬은 데이터도 파일 하나면 브라우저가 끝까지 받은 뒤에 그림. 지도 타일: 지도를 바둑판 조각으로 미리 잘라 화면에 든 조각만 받음. 확대하면 그 자리만 더 잘게 → 큰 데이터도 바로.</p>
          <p class="fact"><b>이 사이트</b> 서울 버스정류장: GeoJSON 하나 2.1MB ↔ 벡터타일 조각 495개, 조각 하나 평균 약 7KB.</p>
          <button class="btn replay" type="button" @click="replay('tiles')">다시 보기</button>
        </div>
        <svg :key="runs.tiles" class="fig f5" :class="{ play: runs.tiles }" viewBox="0 0 480 285" role="img" aria-label="파일 하나는 다 받은 뒤 한꺼번에 보이고, 타일은 화면에 든 조각부터 바로 보임">
          <text x="10" y="20" class="cap strong">파일 하나</text>
          <text x="260" y="20" class="cap strong">지도 타일</text>
          <g transform="translate(10 32)">
            <rect width="210" height="176" rx="6" class="sea" />
            <g class="ldots" transform="translate(5 3)"><circle v-for="(p, i) in data.seoul" :key="i" :cx="p[0]" :cy="p[1]" r="2" class="pt keep" /></g>
            <rect y="190" width="210" height="8" rx="4" class="track" />
            <rect y="190" width="210" height="8" rx="4" class="bar" />
            <text y="222" class="cap l-wait">받는 중… 다 받을 때까지 빈 화면</text>
            <text y="222" class="cap l-done">다 받은 뒤 한꺼번에</text>
          </g>
          <g transform="translate(260 32)">
            <rect width="210" height="176" rx="6" class="sea" />
            <g transform="translate(5 3)">
              <g v-for="t in viewTiles" :key="t" class="tile" :style="{ '--i': viewTiles.indexOf(t) }">
                <rect :x="Number(t.split(',')[0]) * TW" :y="Number(t.split(',')[1]) * TH" :width="TW" :height="TH" class="tile-bg" />
                <circle v-for="(p, i) in tileDots[t] ?? []" :key="i" :cx="p[0]" :cy="p[1]" r="2" class="pt keep" />
              </g>
              <path v-for="k in 3" :key="`v${k}`" :d="`M${k * TW} 0v${4 * TH}`" class="grid" />
              <path v-for="k in 3" :key="`h${k}`" :d="`M0 ${k * TH}h${4 * TW}`" class="grid" />
              <g class="sub">
                <path v-for="k in [1.5, 2.5]" :key="`sv${k}`" :d="`M${k * TW} ${TH}v${2 * TH}`" class="grid fine" />
                <path v-for="k in [1.5, 2.5]" :key="`sh${k}`" :d="`M${TW} ${k * TH}h${2 * TW}`" class="grid fine" />
              </g>
              <rect :x="TW" :y="TH" :width="2 * TW" :height="2 * TH" class="viewport" />
            </g>
            <text y="222" class="cap">화면(파란 테두리)에 든 4장부터 바로</text>
            <text y="240" class="cap l-sub">확대 → 그 자리만 더 작은 조각</text>
          </g>
        </svg>
      </section>

      <!-- 6. 변환 ② 3D -->
      <section class="scene" data-scene="lod" aria-labelledby="s-lod">
        <div class="text">
          <p class="eyebrow">변환 ②</p>
          <h2 id="s-lod">3D는 가까운 곳만 촘촘히</h2>
          <p>점군·3D 건물은 훨씬 큼. 3D Tiles: 멀리서는 성긴 조각만, 다가가면 그 부분의 촘촘한 조각을 더 받음 → 수억 점도 웹에서.</p>
          <p class="fact"><b>이 사이트</b> 치악산 둘레길 한 구간 LAS 675,472점 → 3D Tiles 조각 91개.</p>
          <button class="btn replay" type="button" @click="replay('lod')">다시 보기</button>
        </div>
        <svg :key="runs.lod" class="fig f6" :class="{ play: runs.lod }" viewBox="0 0 480 230" role="img" aria-label="카메라가 다가갈수록 점군이 촘촘해짐">
          <rect x="0" y="0" width="480" height="230" rx="10" class="sea" />
          <g class="boxes1"><rect x="246" y="26" width="104" height="180" class="box" /><rect x="350" y="26" width="112" height="180" class="box" /></g>
          <g class="boxes2"><rect x="246" y="26" width="104" height="90" class="box" /><rect x="350" y="26" width="112" height="90" class="box" /></g>
          <circle v-for="(p, i) in cloud" :key="i" :cx="p.x" :cy="p.y" r="2" :fill="p.c" :class="`lv${p.l}`" :style="{ '--d': `${(i % 40) * 12}ms` }" />
          <g transform="translate(26 112)">
            <g class="cam">
              <path d="M0-12h26a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H0a3 3 0 0 1-3-3V-9a3 3 0 0 1 3-3zM29-3l12-7v20l-12-7z" class="camera" />
              <text x="14" y="34" text-anchor="middle" class="cap l-far">멀리</text>
              <text x="14" y="34" text-anchor="middle" class="cap l-near">가까이</text>
            </g>
          </g>
          <text x="16" y="220" class="cap">점선 = 3D Tiles 조각 · 다가갈수록 작은 조각을 더 받음</text>
        </svg>
      </section>

      <!-- 정리 -->
      <section class="recap" aria-labelledby="s-recap">
        <h2 id="s-recap">정리 — 네 단계</h2>
        <ol class="steps">
          <li><b>수집</b><span>공개된 원본 받기. 이 사이트는 확장자마다 실제 기관 원본.</span></li>
          <li><b>전처리</b><span>위치 기준·글자 맞추기, 필요한 범위만, 잘못된 값 빼기.</span></li>
          <li><b>웹 형태 변환</b><span>웹이 읽는 형식으로, 보이는 만큼만 받는 조각으로.</span></li>
          <li><b>시각화·렌더링</b><span>웹 지도 라이브러리(OpenLayers·MapLibre·Deck.gl·CesiumJS)와 엔진으로 그리기.</span></li>
        </ol>
        <p class="more">
          실제 과정 보기: <NuxtLink to="/attribute/csv">서울 버스정류장 CSV</NuxtLink> · <NuxtLink to="/pointcloud/las">치악산 점군</NuxtLink> ·
          <NuxtLink to="/">전체 노선도</NuxtLink> · <NuxtLink to="/concepts">용어 풀이</NuxtLink>
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page { padding-top: 40px; padding-bottom: 24px; }
.head { max-width: 46rem; }
.eyebrow { font-size: var(--fs-0); font-weight: 600; color: var(--ink-2); letter-spacing: 0.02em; }
.head h1 { margin-top: 4px; font-size: var(--fs-5); }
.lead { margin-top: 12px; font-size: var(--fs-2); line-height: 1.6; color: var(--ink-2); }

.scene { display: grid; grid-template-columns: minmax(0, 22rem) minmax(0, 1fr); gap: 24px 48px; align-items: center; margin-top: 56px; padding-top: 40px; border-top: 1px solid var(--rule); }
.text { display: grid; gap: 10px; justify-items: start; }
.text h2 { font-size: var(--fs-3); }
.fact { font-size: var(--fs-0); color: var(--ink-2); padding: 8px 12px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-tile); }
.fact b { color: var(--ink); margin-right: 6px; }
.replay { font-size: var(--fs-0); }
@media (max-width: 860px) { .scene { grid-template-columns: minmax(0, 1fr); } }

/* 그림 공통 */
.fig { width: 100%; height: auto; overflow: visible; font-family: var(--font); }
.cap { font-size: 11px; fill: var(--ink-2); }
.strong { font-weight: 600; fill: var(--ink); }
.mono { font-family: var(--mono); font-size: 12px; fill: var(--ink); }
.num { font-family: var(--mono); font-size: 17px; font-weight: 500; fill: var(--ink); }
.sea { fill: #E3ECF2; }
.land { fill: #FBFAF6; stroke: #B9C3CC; stroke-width: 1; }
.pt { fill: #B4367E; opacity: 0.75; }
.pt.keep { opacity: 0.9; }
.card { fill: var(--surface); stroke: var(--rule); }
.ok-line { stroke: var(--ok); }
.tag { fill: var(--surface); stroke: var(--rule); }
.tag.ok { fill: #E7F3EC; stroke: var(--ok); }
.frame { fill: var(--surface); stroke: var(--ink-2); }
.browser circle { fill: var(--rule); }
.wire { fill: none; stroke: var(--ok); stroke-width: 1.4; stroke-dasharray: 1; stroke-dashoffset: 1; }
.rule { stroke: var(--rule); }
.bad-txt { fill: #C8323C; }
.good-txt, .keep-txt { fill: var(--ok); }
.pin.bad { fill: #C8323C; }
.pin.good { fill: var(--ok); }

/* 재생 전 상태 */
.f1 .x, .f1 .web, .f1 .screen,
.f2 .pin-good, .f2 .l-bad, .f2 .card-b, .f2 .chip-ab,
.f3 .good-row, .f3 .chip-utf, .f3 .scan,
.f4 .dot, .f4 .baddots, .f4 .c2, .f4 .c3, .f4 .inset, .f4 .ring,
.f5 .ldots, .f5 .bar, .f5 .tile, .f5 .sub, .f5 .l-done, .f5 .l-sub,
.f6 .lv1, .f6 .lv2, .f6 .boxes1, .f6 .boxes2, .f6 .l-near { opacity: 0; }
.f2 .pin-bad path { fill: var(--ink-2); }
.f4 .ring { fill: none; stroke: var(--ok); stroke-width: 1.6; stroke-dasharray: 1; stroke-dashoffset: 1; }
.lead-line { fill: none; stroke: var(--ok); stroke-dasharray: 3 3; }
.f5 .track { fill: var(--rule); }
/* CSS로 크기를 바꾸는 요소만 기준점 지정 (SVG transform 속성이 있는 g에 주면 그 속성의 기준점까지 바뀜) */
.f5 .bar { fill: var(--link); transform-box: fill-box; transform-origin: left center; transform: scaleX(0); }
.f6 .cam { transform-box: fill-box; transform-origin: center; }
.f5 .tile-bg { fill: #F4F7FA; }
.f5 .grid { stroke: #B9C3CC; stroke-width: 1; }
.f5 .grid.fine { stroke-dasharray: 2 2; }
.f5 .viewport { fill: none; stroke: var(--link); stroke-width: 2.5; }
.f6 .box { fill: none; stroke: #7448C9; stroke-dasharray: 4 3; stroke-width: 1.2; }
.f6 .camera { fill: var(--ink); }
.row { font-size: 16px; fill: var(--ink); }
.bad-row { fill: #C8323C; font-family: var(--mono); }
.scan { fill: var(--link); }

/* 재생 */
.play .raw { animation: f1-bounce 1.3s ease-in-out both; animation-delay: calc(var(--i) * 0.15s); }
@keyframes f1-bounce { 0% { transform: none; } 45% { transform: translateX(168px); } 58% { transform: translateX(150px); } 100% { transform: none; opacity: 0.4; } }
.play .x { animation: show 0.3s both; animation-delay: calc(1s + var(--i) * 0.15s); fill: #C8323C; font-size: 13px; }
.play .web { animation: f1-web 0.6s ease-out both; animation-delay: calc(1.6s + var(--i) * 0.15s); }
@keyframes f1-web { from { opacity: 0; transform: translateX(-120px); } to { opacity: 1; transform: none; } }
.play .wire { animation: draw 0.6s ease-out both; animation-delay: calc(2.4s + var(--i, 0) * 0.1s); }
.play .screen { animation: show 0.7s both 3s; }

.play .pin-bad { animation: f2-fly 1.4s ease-in-out both 0.9s, half 0.4s forwards 3.8s; }
@keyframes half { to { opacity: 0.5; } }
@keyframes f2-fly { 0% { transform: none; } 50% { transform: translate(calc(var(--dx) * 0.55), calc(var(--dy) * 0.3 - 40px)); } 100% { transform: translate(var(--dx), var(--dy)); } }
.play .pin-bad path { animation: to-bad 0.3s forwards 0.9s; }
@keyframes to-bad { to { fill: #C8323C; } }
.play .l-bad { animation: show 0.3s both 2.3s; }
.play .arrow-ab { animation: draw 0.5s both 2.6s; }
.play .chip-ab { animation: show 0.3s both 2.8s; }
.play .card-b { animation: show 0.4s both 3.1s; }
.play .pin-good { animation: drop 0.5s cubic-bezier(.3, 1.6, .6, 1) both 3.5s; }
@keyframes drop { from { opacity: 0; transform: translateY(-30px); } to { opacity: 1; transform: none; } }

.play .chip-raw { animation: hide 0.3s forwards 1.9s; }
.play .chip-utf { animation: show 0.3s both 1.9s; }
.play .scan { animation: f3-scan 1.1s ease-in-out both 1.1s; }
@keyframes f3-scan { 0% { opacity: 0; transform: none; } 10% { opacity: 0.5; } 90% { opacity: 0.5; } 100% { opacity: 0; transform: translateX(430px); } }
.play .bad-row { animation: hide 0.3s forwards; animation-delay: calc(1.4s + var(--i) * 0.25s); }
.play .good-row { animation: show 0.3s both; animation-delay: calc(1.5s + var(--i) * 0.25s); }

.play .dot { animation: show 0.25s both var(--d), dim 0.6s forwards 2.6s; }
.play .dot.keep { animation: show 0.25s both var(--d); }
.play .baddots { animation: show 0.3s both 0.6s, f4-blink 0.9s forwards 1.5s; }
.baddots circle { fill: #C8323C; }
@keyframes f4-blink { 0%, 60% { opacity: 1; } 30% { opacity: 0.2; } 100% { opacity: 0; } }
.play .c1 { animation: show 0.3s both 0.2s; }
.play .c2 { animation: show 0.3s both 1.6s; }
.play .c3 { animation: show 0.3s both 2.7s; }
.play .ring { animation: show 0.1s both 2.6s, draw 0.6s both 2.6s; }
.play .inset { animation: show 0.6s both 3.2s; }

.play .bar { animation: show 0.1s both, f5-load 3.2s linear both; }
@keyframes f5-load { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.play .ldots, .play .l-done { animation: show 0.3s both 3.3s; }
.play .l-wait { animation: hide 0.2s forwards 3.3s; }
.play .tile { animation: show 0.25s both; animation-delay: calc(0.3s + var(--i) * 0.2s); }
.play .sub, .play .l-sub { animation: show 0.4s both 2s; }

.play .cam { animation: f6-near 3s ease-in-out both 0.3s; }
@keyframes f6-near { from { transform: none; } to { transform: translateX(150px) scale(1.15); } }
.play .l-far { animation: hide 0.3s forwards 2.6s; }
.play .l-near { animation: show 0.3s both 2.6s; }
.play .lv1 { animation: show 0.3s both calc(1.3s + var(--d)); }
.play .lv2 { animation: show 0.3s both calc(2.3s + var(--d)); }
.play .boxes1 { animation: show 0.3s both 1.2s; }
.play .boxes2 { animation: show 0.3s both 2.2s; }

@keyframes show { from { opacity: 0; } to { opacity: 1; } }
@keyframes hide { to { opacity: 0; } }
@keyframes dim { to { opacity: 0.15; } }
@keyframes draw { to { stroke-dashoffset: 0; } }

/* 움직임 줄이기: 끝 장면만 */
@media (prefers-reduced-motion: reduce) {
  .fig, .fig * { animation-duration: 1ms !important; animation-delay: 0s !important; }
}

.recap { margin-top: 64px; padding-top: 40px; border-top: 1px solid var(--rule); }
.recap h2 { font-size: var(--fs-3); }
.steps { list-style: none; counter-reset: s; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 12px; padding: 0; margin: 16px 0 0; }
.steps li { counter-increment: s; display: grid; gap: 4px; padding: 14px 16px; background: var(--surface); border: 1px solid var(--rule); border-radius: var(--r-panel); }
.steps li::before { content: counter(s); width: 22px; height: 22px; display: grid; place-items: center; border: 1px solid var(--ink-2); border-radius: 50%; font-size: 12px; }
.steps span { font-size: var(--fs-0); color: var(--ink-2); }
.more { margin-top: 16px; font-size: var(--fs-0); }
</style>
