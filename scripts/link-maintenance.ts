import { linkRetentionInventory } from '../server/services/link/jobs.ts'

// 사용자 원문·토큰 없이 만료 건수만 기록한다. 물리 삭제·운영 스케줄 설치는 하지 않는다.
const result = await linkRetentionInventory()
console.log(JSON.stringify({ checkedAt: result.checkedAt, jobs: result.jobs.length, expired: result.jobs.filter(job => job.expired).length, physicalDeletion: result.physicalDeletion, note: result.note }, null, 2))
