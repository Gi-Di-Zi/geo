import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

process.env.LINK_DATA_DIR = `.data/link/test-chunks-${randomUUID()}`
const { linkUploadChunk } = await import('../../server/services/link/chunks.ts')
const data = (value: string) => Buffer.from(value).toString('base64')

test('앱 파일 조각: 권한·순서·재전송·최종 파일 참조', async () => {
  const first = await linkUploadChunk({ name: 'test.csv', sequence: 0, data: data('PNU\n'), last: false }, 'owner-a')
  await assert.rejects(linkUploadChunk({ upload: first.upload, name: 'test.csv', sequence: 1, data: data('1111010100100010000\n'), last: true }, 'owner-b'), { code: 'UPLOAD_FORBIDDEN' })
  await assert.rejects(linkUploadChunk({ upload: first.upload, name: 'test.csv', sequence: 2, data: data('x'), last: false }, 'owner-a'), { code: 'CHUNK_OUT_OF_ORDER' })
  const retry = await linkUploadChunk({ upload: first.upload, name: 'test.csv', sequence: 0, data: data('PNU\n'), last: false }, 'owner-a')
  assert.equal(retry.bytes, first.bytes)
  await assert.rejects(linkUploadChunk({ upload: first.upload, name: 'test.csv', sequence: 0, data: data('different'), last: false }, 'owner-a'), { code: 'CHUNK_CONFLICT' })
  const last = await linkUploadChunk({ upload: first.upload, accessToken: first.accessToken, name: 'test.csv', sequence: 1, data: data('1111010100100010000\n'), last: true }, 'owner-b')
  assert.equal(last.staged?.totalRows, 1)
  const repeated = await linkUploadChunk({ upload: first.upload, name: 'test.csv', sequence: 1, data: data('1111010100100010000\n'), last: true }, 'owner-a')
  assert.equal(repeated.staged?.uploadId, last.staged?.uploadId)
})
test('앱 업로드는 확장자·base64·첫 순서·조각 상한을 검증', async () => {
  for (const input of [
    { name: 'file.txt', sequence: 0, data: data('x'), last: true },
    { name: 'file.csv', sequence: 1, data: data('x'), last: true },
    { name: 'file.csv', sequence: 0, data: 'invalid!', last: true },
    { name: 'file.csv', sequence: 0, data: Buffer.alloc(128 * 1024 + 1).toString('base64'), last: true },
  ]) await assert.rejects(linkUploadChunk(input, 'owner'), { code: 'INVALID_CHUNK' })
})
test('최종 조각 동시 재전송은 하나의 파일로 완료하고 후속 조각은 차단', async () => {
  const first = await linkUploadChunk({ name: 'retry.csv', sequence: 0, data: data('PNU\n'), last: false }, 'retry-owner')
  const final = { upload: first.upload, name: 'retry.csv', sequence: 1, data: data('1111010100100010000\n'), last: true }
  const [a, b] = await Promise.all([linkUploadChunk(final, 'retry-owner'), linkUploadChunk(final, 'retry-owner')])
  assert.equal(a.staged?.uploadId, b.staged?.uploadId)
  await assert.rejects(linkUploadChunk({ ...final, sequence: 2 }, 'retry-owner'), { code: 'CHUNK_OUT_OF_ORDER' })
})
