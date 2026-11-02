// 지도 "선택" 결과: 누른 곳의 피처 속성, 모델·타일셋, 래스터·지형 레이어. 뷰어 4종이 같은 모양으로 보내고 ViewerTile이 표시한다
import type { Output, OutputKind } from '#shared/types'

export interface Picked {
  /** feature = 속성 있는 피처, model = 모델·타일셋(속성 없음), layer = 래스터·지형 레이어 범위 안, null = 선택할 것 없음 */
  hit: 'feature' | 'model' | 'layer' | null
  props: Record<string, unknown> | null
  /** 누른 위치 [경도, 위도] 또는 [경도, 위도, 높이(m)] (높이는 3D 표면을 맞힌 뷰어만) */
  at: number[] | null
}

/** 면 전체가 하나인 결과 (피처 단위로 고를 수 없음) → 범위 안을 누르면 레이어 선택 */
const LAYERS: OutputKind[] = ['image', 'cog', 'xyz-raster', 'terrain-rgb', 'quantized-mesh', 'wms']

/** 뷰어가 찾은 것으로 선택 결과를 만든다. object = 속성 없는 모델·타일셋을 맞혔는지 */
export function pickOf(o: Output, props: Record<string, unknown> | null, object: boolean, at: number[] | null): Picked {
  const p = props && Object.keys(props).length ? props : null
  const [lon, lat] = at ?? []
  const b = o.bounds
  const inside = lon !== undefined && lat !== undefined && (!b || (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]))
  const hit = p ? 'feature' : object ? 'model' : LAYERS.includes(o.kind) && inside ? 'layer' : null

  return { hit, props: p, at }
}
