import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const executable = join(root, 'node_modules/oxlint/bin/oxlint')
const config = join(root, '.oxlintrc.json')

function lint(extension, source) {
  const directory = mkdtempSync(join(tmpdir(), 'geo-lint-contract-'))

  try {
    const file = join(directory, `fixture.${extension}`)
    writeFileSync(file, source)

    return spawnSync(process.execPath, [executable, '--config', config, '--deny-warnings', '--format', 'json', file], { cwd: root, encoding: 'utf8' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('anti-slop accepts valid JavaScript and Vue scripts', () => {
  const javascript = lint('js', 'export const title = "Spatial viewer";\n')
  const vue = lint('vue', '<script setup lang="ts">\nimport { ref } from "vue";\n\nconst title = ref("Spatial viewer");\n</script>\n<template><h1>{{ title }}</h1></template>\n')

  assert.equal(javascript.status, 0, javascript.stdout + javascript.stderr)
  assert.equal(vue.status, 0, vue.stdout + vue.stderr)
})

test('anti-slop rejects a newly introduced JavaScript violation', () => {
  const result = lint('js', 'export function size(value) {\n  if (typeof value === "string") return value.length;\n\n  return 0;\n}\n')

  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /anti-slop\(no-runtime-typeof\)/)
})

test('anti-slop rejects a newly introduced Vue script violation', () => {
  const result = lint('vue', '<script setup lang="ts">\nconst raw = JSON.parse("null");\nconst title = raw as unknown as string;\n</script>\n<template><h1>{{ title }}</h1></template>\n')

  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /anti-slop\(no-chained-type-assertions\)/)
})
