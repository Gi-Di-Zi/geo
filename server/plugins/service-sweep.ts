// 만료된 임시 서비스의 리소스 정리. 서버가 뜰 때 한 번(꺼져 있던 동안 만료된 것) + 일정 간격으로 다시.
// 지우는 일은 pipeline.ts --drop(DB 표·GeoServer 레이어·저장소·스타일·서버용 래스터, 없는 것은 건너뜀)이 한다. 만료 판정 자체는 요청마다(service-gate)
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

/** 레이어 하나 지우기. 종료 코드 0이 아니면 실패 → 다음 정리 때 다시 */
function drop(layer: string) {
  return new Promise<void>((done, fail) => {
    const child = spawn(process.execPath, [resolve('scripts/pipeline.ts'), '--drop', layer], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''

    child.stderr.on('data', chunk => { err = (err + chunk.toString()).slice(-1024) })
    child.once('error', fail)
    child.once('close', code => (code === 0 ? done() : fail(new Error(err.trim().split('\n').at(-1) || `정리 종료 코드 ${code}`))))
  })
}

export default defineNitroPlugin(nitro => {
  const every = Math.max(5, Number(process.env.GEO_SERVICE_SWEEP_SEC) || 600) * 1000
  let busy = false

  const sweep = async () => {
    if (busy) return
    busy = true

    try {
      for (const r of await sweepServices(JOBS_DIR, Date.now(), drop)) {
        if (r.result !== 'deleted') console.error(`임시 서비스 정리 ${r.result}: ${r.layer} (작업 ${r.job}) ${r.error ?? ''}`)
      }
    } catch (e) {
      console.error('임시 서비스 정리 오류:', e)
    } finally {
      busy = false
    }
  }

  const timer = setInterval(sweep, every)

  timer.unref()
  void sweep()
  nitro.hooks.hook('close', () => clearInterval(timer))
})
