import { readFile } from 'node:fs/promises'
import { activateAdministrativeReference, administrativeInfo, refreshAdministrativeReference } from '../server/services/link/administrative-reference.ts'

const args = process.argv.slice(2)
try {
  if (args.includes('--status')) console.log(JSON.stringify(await administrativeInfo(), null, 2))
  else if (args[0] === '--import') {
    if (!args[1]) throw new Error('사용법: npm run link:administrative -- --import <공식 ZIP>')
    console.log(JSON.stringify(await activateAdministrativeReference(await readFile(args[1]), { sourceUrl: '운영자가 확보한 행정안전부 공식 ZIP' }), null, 2))
  } else console.log(JSON.stringify(await refreshAdministrativeReference(args.includes('--force')), null, 2))
} catch (error) { console.error((error as Error).message); process.exitCode = 1 }
