// 엔진(Unreal) 실시간 보기: 업로드 작업의 3D Tiles·지형 결과를 이 PC의 언리얼(Cesium for Unreal)로 띄우고 Pixel Streaming 플레이어 주소를 준다.
// 띄우기는 scripts/unreal.ts stream --job (시그널링 서버 + 언리얼, 보는 사람이 10분 없으면 스스로 끝남). 상태는 시그널링 서버 API(/api)로 본다
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { appendFileSync, createWriteStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { engine, engineOutput } from '#shared/viewers'
import type { Job } from '#shared/types'

// ponytail: 한 번에 하나 (GPU·포트 하나). 다른 작업을 띄우면 앞의 것을 끈다. 개발 서버가 다시 시작되면 잊은 스트림은 10분 뒤 스스로 끝남
let live: { job: string; child: ChildProcess } | null = null
const streamerId = (job: string) => `job-${job.slice(0, 8)}`
const api = <T>(path: string) => $fetch<T>(`http://127.0.0.1:${engine.streamPort}/api${path}`).catch(() => null)

/** 실시간 보기 상태. host = 플레이어 주소에 쓸 이 서버의 호스트 이름 (같은 PC·사내망) */
export async function engineInfo(id: string, host: string) {
  const dir = jobDir(id)
  const on = live?.job === id
  const streamers = on ? await api<{ streamerId: string; streaming: boolean }[]>('/streamers') : null
  const players = on ? await api<unknown[]>('/players') : null
  // 꺼져 있으면 마지막 기록 몇 줄 (실패 이유: 언리얼 없음, 포트 사용 중, 보는 사람 없어 종료 …). 시그널링 서버 접속 기록·색 코드는 뺀다
  const log = on ? '' : (await readFile(join(dir, 'engine.log'), 'utf8').catch(() => ''))
    .replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(l => /^(■|\s+·|✗)|error/i.test(l) && !/^\s+at /.test(l)).slice(-3).join('\n')
  return {
    job: id,
    state: !on ? 'off' as const : streamers?.some(s => s.streamerId === streamerId(id) && s.streaming) ? 'ready' as const : 'starting' as const,
    player: `http://${host}:${engine.streamPort}/?StreamerId=${streamerId(id)}&AutoConnect=true&AutoPlayVideo=true&StartVideoMuted=true`,
    viewers: players?.length ?? 0,
    idleMin: Number(process.env.ENGINE_IDLE_MIN || 10),
    ...(log && { log }),
  }
}

/** 띄우기. 이미 이 작업이면 상태만 */
export async function engineStart(id: string, host: string) {
  const dir = jobDir(id)
  const job: Job | null = await readFile(join(dir, 'job.json'), 'utf8').then(JSON.parse, () => null)
  if (job?.state !== 'done' || !job.recipe || !engineOutput(job.recipe)) {
    throw createError({ statusCode: 400, statusMessage: '엔진으로 볼 결과(3D Tiles·지형) 없음 → 3D Tiles·지형을 만드는 방식으로 변환한 작업만' })
  }
  if (live?.job !== id) {
    // 우리가 띄운 게 없는데 플레이어 포트가 응답하면 다른 실시간 보기(npm run unreal -- stream)가 떠 있는 것
    if (!live && await fetch(`http://127.0.0.1:${engine.streamPort}/`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) {
      throw createError({ statusCode: 409, statusMessage: `포트 ${engine.streamPort} 사용 중 — 다른 실시간 보기(npm run unreal -- stream)를 끈 뒤 다시` })
    }
    if (live) engineStop(live.job)
    const log = createWriteStream(join(dir, 'engine.log'))
    // Linux: 새 프로세스 그룹으로 띄워 끌 때 그룹째(시그널링 서버·언리얼·셰이더 컴파일러까지) 끈다
    const child = spawn(process.execPath, ['scripts/unreal.ts', 'stream', '--job', dir], { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    child.stdout.pipe(log)
    child.stderr.pipe(log)
    child.on('exit', () => { if (live?.child === child) live = null })
    live = { job: id, child }
    // 바로 끝나는 경우(언리얼 없음·포트 사용 중)는 이유를 같이 돌려준다
    await new Promise(ok => setTimeout(ok, 4000))
  }
  return engineInfo(id, host)
}

/** 끄기 (이 작업이 떠 있을 때만). 자식의 자식(시그널링 서버·언리얼)이 남지 않게 Windows는 트리째, Linux는 프로세스 그룹째 */
export function engineStop(id: string) {
  if (live?.job !== id) return
  const pid = live.child.pid

  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else if (pid) {
    try { process.kill(-pid, 'SIGTERM') } catch { live.child.kill() }
  }
  live = null
  appendFileSync(join(jobDir(id), 'engine.log'), '  · 끔\n')
}
