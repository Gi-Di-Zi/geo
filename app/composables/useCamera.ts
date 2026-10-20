import type { FormatSpec, ViewerId } from '#shared/types'

/** 공유 카메라. zoom은 MapLibre 기준(512px 타일)이고 OpenLayers는 +1, Cesium은 높이로 바꿔 쓴다 */
export interface Camera {
  lon: number
  lat: number
  zoom: number
  bearing: number
  pitch: number
  /** 바라보는 지점의 높이(m). 확장자의 시점에서만 정하고, 뷰어를 움직여도 그대로 둔다 */
  height: number
  from: ViewerId | 'reset'
}
type Move = Omit<Camera, 'from' | 'height'>

export function useCamera() {
  const camera = useState<Camera>('camera', () => ({ lon: 126.978, lat: 37.566, zoom: 14, bearing: 0, pitch: 0, height: 0, from: 'reset' }))
  const sync = useState('camera-sync', () => true)

  const publish = (from: ViewerId, c: Move) => { camera.value = { ...c, height: camera.value.height, from } }
  const reset = (view: FormatSpec['view']) => {
    camera.value = { lon: view.center[0], lat: view.center[1], zoom: view.zoom, bearing: view.bearing ?? 0, pitch: view.pitch ?? 0, height: view.height ?? 0, from: 'reset' }
  }
  /** 지도 도구(확대·축소·북쪽 위로)가 마지막 카메라를 고쳐 모든 뷰어에 보낸다 (동기화를 꺼도 따라온다) */
  const move = (c: Partial<Move>) => { camera.value = { ...camera.value, ...c, from: 'reset' } }

  /**
   * 뷰어 쪽: 다른 뷰어가 움직이면 따라가고, 사람이 이 지도를 직접 조작했을 때만 자기 카메라를 알린다.
   * 처음 그릴 때나 따라가며 생긴 이동까지 알리면, 줌 환산이 근사치인 뷰어(Cesium)의 값을 다른 뷰어가 되받아 조금씩 어긋난다.
   */
  function follow(id: ViewerId, apply: (c: Camera) => void) {
    let userAt = 0
    watch(camera, c => {
      if (c.from === id || (!sync.value && c.from !== 'reset')) return
      apply(c)
    })
    const mark = () => { userAt = Date.now() }
    return {
      /** 지도 컨테이너에 사람 입력(드래그, 휠, 터치, 키보드)을 감지할 리스너를 단다 */
      watchInput: (el: HTMLElement) => {
        for (const type of ['pointerdown', 'wheel', 'touchstart', 'keydown']) el.addEventListener(type, mark, { passive: true, capture: true })
      },
      emit: (c: Move) => { if (Date.now() - userAt < 3000) publish(id, c) },
    }
  }

  return { camera, sync, publish, reset, move, follow }
}

/** MapLibre zoom ↔ 카메라와 중심점 거리(m). fovy는 Cesium 세로 화각(라디안) */
const MPP0 = 78271.517 // zoom 0, 512px 타일에서 적도 1px의 미터
export const zoomToRange = (zoom: number, lat: number, h: number, fovy: number) =>
  (MPP0 * Math.cos((lat * Math.PI) / 180) / 2 ** zoom) * h / (2 * Math.tan(fovy / 2))
export const rangeToZoom = (range: number, lat: number, h: number, fovy: number) =>
  Math.log2((MPP0 * Math.cos((lat * Math.PI) / 180) * h) / (2 * Math.tan(fovy / 2) * range))
