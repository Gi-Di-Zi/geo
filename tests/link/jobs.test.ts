import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

process.env.LINK_DATA_DIR = resolve('.data/link-test', randomUUID())
const { startLinkJob, getLinkJob, createLinkExport, readLinkArtifact, claimLinkJob, rerunLinkJob, LINK_JOBS_DIR } = await import('../../server/services/link/jobs.ts')
const { prepareUpload, previewUpload, resolveInput } = await import('../../server/services/link/service.ts')
const { newAccessToken } = await import('../../server/services/link/access.ts')
const owner = { owner: newAccessToken() }, other = { owner: newAccessToken() }
const pnu = '1111010100100010000'
async function completed(id: string) {
  for (let n = 0; n < 300; n++) {
    const info = await getLinkJob(id, owner)
    if (!['queued', 'running'].includes(info.state)) return info
    await new Promise(done => setTimeout(done, 10))
  }
  assert.fail('작업이 제한 시간 안에 끝나지 않았습니다.')
}

test('소량과 작업 결과 의미가 같고 원본·빈 행·중복·실패가 유지된다', async () => {
  const input = { text: `${pnu}\n\n잘못된값\n${pnu}`, options: { inputType: 'pnu' } }
  const sync = await resolveInput(input)
  const job = await startLinkJob(input, owner), info = await completed(job.id)
  assert.notEqual(info.state, 'failed'); assert.equal(info.result!.version, sync.version)
  assert.deepEqual(info.result!.rows, sync.rows); assert.equal(info.result!.summary.input, 4)
  assert.equal(info.result!.rows[1]!.value, ''); assert.equal(info.result!.rows[3]!.value, pnu)
  assert.ok(info.result!.rows.every(row => row.parcel === 'not_checked'))
})
test('중복 시작은 소유자·입력·옵션·기준 버전에 묶고 키충돌을 거절한다', async () => {
  const input = { text: pnu }, key = randomUUID()
  const [a, b] = await Promise.all([startLinkJob(input, owner, key), startLinkJob(input, owner, key)])
  assert.equal(a.id, b.id)
  await assert.rejects(startLinkJob({ text: pnu, options: { level: 'sido' } }, owner, key), /다른 입력/)
  const otherJob = await startLinkJob(input, other, key); assert.notEqual(otherJob.id, a.id)
})
test('작업ID만 아는 다른 소유자는 조회·출력·파일 다운로드를 할 수 없다', async () => {
  const job = await startLinkJob({ text: pnu }, owner); await completed(job.id)
  await assert.rejects(getLinkJob(job.id, other), /접근권한/)
  await assert.rejects(createLinkExport(job.id, other, 'json'), /접근권한/)
  const artifact = await createLinkExport(job.id, owner, 'json')
  await assert.rejects(readLinkArtifact(job.id, artifact.artifactId, other), /접근권한/)
  await assert.rejects(getLinkJob('../reference', owner), /찾을 수/)
  await assert.rejects(readLinkArtifact(job.id, '../raw', owner), /찾을 수/)
})
test('토큰을 해시로 저장하며 capability로 claim한 브라우저만 접근한다', async () => {
  const job = await startLinkJob({ text: pnu }, owner); await completed(job.id)
  assert.ok('accessToken' in job && typeof job.accessToken === 'string')
  const token = job.accessToken as string, stored = await readFile(join(LINK_JOBS_DIR, job.id, 'job.json'), 'utf8')
  assert.ok(!stored.includes(token)); assert.ok(!stored.includes(owner.owner))
  assert.equal((await getLinkJob(job.id, { token })).id, job.id)
  await claimLinkJob(job.id, token, other.owner)
  assert.equal((await getLinkJob(job.id, other)).id, job.id)
  await assert.rejects(claimLinkJob(job.id, newAccessToken(), newAccessToken()), /접근권한/)
})
test('같은 출력요청은 하나의 artifact를 재사용하고 읽기 요청은 생성하지 않는다', async () => {
  const job = await startLinkJob({ text: pnu }, owner); await completed(job.id)
  const [a, b] = await Promise.all([createLinkExport(job.id, owner, 'csv'), createLinkExport(job.id, owner, 'csv')])
  assert.equal(a.artifactId, b.artifactId)
  const output = await readLinkArtifact(job.id, a.artifactId, owner)
  assert.ok(output.data.length); assert.equal(output.filename, 'geo-link.csv')
  const c = await createLinkExport(job.id, owner, 'csv'); assert.equal(c.artifactId, a.artifactId)
})
test('파일 작업은 원본 시트/열선택을 보존하고 소량 API에 우회하지 않는다', async () => {
  const upload = await prepareUpload('업무.csv', Buffer.from(`PNU,note\n${pnu},내용`), owner)
  assert.equal(upload.totalRows, 1); assert.equal((await previewUpload(upload.uploadId, owner)).preview[0]![0], pnu)
  await assert.rejects(previewUpload(upload.uploadId, other), /접근권한/)
  await assert.rejects(resolveInput({ uploadId: upload.uploadId }, owner), /작업 실행/)
  const job = await startLinkJob({ uploadId: upload.uploadId, column: 0 }, owner), info = await completed(job.id)
  assert.equal(info.result!.rows[0]!.original.note, '내용')
  const rerun = await rerunLinkJob(job.id, owner, { level: 'sido' }), again = await completed(rerun.id)
  assert.equal(again.result!.rows[0]!.original.note, '내용'); assert.equal(again.options.level, 'sido')
})
test('만료 접근차단과 중단 작업 복구를 구분하며 부분재개를 하지 않는다', async () => {
  const job = await startLinkJob({ text: pnu }, owner); await completed(job.id)
  const path = join(LINK_JOBS_DIR, job.id, 'job.json'), meta = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify({ ...meta, state: 'running', processId: '이전 프로세스' }))
  const recovered = await getLinkJob(job.id, owner)
  assert.equal(recovered.state, 'failed'); assert.equal(recovered.error?.code, 'JOB_INTERRUPTED')
  await writeFile(path, JSON.stringify({ ...meta, expiresAt: '2000-01-01T00:00:00.000Z' }))
  await assert.rejects(getLinkJob(job.id, owner), /보관 기간/)
  await assert.rejects(createLinkExport(job.id, owner, 'json'), /보관 기간/)
})
test('페이지·상태 필터와 과대/비지원 입력을 검증한다', async () => {
  const job = await startLinkJob({ text: `${pnu}\ninvalid\n${pnu}` }, owner); await completed(job.id)
  const page = await getLinkJob(job.id, owner, 0, 1)
  assert.equal(page.returned, 1); assert.equal(page.nextOffset, 1); assert.equal(page.total, 3); assert.equal(page.result!.summary.input, 3)
  const filtered = await getLinkJob(job.id, owner, 0, 50, 'invalid'); assert.equal(filtered.total, 1)
  await assert.rejects(getLinkJob(job.id, owner, -1), /페이지/)
  await assert.rejects(resolveInput({ text: Array(201).fill(pnu).join('\n') }), /작업 실행/)
  await assert.rejects(startLinkJob({ url: 'http://127.0.0.1/private' }, owner))
  await assert.rejects(startLinkJob({ path: 'C:/private/company.csv' }, owner))
  await assert.rejects(startLinkJob({ rows: [{ id: 'x', value: pnu, original: { huge: 'a'.repeat(10001) } }] }, owner), /원본 행/)
})
test('작업 시작 후 활성 사전 경로를 바꾸어도 시작 버전과 미확인 상태를 유지한다', async () => {
  const previous = process.env.LINK_REFERENCE_DIR
  process.env.LINK_REFERENCE_DIR = resolve('.data/link-test', randomUUID(), '미설정사전')
  try {
    const job = await startLinkJob({ text: Array(450).fill(pnu).join('\n') }, owner)
    if (previous === undefined) delete process.env.LINK_REFERENCE_DIR
    else process.env.LINK_REFERENCE_DIR = previous
    const result = await completed(job.id)
    assert.equal(result.reference.version, 'unavailable'); assert.equal(result.result!.version, 'unavailable')
    assert.ok(result.result!.rows.every(row => row.status === 'unavailable' && row.parcel === 'not_checked'))
  } finally {
    if (previous === undefined) delete process.env.LINK_REFERENCE_DIR
    else process.env.LINK_REFERENCE_DIR = previous
  }
})
test('배치 경계 밖 중복 제거도 명시 선택일 때만 실행하며 입력 집계를 보존한다', async () => {
  const job = await startLinkJob({ text: Array(410).fill(pnu).join('\n'), options: { deduplicate: true } }, owner), info = await completed(job.id)
  assert.equal(info.result!.summary.input, 410); assert.equal(info.result!.summary.total, 1); assert.equal(info.result!.summary.omittedDuplicates, 409)
  assert.equal(info.progress.done, 410); assert.equal(info.progress.total, 410)
})
