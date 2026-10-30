import { readFile } from 'node:fs/promises'
import { activateReference, decodeOfficialZip, referenceInfo, refreshReference } from '../server/services/link/reference.ts'

const args = process.argv.slice(2)
try {
  if (args.includes('--status')) console.log(JSON.stringify(await referenceInfo(), null, 2))
  else if (args[0] === '--import') {
    const path = args[1]
    if (!path) throw new Error('사용법: npm run link:reference -- --import <공식 ZIP 또는 UTF-8 TXT>')
    const data = await readFile(path), zipped = /\.zip$/i.test(path), decoded = zipped ? decodeOfficialZip(data) : { text: new TextDecoder('utf-8', { fatal: true }).decode(data), fileDate: undefined }
    console.log(JSON.stringify(await activateReference(decoded.text, { sourceFileDate: decoded.fileDate, ...(zipped && { rawZip: data }) }), null, 2))
  } else console.log(JSON.stringify(await refreshReference(args.includes('--force')), null, 2))
} catch (error) { console.error((error as Error).message); process.exitCode = 1 }
