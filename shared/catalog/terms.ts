// 용어 팝오버와 개념 페이지(/concepts)가 같이 쓰는 용어. match는 본문에서 찾을 낱말(정규식), id는 개념 페이지 앵커
export interface Term { id: string; label: string; match: string; short: string }

export const terms: Term[] = [
  { id: 'crs', label: '좌표계 (EPSG)', match: 'EPSG(?::\\d+)?|좌표계', short: '지구 위 위치를 숫자로 적는 약속. EPSG:4326: 위경도, EPSG:3857: 웹 지도 미터 좌표, EPSG:5186: 국내 중부원점.' },
  { id: 'tiles', label: '타일 피라미드 (XYZ)', match: 'XYZ 타일|z/x/y|\\{z\\}/\\{x\\}/\\{y\\}', short: '줌 단계별로 256px 조각으로 미리 잘라 둔 지도. 줌 1단계마다 조각 수 4배.' },
  { id: 'vector-tiles', label: '벡터타일 (MVT)', match: 'MVT|벡터타일', short: '점·선·면을 타일 한 장 크기로 잘라 담은 이진 파일. 그림이 아닌 도형 → 브라우저에서 색·두께 변경 가능.' },
  { id: 'range', label: 'Range 요청', match: 'Range 요청', short: '파일 일부만("100~200바이트") 받는 HTTP 요청. COG·PMTiles는 이것으로 서버 없이 필요한 조각만 읽기.' },
  { id: 'cog', label: 'COG', match: 'COG', short: '웹 부분 읽기용 블록·축소본을 넣은 GeoTIFF. 확장자는 그대로 .tif.' },
  { id: 'pmtiles', label: 'PMTiles', match: 'PMTiles', short: '타일 수천 장을 파일 하나에 묶은 형식. 앞쪽 목차 + Range 요청으로 필요한 타일만 읽기.' },
  { id: 'ogc-api', label: 'OGC API Features', match: 'OGC API', short: '도형 데이터를 /collections/{id}/items 같은 정해진 주소로 주고받는 웹 표준. 이 사이트는 같은 구조의 정적 파일로 흉내.' },
  { id: '3d-tiles', label: '3D Tiles', match: '3D Tiles', short: '3D 데이터를 공간별 나무 구조로 묶은 OGC 표준. 멀리서는 단순하게, 가까이서는 자세하게.' },
  { id: 'terrain', label: 'Terrain-RGB · quantized-mesh', match: 'Terrain-RGB|quantized-mesh', short: '웹 지형 두 방식. Terrain-RGB: 높이를 색으로 담은 이미지 타일, quantized-mesh: 삼각형 메시 타일.' },
  { id: 'lod', label: 'LOD', match: 'LOD', short: '상세 수준(Level of Detail). 같은 대상을 멀리서는 단순한 모양, 가까이서는 자세한 모양으로.' },
  { id: 'gltf', label: 'glTF', match: 'glTF', short: '웹용 3D 모델 표준. .gltf: JSON + 외부 파일, .glb: 파일 하나로 묶은 이진 형태.' },
]
