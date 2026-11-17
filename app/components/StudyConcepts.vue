<template>
  <div class="study-concepts prose">
    <section id="dem-dsm">
      <h2>DEM과 DSM: 땅의 높이와 표면의 높이</h2>
      <p>DEM(Digital Elevation Model)은 수치표고모델입니다. 여기서는 나무·건물을 제거한 맨땅의 높이를 뜻합니다. DSM(Digital Surface Model)은 건물 지붕·수관 등 지표 위 물체를 포함한 최상부 표면의 높이입니다. 같은 건물 위치에서 맨땅 DEM이 100m, DSM이 120m라면 높이 차이는 약 20m입니다.</p>
      <p>DEM은 경사·유역·배수 분석과 지형 배경에, DSM은 가시권·차폐·도시 표면 분석에 쓰입니다. 기관에 따라 DEM을 높이 모델 전체의 통칭으로 쓰고 맨땅 모델을 DTM이라고 부르기도 하므로 제품 설명의 지면 분류·제작 방법을 확인해야 합니다.</p>
      <p>DEM·DSM은 확장자가 아니라 데이터의 의미입니다. 둘 다 GeoTIFF(.tif)로 저장할 수 있고, COG로 바꿔도 건물 제거가 되지는 않습니다. DSM에서 맨땅을 만들려면 지면점 분류·보간 등 별도 처리가 필요합니다.</p>
      <p>DSM − 지면 DEM은 지상 물체 높이(nDSM)를 추정합니다. 두 격자의 수평·수직 좌표계, 해상도, 픽셀 정렬과 촬영 시기를 맞추고 NoData를 제외해야 합니다. 숲·건물 아래 지면이 관측되지 않았다면 보간 오차도 남습니다.</p>
      <details><summary>면접 질문: .tif 파일이면 DEM인가요?</summary><p>아닙니다. GeoTIFF는 저장 형식이며 영상·DEM·DSM을 모두 담을 수 있습니다. 밴드의 의미와 단위, 지면·표면 구분, 해상도·정확도, 수직 기준을 메타데이터에서 확인합니다.</p></details>
      <p class="small">근거: <a href="https://www.usgs.gov/faqs/what-a-digital-elevation-model-dem">USGS DEM 정의</a>, <a href="https://pubs.usgs.gov/circ/1399/pdf/circ1399.pdf">USGS 높이 모델과 DSM 설명</a></p>
    </section>
    <section id="ellipsoidal-projected">
      <h2>타원 좌표계와 투영 좌표계</h2>
      <p>여기서 타원 좌표계는 기준 타원체 위의 지리 좌표계(타원체 좌표계)를 뜻합니다. 지구 모양을 근사한 회전타원체를 기준으로 위도·경도를 각도(보통 도)로 나타내며, 3차원에서는 타원체고 h를 더합니다. 타원체는 모양이고, 데이텀·기준틀은 그 모양을 실제 지구에 연결하는 기준이므로 타원체 이름만으로 좌표계가 정해지지는 않습니다.</p>
      <p>투영 좌표계는 지리 좌표를 지도 투영법으로 평면에 옮겨 동·북 방향 등의 좌표로 표현합니다. 보통 미터를 사용하며 기준 지리 좌표계, 투영법, 원점·축·단위가 필요합니다. 곡면을 평면으로 펴므로 거리·면적·각도 중 왜곡이 생깁니다. 분석 범위와 목적에 맞는 투영법을 골라야 합니다.</p>
      <ul>
        <li>EPSG:4326: WGS 84의 2차원 위도·경도. 높이는 포함하지 않습니다.</li>
        <li>EPSG:4979: WGS 84의 위도·경도·타원체고를 담는 3차원 좌표계입니다.</li>
        <li>EPSG:5186: 국내 중부원점 기반의 투영 좌표계. 미터 좌표로 지역 분석에 활용합니다.</li>
        <li>EPSG:3857: 웹 지도용 투영 좌표계. 미터 단위여도 지상 거리·면적이 그대로 정확한 것은 아니며 위도에 따라 왜곡이 커집니다.</li>
      </ul>
      <p>위경도 1도의 지상 길이는 위치·방향에 따라 달라집니다. 거리·면적은 적합한 투영 좌표계나 측지 계산으로 구합니다. 좌표 변환에서는 출발·도착 CRS와 축 순서를 확인하고, 기준틀이 다르면 데이텀 변환도 고려합니다. CRS를 지정하는 것은 숫자의 뜻을 붙이는 일이고 재투영은 숫자 자체를 계산해 바꾸는 일입니다.</p>
      <h3>타원체고와 해발고도도 다릅니다</h3>
      <p>타원체고 h는 타원체 기준 높이, 정표고 H는 지오이드 기준 높이입니다. 같은 기준에 맞춘 지오이드고 N과의 관계는 h = H + N입니다. GNSS의 타원체고와 DEM의 해발고도를 바로 섞으면 높이 오차가 생길 수 있습니다. 수평 재투영만으로 수직 기준이 자동 변환되지는 않으며 수직 CRS와 적합한 지오이드 모델·변환 격자가 필요합니다.</p>
      <details><summary>면접 질문: 좌표계만 EPSG:4326으로 지정하면 위치가 변환되나요?</summary><p>아닙니다. 원본 좌표의 실제 CRS를 먼저 확인한 뒤 재투영해야 합니다. 잘못된 CRS 지정은 좌표 숫자를 유지한 채 다른 위치로 해석하게 만듭니다. 도구가 요구하는 축 순서와 높이 기준도 별도로 확인합니다.</p></details>
      <p class="small">근거: <a href="https://doc.esri.com/en/arcgis-online/latest/reference/coordinate-systems-online.html">Esri 좌표계·투영·수직 기준</a>, <a href="https://proj.org/en/stable/faq.html">PROJ 좌표축 순서</a></p>
    </section>
  </div>
</template>

<style scoped>
section { margin-top: 36px; }
h2 { font-size: var(--fs-3); margin-bottom: 12px; }
h3 { margin-top: 20px; }
p, ul, details { margin-top: 12px; }
summary { cursor: pointer; font-weight: 600; }
</style>
