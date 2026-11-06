/**
 * 이 사이트의 프로젝트. 주소 앞부분(base)마다 다른 프로젝트, 헤더는 프로젝트 이름을 나란히, 소개(/) 맨 아래에 카드.
 * base 없음 = 기획 중인 자리 (헤더·카드에 이름만, 누를 수 없음). MCP(/mcp)·API(/api)는 사이트에 하나로 함께 쓴다
 */
type Project = { id: string; name: string; base?: string; summary: string; thumb?: string; status?: string }

/** 공간 데이터 시각화 도구 (/viz). 예시 화면 헤더의 프로젝트 이름·돌아가기 주소 */
export const vizProject = { id: 'viz', name: '공간 데이터 시각화 도구', base: '/viz', summary: '공개 원본을 수집·전처리·웹 변환하고, 처리 방식과 지도·3D 결과를 비교', thumb: 'thumbs/model-3d-citygml.webp' }

export const linkProject = { id: 'link', name: '국내 주소·코드 연계 도구', base: '/link', summary: 'PNU·법정동·행정동코드·지번·도로명주소·좌표를 서로 변환. 한 번 넣으면 주소·코드·위치·우편번호·경계 SHP까지' }

export const projects: Project[] = [
  vizProject,
  linkProject,
]

/** 기존 시각화 경로로 바로 가는 대표 예시. 새 페이지나 별도 데이터는 만들지 않는다. */
export const vizExamples = [
  { id: 'citygml', to: '/viz/model-3d/citygml/view', name: 'CityGML → 3D Tiles', summary: '도쿄역 건물: 좌표계·축 순서를 맞추고 변환 경로 3가지 비교', thumb: 'thumbs/model-3d-citygml.webp', alt: 'PLATEAU 도쿄역 일대 건물의 3D Tiles 결과' },
  { id: 'las', to: '/viz/pointcloud/las/view', name: 'LAS 점군 → 웹 시각화', summary: '치악산 둘레길: 좌표·높이·노이즈를 정리하고 타일 변환 도구 비교', thumb: 'thumbs/pointcloud-las.webp', alt: '치악산 둘레길 LAS를 변환한 점군 결과' },
  { id: 'csv', to: '/viz/attribute/csv/view', name: '같은 CSV, 파일과 서버로', summary: '서울BIS 버스정류장: GeoJSON·타일·공간 서버 방식 비교', thumb: 'thumbs/attribute-csv.webp', alt: 'CSV 좌표로 만든 서울BIS 버스정류장 점 지도' },
]
