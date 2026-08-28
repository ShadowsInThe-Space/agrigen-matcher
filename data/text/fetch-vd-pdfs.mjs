// Batch-download official CPVO UPOV Variety Description PDFs for BSL-2026 varieties.
// Pipeline per variety (all anonymous GETs, see memory cpvo-upov-variety-description-api):
//   publicSearchDocuments/{appNo} -> VD doc (csDocsKey) -> downloadPublic/{csDocsKey} -> presigned S3
import fs from 'node:fs'

const coverage = JSON.parse(fs.readFileSync('/tmp/cpvo-coverage.json', 'utf8'))
  .filter((r) => r.status === 'FOUND')
const API = 'https://online.plantvarieties.eu/api'
const HDRS = { environment: 'PRO', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' }
const OUT_DIR = '/tmp/vd-pdfs'
fs.mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const safe = (s) => s.replace(/[^a-zA-Z0-9_-]+/g, '_')
const isVd = (d) => /(^|[^a-z])vd(\.|_|$| )/i.test(d.docName) || /variety\s*description/i.test(d.docName + ' ' + d.documentType)

let downloaded = 0, noVd = 0, errors = 0
const manifest = []

for (const v of coverage) {
  const file = `${OUT_DIR}/${safe(v.crop)}__${safe(v.name)}.pdf`
  const entry = { ...v, file: null }
  try {
    if (!fs.existsSync(file)) {
      const docRes = await fetch(`${API}/mypvr/v3/publicSearchDocuments/${v.applicationNumber}`, { headers: HDRS })
      if (!docRes.ok) throw new Error(`docs HTTP ${docRes.status}`)
      const { data: docs } = await docRes.json()
      const vd = (docs || []).find(isVd) || null
      if (!vd) { noVd++; manifest.push({ ...entry, status: 'NO_VD' }); await sleep(120); continue }
      const dlRes = await fetch(`${API}/common/v3/downloadPublic/${vd.csDocsKey}`, { headers: HDRS })
      if (!dlRes.ok) throw new Error(`dl HTTP ${dlRes.status}`)
      const { documents: dl } = await dlRes.json()
      if (!dl?.signecUrl) throw new Error('no presigned url')
      const pdfRes = await fetch(dl.signecUrl)
      if (!pdfRes.ok) throw new Error(`s3 HTTP ${pdfRes.status}`)
      const buf = Buffer.from(await pdfRes.arrayBuffer())
      if (buf.subarray(0, 4).toString() !== '%PDF') throw new Error('not a PDF')
      fs.writeFileSync(file, buf)
      await sleep(130)
    }
    downloaded++
    manifest.push({ ...entry, status: 'VD', file })
  } catch (e) {
    errors++
    manifest.push({ ...entry, status: `ERR_${e.message}` })
    await sleep(130)
  }
  if ((downloaded + noVd + errors) % 40 === 0) console.error(`  ...${downloaded + noVd + errors}/${coverage.length} (VDs ${downloaded}, ohne ${noVd}, Fehler ${errors})`)
}

fs.writeFileSync('/tmp/vd-manifest.json', JSON.stringify(manifest, null, 1))
console.log(`\nDONE: VDs ${downloaded}/${coverage.length}, ohne VD ${noVd}, Fehler ${errors}`)
