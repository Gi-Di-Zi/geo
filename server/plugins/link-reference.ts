// 주소·코드 연계 기준 사전(법정동·행정동)을 하루 한 번 자동으로 확인한다: 서버가 뜰 때(사전이 없으면 이때 받는다) + 1시간마다
// "오늘(한국 날짜) 확인했는가"를 보고 안 했으면 공식 제공처를 확인한다. 같은 날 다시 적용하지 않는 것·동시 실행 공유·실패 뒤 5분 대기는 updater 몫.
// 원천은 공개 다운로드(행정표준코드관리시스템·행정안전부)라 키가 필요 없다.
// 작업자(GEO_WORKER_KEY)와 개발 서버만: 공개 앞단 컨테이너는 읽기 전용이고 연계 요청을 받지 않으며, 빌드의 미리 그리기도 서버를 띄운다.
// LINK_REFERENCE_AUTOSTART=1이면 항상(직접 설치한 단일 서버), 0이면 끔
import { referenceUpdateStatus, updateReferences } from '../services/link/reference-updates.ts'

const HOUR = 3600_000

export default defineNitroPlugin(() => {
  const asked = process.env.LINK_REFERENCE_AUTOSTART

  if (asked === '0' || (asked !== '1' && !process.env.GEO_WORKER_KEY && process.env.NODE_ENV === 'production')) return

  const check = async () => {
    if (!(await referenceUpdateStatus()).canUpdate) return
    const result = await updateReferences()

    console.log(`주소·코드 기준자료 자동 확인 (${result.day}): ${result.sources.map(s => `${s.label} ${s.state}`).join(', ')}`)
  }

  const run = () => { check().catch(error => console.error(`주소·코드 기준자료 자동 확인 실패: ${error instanceof Error ? error.message : String(error)}`)) }

  run()
  setInterval(run, HOUR).unref()
})
