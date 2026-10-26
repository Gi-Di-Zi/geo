// 서버 쪽 카탈로그: 업로드 받는 형식과 형식마다 고를 수 있는 방식·도구 설명.
// 업로드 화면의 형식 카드·방식 카드와 같은 데이터(shared/catalog, delivery.ts toolNotes) → MCP 도구·업로드 위젯 응답에 쓴다
import specs from '#catalog-formats'
import { categories } from '#shared/catalog/categories'
import { noteOf } from '#shared/catalog/delivery'
import { tools } from '#shared/catalog/tools'
import { kindLabels } from '#shared/viewers'
import type { FormatSpec, Recipe } from '#shared/types'

/** 확장자 spec 전체 (판별 sniff()에 그대로 넘긴다) */
export const allFormats = specs
/** 업로드를 받는 열린 형식 */
export const uploadFormats = specs.filter(f => !f.closed && 'recipes' in f.upload)

export const isServerRecipe = (r: Recipe) => r.convert.some(s => tools.find(t => t.id === s.tool)?.type === 'server')

/** 형식 하나: 업로드 조건 + 고를 수 있는 방식·도구(첫 번째가 기본값)와 고르는 기준·장단점 */
export function describeFormat(f: FormatSpec) {
  const recipes = 'recipes' in f.upload ? f.upload.recipes : []
  return {
    id: `${f.category}/${f.id}`,
    name: f.name,
    category: categories.find(c => c.id === f.category)?.name ?? f.category,
    color: categories.find(c => c.id === f.category)?.color,
    extensions: f.extensions,
    summary: f.summary,
    upload: 'recipes' in f.upload ? { accept: f.upload.accept, note: f.upload.note } : { unsupported: f.upload.unsupported },
    methods: recipes.map(r => {
      const n = noteOf(f.category, f.id, r.id)
      return {
        id: r.id,
        title: r.title,
        way: isServerRecipe(r) ? 'server' as const : 'file' as const,
        outputs: [...new Set(r.outputs.map(o => kindLabels[o.kind]))],
        when: n?.when,
        pros: n?.pros ?? [],
        cons: n?.cons ?? [],
      }
    }),
  }
}
