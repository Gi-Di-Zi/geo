import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

const files = [
  'server/routes/mcp.ts',
  'server/utils/jobs.ts',
  'server/utils/stage.ts',
  'server/utils/catalog.ts',
  'server/utils/upload-storage.ts',
  'server/utils/job-files.ts',
  'server/middleware/conversion-worker.ts',
  'server/services/link/reference-updates.ts',
  'server/services/link/jobs.ts',
  'server/api/jobs.post.ts',
  'server/api/stage.ts',
  'server/api/jobs/[id]/files/[...path].get.ts',
  'server/api/jobs/[id]/download/[output].ts',
  'shared/conversion.ts',
  'shared/recommend.ts',
  'server/utils/service-expiry.ts',
  'server/utils/bundle-check.ts',
  'server/routes/svc/[...path].ts',
  'server/plugins/service-sweep.ts',
  'server/api/jobs/capabilities.get.ts',
  'app/pages/ai.vue',
  'app/pages/viz/upload.vue',
  'app/pages/viz/[category]/[format]/[[step]].vue',
  'scripts/pipeline.ts',
  'scripts/lint-scope.mjs',
  'scripts/lint-scope.test.mjs',
  'tests/viz/mcp-app.test.ts',
  'tests/viz/mcp-app-host.ts',
  'tests/viz/recommend.test.ts',
  'tests/viz/delivery.test.ts',
  'tests/link/reference-updates.test.ts',
  'tests/link/jobs.test.ts',
]

const options = process.argv.slice(2)

for (const option of options) {
  if (option !== '--fix') throw new Error(`Unsupported lint option: ${option}`)
}

for (const file of files) {
  if (!statSync(join(root, file)).isFile()) throw new Error(`Required lint input is not a file: ${file}`)
}

const result = spawnSync(process.execPath, [join(root, 'node_modules/oxlint/bin/oxlint'), '--config', join(root, '.oxlintrc.json'), '--deny-warnings', ...options, ...files], { cwd: root, stdio: 'inherit' })

if (result.error) throw result.error

if (result.signal) throw new Error(`Oxlint stopped by ${result.signal}`)

process.exit(result.status ?? 1)
