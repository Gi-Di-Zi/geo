import { spawn } from 'node:child_process'
import { once } from 'node:events'

let target = process.env.LINK_TEST_URL || 'http://localhost:3000'
let server: ReturnType<typeof spawn> | undefined
async function ready() {
  try { const response = await fetch(`${target}/api/link/capabilities`, { signal: AbortSignal.timeout(2000) }); return response.ok && (await response.json()).project === 'geo-link' } catch { return false }
}
try {
  if (!await ready()) {
    if (process.env.LINK_TEST_URL) throw new Error('LINK_TEST_URL 서버가 준비되지 않았습니다.')
    target = 'http://localhost:3017'
  }
  if (!await ready()) {
    server = spawn(process.execPath, ['node_modules/@nuxt/cli/bin/nuxi.mjs', 'dev', '--host', 'localhost', '--port', '3017'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let error = ''
    server.stderr?.on('data', chunk => { error = (error + chunk).slice(-3000) })
    server.stdout?.on('data', chunk => { error = (error + chunk).slice(-3000) })
    const deadline = Date.now() + 90_000
    while (!await ready()) {
      if (server.exitCode !== null || Date.now() > deadline) throw new Error(`테스트 서버 시작 실패: ${error}`)
      await new Promise(done => setTimeout(done, 500))
    }
  }
  const test = spawn(process.execPath, ['--test', '--test-concurrency=1', 'tests/link/core.test.ts', 'tests/link/reference.test.ts', 'tests/link/administrative.test.ts', 'tests/link/administrative-service.test.ts', 'tests/link/reference-updates.test.ts', 'tests/link/location.test.ts', 'tests/link/location-resolve.test.ts', 'tests/link/all.test.ts', 'tests/link/boundary.test.ts', 'tests/link/files.test.ts', 'tests/link/jobs.test.ts', 'tests/link/chunks.test.ts', 'tests/link/http.test.ts', 'tests/link/web.test.ts', 'tests/link/apps.test.ts'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, LINK_TEST_URL: target } })
  const [code] = await once(test, 'exit')
  process.exitCode = Number(code) || 0
} catch (error) { console.error((error as Error).message); process.exitCode = 1 }
finally { server?.kill() }
