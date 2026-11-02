import { tools } from './catalog/tools.ts'
import type { FormatSpec, Recipe } from './types.ts'

export const MAX_UPLOAD_BYTES = 200 * 1024 ** 2

/** 업로드 서버 방식이 발행한 임시 서비스의 이용 기간. 발행 완료 시각부터 센다 (결과 파일 보관과는 별개) */
export const SERVICE_HOURS = 48

/**
 * 서비스 이용 기간(ms). 개발·시험 서버(NODE_ENV가 production이 아님)만 GEO_SERVICE_TTL_SEC_FOR_TEST로 줄여 만료 전후를 확인한다.
 * 서버(만료 검사)와 pipeline(발행 시각 기록)이 같은 환경 변수로 부른다
 */
export function serviceTtlMs(env: { NODE_ENV?: string; GEO_SERVICE_TTL_SEC_FOR_TEST?: string }) {
  const test = Number(env.GEO_SERVICE_TTL_SEC_FOR_TEST)

  return env.NODE_ENV !== 'production' && test > 0 ? test * 1000 : SERVICE_HOURS * 3600 * 1000
}

export function publishesService(recipe: Recipe) {
  return recipe.convert.some(step => tools.find(tool => tool.id === step.tool)?.type === 'server')
}

/** 공개 업로드는 파일을 만드는 경로만 제공한다. 준비된 샘플 서비스는 그대로 조회한다. */
export function fileUploadRecipes(format: FormatSpec) {
  return 'recipes' in format.upload ? format.upload.recipes.filter(recipe => !publishesService(recipe)) : []
}
