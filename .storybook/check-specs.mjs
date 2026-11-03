import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

execFileSync('python3', ['-B', resolve(root, '.storybook/scripts/migration_guard.py'), 'check'], { cwd: root, stdio: 'inherit' })

const manifest = JSON.parse(readFileSync(resolve(root, 'ui-specs/manifest.json'), 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const original = filename => execFileSync('git', ['show', `${manifest.sourceRevision}:${filename}`], { cwd: root })

const local = filename => {
  const path = resolve(root, filename)
  assert(path.startsWith(root) && realpathSync(path) === path)

  return readFileSync(path)
}

assert.equal(manifest.schemaVersion, 1)

assert.equal(manifest.organizationKind, 'personal')

assert.match(manifest.sourceRevision, /^[a-f0-9]{40}$/)

assert.deepEqual(manifest.platforms, ['web'])

const tracked = execFileSync('git', ['ls-tree', '-rz', '--name-only', manifest.sourceRevision], { cwd: root, encoding: 'utf8' }).split('\0')
const expectedDocs = []

for (const path of tracked) {
  if (path.endsWith('.md') && !path.toLowerCase().replaceAll('-', '').includes('eggtog')) expectedDocs.push(path)
}

assert.deepEqual(manifest.documents.map(document => document.path).sort(), expectedDocs.sort())

const documents = new Map()

for (const document of manifest.documents) {
  assert.equal(document.gitCommit, manifest.sourceRevision)
  assert.equal(hash(original(document.path)), document.sha256)
  assert(original(document.path).toString().split('\n')[document.line - 1].includes(document.heading))
  documents.set(document.path, document)
}

const identifiers = new Set()

for (const component of manifest.reusedComponents) {
  assert.equal(component.gitCommit, manifest.sourceRevision)
  assert.equal(hash(local(component.path)), component.sha256)
  assert.equal(hash(original(component.path)), component.sha256)
}

for (const screen of manifest.screens) {
  assert(!identifiers.has(screen.screenId))
  identifiers.add(screen.screenId)
  assert.equal(screen.projectId, manifest.projectId)
  assert.equal(screen.platform, 'web')
  assert(screen.route.startsWith('/'))
  assert(local(screen.mdxPath).toString().includes(screen.screenId))

  for (const path of screen.componentRefs) assert.equal(hash(local(path)), hash(original(path)))

  for (const reference of screen.sourceDocs) {
    assert.equal(documents.get(reference.path)?.sha256, reference.sha256)
    assert.equal(reference.gitCommit, manifest.sourceRevision)
    assert(original(reference.path).toString().split('\n')[reference.line - 1].includes(reference.heading))
  }

  for (const requirement of screen.requirements) assert.equal(requirement.approval, 'unknown')
}

console.log(JSON.stringify({ projectId: manifest.projectId, sourceRevision: manifest.sourceRevision,
  documents: documents.size, screens: identifiers.size, originalsPreserved: true }))
