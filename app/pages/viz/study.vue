<script setup lang="ts">
const query = ref('')
const category = ref('')

const visible = computed(() => formats.filter(format => {
  const text = [format.name, ...format.extensions, format.summary, format.description].join(' ').toLocaleLowerCase()

  return (!category.value || format.category === category.value) && text.includes(query.value.trim().toLocaleLowerCase())
}))

const visibleTools = computed(() => tools.filter(tool => [tool.name, tool.summary, tool.description, tool.io].join(' ').toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))

useSeoMeta({
  title: '확장자·변환 도구 학습 노트 | geo',
  description: '공간 데이터 확장자의 구조와 변환 도구, DEM·DSM, 타원체·투영 좌표계와 면접 질문을 한 페이지에서 비교합니다.',
})
</script>

<template>
  <div>
    <FlowSteps />
    <div class="wrap study">
      <header>
        <p class="muted">공간 데이터 · 학습 노트</p>
        <h1>확장자에서 웹 지도까지</h1>
        <p class="lead">무엇을 담는 파일인지, 왜 변환하는지, 어떤 도구를 고를지 한곳에서 비교하세요. 면접에서는 이름보다 선택 이유와 정보 손실을 함께 설명해 보세요.</p>
        <nav class="jump" aria-label="학습 목차">
          <a href="#formats">확장자 비교</a><a href="#tools">변환 도구</a><a href="#dem-dsm">DEM·DSM</a><a href="#ellipsoidal-projected">좌표계·높이 기준</a><a href="#questions">선택 이유 복습</a><a href="#interview">면접 답변 복습</a>
          <NuxtLink to="/viz/concepts">기본 개념 더 보기 →</NuxtLink>
        </nav>
      </header>

      <section aria-labelledby="reading">
        <h2 id="reading">먼저 구분할 네 가지</h2>
        <ol class="principles">
          <li><b>내용</b> — 벡터는 도형과 속성, 래스터는 격자 값, 점군은 측정점, 모델은 표면과 구조를 담습니다.</li>
          <li><b>좌표</b> — 같은 .tif도 영상과 표고가 다릅니다. 확장자만으로 좌표계·축 순서·높이 기준을 정하지 마세요.</li>
          <li><b>전달</b> — 작은 원본은 그대로 읽고, 큰 데이터는 타일·공간 인덱스로 필요한 부분만 요청합니다.</li>
          <li><b>보존</b> — 화면이 비슷해도 속성·정밀도·위상·BIM 의미가 같다는 뜻은 아닙니다. 원본과 결과를 따로 검증합니다.</li>
        </ol>
      </section>

      <section id="formats" aria-labelledby="formats-title">
        <h2 id="formats-title">확장자별 특징과 변환 경로</h2>
        <p class="muted">기존 샘플 카탈로그의 모든 포맷을 유형별로 모았습니다. 아래 경로는 등록된 레시피이며 현재 서버에서 실행 성공했다는 표시는 아닙니다.</p>
        <div class="filters">
          <label>확장자·도구·특징 검색<input v-model="query" type="search" placeholder="예: .tif, 점군, 좌표계"></label>
          <label>데이터 유형<select v-model="category"><option value="">모든 유형</option><option v-for="item in categories" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        </div>
        <p role="status">{{ visible.length }} / {{ formats.length }}개 포맷</p>
        <p v-if="!visible.length">일치하는 포맷이 없습니다. 검색어나 유형을 바꿔 보세요.</p>
        <template v-for="group in categories" :key="group.id">
          <section v-if="visible.some(format => format.category === group.id)" :aria-labelledby="`group-${group.id}`">
            <h3 :id="`group-${group.id}`">{{ group.name }}</h3>
            <p class="muted">{{ group.summary }}</p>
            <article v-for="format in visible.filter(item => item.category === group.id)" :id="`format-${format.category}-${format.id}`" :key="format.id" class="format">
              <h4>{{ format.name }} <code>{{ format.extensions.join(' · ') }}</code></h4>
              <p><b>{{ format.summary }}</b></p><p>{{ format.description }}</p>
              <dl v-if="format.anatomy?.length" class="anatomy"><template v-for="part in format.anatomy" :key="part.name"><dt>{{ part.name }}</dt><dd>{{ part.role }}</dd></template></dl>
              <p v-if="format.closed" class="notice">샘플 미확보: {{ format.closed }}</p>
              <div v-if="format.recipes.length" class="table-scroll" tabindex="0" :aria-label="`${format.name} 변환 경로 표`">
                <table>
                  <caption>{{ format.name }}의 레시피별 도구와 결과</caption>
                  <thead><tr><th scope="col">방식</th><th scope="col">전처리 → 변환 도구</th><th scope="col">결과·선택 이유</th></tr></thead>
                  <tbody><tr v-for="recipe in format.recipes" :key="recipe.id">
                    <th scope="row">{{ recipe.title }}</th>
                    <td><span v-for="(step, index) in [...recipe.preprocess, ...recipe.convert]" :key="index"><span v-if="index"> → </span><a :href="`#tool-${step.tool}`" :title="step.why">{{ toolOf(step.tool)?.name ?? step.tool }}</a></span></td>
                    <td><p v-for="output in recipe.outputs" :key="output.id"><b>{{ output.label }}</b> — {{ output.why }}</p></td>
                  </tr></tbody>
                </table>
              </div>
              <p v-for="alternative in format.alternatives" :key="alternative.tool" class="small">대안: <a :href="`#tool-${alternative.tool}`">{{ toolOf(alternative.tool)?.name ?? alternative.tool }}</a> — {{ alternative.note }}</p>
              <NuxtLink v-if="!format.closed" :to="stepPath(format, 'collect')">샘플·처리 명령·뷰어 비교 →</NuxtLink>
            </article>
          </section>
        </template>
      </section>

      <section id="tools" aria-labelledby="tools-title">
        <h2 id="tools-title">변환 도구와 역할 ({{ visibleTools.length }})</h2>
        <p v-if="!visibleTools.length" role="status">일치하는 도구가 없습니다. 검색어를 바꿔 보세요.</p>
        <p class="muted">범용 엔진, 타일 생성기, 모델 변환기, 서빙 도구를 구분해서 읽으세요. 버전·지원 범위는 프로젝트 카탈로그 기준이며 최신 버전이나 설치 상태를 보장하지 않습니다.</p>
        <section v-for="group in toolTypes" :key="group.id">
          <h3>{{ group.name }}</h3><p>{{ group.summary }}</p>
          <div class="tool-grid">
            <article v-for="tool in visibleTools.filter(item => item.type === group.id)" :id="`tool-${tool.id}`" :key="tool.id" class="tool">
              <h4>{{ tool.name }}</h4><p><b>{{ tool.summary }}</b></p><p>{{ tool.description }}</p>
              <dl><dt>입력 → 출력</dt><dd>{{ tool.io }}</dd><dt>카탈로그 버전 · 라이선스</dt><dd>{{ tool.version }} · {{ tool.license }}</dd></dl>
              <p v-if="tool.status !== 'active'" class="notice">카탈로그 유지보수 상태: {{ tool.status === 'stale' ? '오래된 도구' : '중단된 도구' }}</p>
              <details><summary>명령 예시 보기</summary><pre><code>{{ tool.example }}</code></pre><p class="small">학습용 예시입니다. 입력 경로·좌표계·옵션을 실제 데이터에 맞춰 검증하세요.</p></details>
              <p class="jump"><a :href="tool.url" target="_blank" rel="noopener noreferrer">공식 자료 ↗</a><NuxtLink :to="`/viz/tools/${tool.id}`">도구 상세 →</NuxtLink></p>
            </article>
          </div>
        </section>
      </section>

      <StudyConcepts />

      <section id="questions" aria-labelledby="questions-title">
        <h2 id="questions-title">선택 이유를 비교하는 면접 질문</h2>
        <p>답을 열기 전에 “데이터 특성 → 선택 → 대가 → 검증” 순서로 30초 동안 설명해 보세요.</p>
        <details><summary>GeoJSON, MVT, PMTiles는 어떻게 다른가요?</summary><p>GeoJSON은 피처와 속성을 JSON으로 표현합니다. MVT는 도형을 타일로 잘라 전달하는 인코딩이며, PMTiles는 타일을 한 파일에 담는 아카이브입니다. MVT와 PMTiles는 대체 개념이 아니며 MVT 타일을 PMTiles에 담을 수 있습니다. 타일화 때 잘림·단순화·속성 제외가 있는지 확인합니다.</p><a href="https://docs.protomaps.com/pmtiles/">PMTiles 공식 문서</a> · <a href="https://www.rfc-editor.org/rfc/rfc7946">GeoJSON RFC 7946</a></details>
        <details><summary>GeoTIFF가 있는데 왜 COG를 만드나요?</summary><p>COG는 GeoTIFF 내부 배치를 타일·오버뷰와 부분 읽기에 맞춥니다. 서버의 HTTP Range 지원과 클라이언트의 부분 읽기를 함께 확인해야 합니다. 파일 이름만 .tif로 바꾸어서는 COG가 되지 않습니다. 영상과 DEM은 같은 확장자여도 밴드 의미·NoData·보간 방법이 다릅니다.</p><a href="https://gdal.org/en/stable/drivers/raster/cog.html">GDAL COG 공식 문서</a></details>
        <details><summary>GDAL과 PDAL은 언제 선택하나요?</summary><p>이 프로젝트에서는 벡터·래스터 변환은 GDAL/OGR, 점군의 읽기·필터·좌표 변환은 PDAL로 구분합니다. 웹 3D 타일이 필요하면 별도 타일러의 입력·출력 계약을 확인합니다. 도구 이름만으로 모든 포맷의 쓰기 지원을 가정하지 않습니다.</p></details>
        <details><summary>높이가 있는 SHP와 실제 3D 모델은 같은가요?</summary><p>건물 바닥면에 높이 속성을 적용한 돌출 표현은 벽·지붕·내부 구조를 모두 가진 모델과 다릅니다. 요구가 대략적인 도시 규모 표현인지 정밀한 형상인지 먼저 확인하고, 속성 단위와 높이 기준도 검사합니다.</p></details>
        <details><summary>IFC를 GLB로 바꾸면 BIM 정보가 모두 보존되나요?</summary><p>렌더링 가능한 메시를 얻는 것과 벽·층·관계·속성 같은 BIM 의미를 보존하는 것은 별개입니다. 변환기 옵션과 결과 속성 구조를 검사하고, 의미 정보가 필요하면 원본 IFC와 식별자 연결을 유지합니다.</p></details>
        <details><summary>변환 결과가 지도에서 엉뚱한 위치에 뜬다면?</summary><p>원본 CRS, 축 순서, 좌표 단위, 지정과 재투영의 차이, 모델 원점·배치 변환, 수직 기준을 차례로 확인합니다. 기준점과 결과 범위를 대조하고, 그럴듯한 화면만으로 좌표 정확성을 판정하지 않습니다.</p></details>
        <details><summary>정적 파일과 GeoServer·DB 방식은 어떻게 고르나요?</summary><p>갱신 빈도, 동적 필터·질의, 데이터 크기, 운영 비용을 비교합니다. 정적 타일은 배포·캐시가 단순하지만 변경 시 재생성이 필요합니다. 서버 방식은 질의 유연성이 있는 대신 서비스·권한·DB 운영이 필요합니다. 이 프로젝트의 공개 파일 전용 환경과 서비스 레시피 지원을 구분합니다.</p></details>
        <details><summary>변환 성공은 무엇으로 검증하나요?</summary><p>종료 코드뿐 아니라 결과 파일 구조, 피처·점 개수, 속성·문자 인코딩, 좌표 범위·CRS, 정밀도, 참조 파일 누락, 실제 뷰어 표시를 확인합니다. 손실을 허용했다면 어느 단계에서 어떤 정보가 줄었는지 설명하고 원본을 보존합니다.</p></details>
      </section>

      <StudyReview />
    </div>
  </div>
</template>

<style scoped>
.study { padding-block: 40px; }
.lead { max-width: 70ch; font-size: 1.1rem; }
section { margin-top: 40px; }
.jump { display: flex; flex-wrap: wrap; gap: 12px 24px; margin-block: 20px; }
.principles { padding-left: 24px; display: grid; gap: 12px; }
.filters { display: flex; flex-wrap: wrap; gap: 16px; margin-block: 24px; }
label { display: grid; gap: 6px; }
input, select { padding: 10px; border: 1px solid var(--rule); background: var(--surface); color: var(--ink); border-radius: 6px; max-width: 100%; }
.format, .tool { border: 1px solid var(--rule); padding: 24px; border-radius: 10px; margin-block: 16px; min-width: 0; }
h4 { font-size: 1.15rem; margin-bottom: 12px; }
h4 code { display: inline-block; font-size: .85rem; color: var(--ink-2); }
p { margin-block: 10px; }
dl { margin-block: 16px; }
dt { font-weight: 600; }
dd { margin: 0 0 10px; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; min-width: 600px; }
caption { text-align: left; font-size: .85rem; color: var(--ink-2); padding: 8px 0; }
th, td { padding: 12px; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
.tool-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap: 16px; }
.tool { margin: 0; }
details { padding: 16px 0; border-bottom: 1px solid var(--rule); }
summary { cursor: pointer; font-weight: 600; }
pre { overflow-x: auto; padding: 12px; background: var(--surface); }
.notice { border-left: 3px solid var(--ink-2); padding-left: 12px; }
[id] { scroll-margin-top: 100px; }
@media (max-width: 600px) { .format, .tool { padding: 16px; } .filters, label { width: 100%; } }
@media print { .filters, .jump { display: none; } .tool-grid { display: block; } .table-scroll { overflow: visible; } table { min-width: 0; } }
</style>
