import type { Category } from '../types.ts'

export const categories: Category[] = [
  { id: 'vector-2d', name: '2D 벡터', color: '#C8323C', summary: '점·선·면으로 그린 지도 데이터. 도로, 경계, 시설 위치.' },
  { id: 'vector-25d', name: '2.5D 벡터', color: '#DD7A1F', summary: '높이·층수 속성이 붙은 평면 도형. 건물을 입체로 세운다.' },
  { id: 'raster', name: '정사영상·래스터', color: '#12827F', summary: '픽셀 격자로 된 영상. 위성영상, 항공사진.' },
  { id: 'terrain', name: '지형', color: '#8A5A2B', summary: '땅의 높낮이를 담은 격자·메시. 지형 입체 표현의 바탕.' },
  { id: 'pointcloud', name: '포인트 클라우드', color: '#7448C9', summary: '레이저 스캐너가 측정한 대량의 3D 점. 점마다 좌표·색·분류.' },
  { id: 'model-3d', name: '3D 모델', color: '#2C5FD4', summary: '면과 텍스처로 이루어진 입체 모델. 건물, 시설물.' },
  { id: 'indoor-bim', name: '실내·BIM', color: '#2E8A4C', summary: '층·벽·설비까지 담은 건물 설계·시공 데이터.' },
]
