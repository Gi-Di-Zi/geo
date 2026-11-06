// 주소·코드 연계 기준 사전(법정동·행정동)이 없으면 서버가 뜰 때 받는다 — 새 데이터 폴더·첫 배포에서 손으로 받지 않아도 되게.
// 원천은 공개 다운로드(행정표준코드관리시스템·행정안전부)라 키가 필요 없다. 이미 있으면 아무것도 하지 않는다(갱신은 /link/reference에서 하루 한 번).
// 작업자(GEO_WORKER_KEY)와 개발 서버만: 공개 앞단 컨테이너는 읽기 전용이고 연계 요청을 받지 않으며, 빌드의 미리 그리기도 서버를 띄운다.
// LINK_REFERENCE_AUTOSTART=1이면 항상(직접 설치한 단일 서버), 0이면 끔
import { administrativeInfo } from '../services/link/administrative-reference.ts'
import { getReference } from '../services/link/reference.ts'
import { updateReferences } from '../services/link/reference-updates.ts'

export default defineNitroPlugin(() => {
  const asked = process.env.LINK_REFERENCE_AUTOSTART

  if (asked === '0' || (asked !== '1' && !process.env.GEO_WORKER_KEY && process.env.NODE_ENV === 'production')) return

  void (async () => {
    const [legal, administrative] = await Promise.all([getReference(), administrativeInfo()])

    if (legal.available && administrative.available) return
    console.log('주소·코드 기준 사전 없음 → 공개 원천에서 받는 중')
    const result = await updateReferences()

    console.log(`주소·코드 기준 사전 받기: ${JSON.stringify(result).slice(0, 300)}`)
  })().catch(error => console.error(`주소·코드 기준 사전 받기 실패: ${error instanceof Error ? error.message : String(error)}`))
})
