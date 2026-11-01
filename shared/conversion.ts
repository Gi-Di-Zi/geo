import { tools } from './catalog/tools.ts'
import type { FormatSpec, Recipe } from './types.ts'

export const MAX_UPLOAD_BYTES = 200 * 1024 ** 2

export function publishesService(recipe: Recipe) {
  return recipe.convert.some(step => tools.find(tool => tool.id === step.tool)?.type === 'server')
}

/** 공개 업로드는 파일을 만드는 경로만 제공한다. 준비된 샘플 서비스는 그대로 조회한다. */
export function fileUploadRecipes(format: FormatSpec) {
  return 'recipes' in format.upload ? format.upload.recipes.filter(recipe => !publishesService(recipe)) : []
}
