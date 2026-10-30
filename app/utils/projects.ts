/**
 * 이 사이트의 프로젝트. 주소 앞부분(base)마다 다른 프로젝트, 헤더는 프로젝트 이름을 나란히, 소개(/) 맨 아래에 카드.
 * base 없음 = 기획 중인 자리 (헤더·카드에 이름만, 누를 수 없음). MCP(/mcp)·API(/api)는 사이트에 하나로 함께 쓴다
 */
type Project = { id: string; name: string; base?: string; summary: string; thumb?: string }

/** 공간 데이터 시각화 도구 (/viz). 예시 화면 헤더의 프로젝트 이름·돌아가기 주소 */
export const vizProject = { id: 'viz', name: '공간 데이터 시각화 도구', base: '/viz', summary: '공간 데이터 26종을 실제 공개 원본으로 수집·전처리·웹 변환해 웹 지도·엔진으로 확인', thumb: 'thumbs/model-3d-citygml.webp' }

export const projects: Project[] = [
  vizProject,
  { id: 'next', name: '준비 중', summary: '다음 프로젝트 자리 (기획 중)' },
]
