import { join } from 'node:path'

/** 연계 저장 위치의 기본값: 업로드와 같은 데이터 폴더(GEO_DATA_DIR, 운영은 runtime-data) 아래. 실행 폴더(릴리스)가 바뀌어도 기준 사전·작업이 남게. LINK_* 환경변수가 있으면 그쪽 */
export const linkData = (relative: string) => join(process.env.GEO_DATA_DIR || '.data', relative)
