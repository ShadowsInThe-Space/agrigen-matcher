// VD corpus pipeline: parse CPVO UPOV variety-description PDFs into bilingual
// per-variety texts, embed with bge-m3 (neobox via SSH tunnel on :11500),
// run cross-modal identity + BSA-official-similar-variety validation.
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const manifest = JSON.parse(fs.readFileSync('/tmp/vd-manifest.json', 'utf8')).filter((m) => m.status === 'VD' && m.file)
console.log(`VD files: ${manifest.length}`)

// ── parse ────────────────────────────────────────────────────────────────────
function parseVd(file) {
  let txt
  try { txt = execSync(`pdftotext -layout "${file}" -`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }) }
  catch { return null }
  const lines = txt.split('\n').map((l) => l.replace(/\s+$/, ''))

  const grabAfter = (marker) => {
    const i = lines.findIndex((l) => l.includes(marker))
    return i >= 0 && lines[i + 1] ? lines[i + 1]!.trim() : null
  }
  const denomination = grabAfter('7. Sortenbezeichnung') ?? grabAfter('7. Variety denomination')
  const taxonCommon = grabAfter('6. Landesübliche Bezeichnung') ?? grabAfter('6. Common name of taxon')

  const start = lines.findIndex((l) => /^14\.|^15\./.test(l.trim()) || l.includes('In den UPOV-Prüfungsrichtlinien'))
  const end = lines.findIndex((l, i) => i > start && /^16\./.test(l.trim()))
  if (start < 0 || end < 0) return null
  const rawBlock = lines.slice(start, end)

  const cleaned = []
  for (const l of rawBlock) {
    const t = l.trim()
    if (!t) continue
    if (/^-?\d?-?\s*$/.test(t)) continue                                   // page footers "-2-"
    if (/\((WW|WG|WR|WO|BO|HA)?\s?\d+\)\s*$/.test(t) && t.length < 40) continue // footer w/ exam ref
    if (/^(UPOV|Nr\. No\.|G\s+\d|\d+\s+\d+\s+\d+\s*$)/.test(t)) continue    // column headers
    if (/Characteristics included|aufgeführte Merkmale/.test(t)) continue
    if (/Ausprägungsstufe|State of Expression/i.test(t)) continue
    cleaned.push(t)
  }
  const text = cleaned.join('; ').replace(/\s+/g, ' ').replace(/;+/g, ';').trim()
  if (text.length < 200) return null

  // section 16: officially most-similar variety (first denomination-like token)
  const s16 = lines.slice(end, end + 60).join('\n')
  const simMatch = s16.match(/^\s*([A-Z][A-Za-z0-9.'äöüß-]+(?:\s+[A-Z][A-Za-z0-9.'äöüß-]+)?)\s*\n/gm)
  let similarTo = null
  if (s16.includes('Denomination of si')) {
    const after = s16.split('Denomination of si')[1] ?? ''
    const m = after.match(/^\s*([A-Za-z][A-Za-z0-9.'äöüß-]*(?:\s+[A-Za-z0-9.'äöüß-]+)?)\s/m)
    if (m) similarTo = m[1]!.trim()
  }
  return { denomination, taxonCommon, text, similarTo }
}

const corpus = []
for (const m of manifest) {
  const p = parseVd(m.file)
  if (p && p.text) corpus.push({ crop: m.crop, name: m.name, cpvoName: p.denomination, taxon: p.taxonCommon, similarTo: p.similarTo, text: p.text, file: m.file })
}
console.log(`parsed with substantive text: ${corpus.length}/${manifest.length}`)
fs.writeFileSync('/tmp/vd-corpus.json', JSON.stringify(corpus, null, 1))
const withSim = corpus.filter((c) => c.similarTo)
console.log(`with official similar-variety label: ${withSim.length}`)
console.log(`sample text (${corpus[0]!.name}): ${corpus[0]!.text.slice(0, 220)}...`)

// ── embed (bge-m3 via tunnel) ────────────────────────────────────────────────
const OLLAMA = 'http://127.0.0.1:11500/api/embed'
const embeddings = []
const CHUNK = 16
for (let i = 0; i < corpus.length; i += CHUNK) {
  const chunk = corpus.slice(i, i + CHUNK).map((c) => `${c.cpvoName ?? c.name} (${c.taxon ?? c.crop}): ${c.text}`)
  const res = await fetch(OLLAMA, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: chunk }),
  })
  const d = await res.json()
  if (!d.embeddings) { console.error('embed fail at', i, JSON.stringify(d).slice(0, 120)); process.exit(1) }
  embeddings.push(...d.embeddings)
  if ((i / CHUNK) % 6 === 0) console.error(`  embedded ${i + chunk}/${corpus.length}`)
}
console.log(`embedded: ${embeddings.length} x ${embeddings[0]!.length}-dim`)
fs.writeFileSync('/tmp/vd-embeddings.json', JSON.stringify(embeddings))

// ── kernels ─────────────────────────────────────────────────────────────────
const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
const norms = embeddings.map(norm)
const cos = (i, j) => embeddings[i]!.reduce((s, x, k) => s + x * embeddings[j]![k], 0) / (norms[i]! * norms[j]!)

// 1) identity: text i must rank itself #1
let top1 = 0, worstMargin = 1
for (let i = 0; i < corpus.length; i++) {
  let bestJ = -1, bestV = -2, selfV = -2
  for (let j = 0; j < corpus.length; j++) {
    const v = i === j ? -2 : cos(i, j)   // exclude self trivially
    if (i !== j && v > bestV) { bestV = v; bestJ = j }
    if (i === j) selfV = v
  }
  // true identity check: recompute self with self included
  const self = cos(i, i)
  if (self >= bestV) top1++
  else worstMargin = Math.min(worstMargin, bestV - self)
}
console.log(`\nIDENTITY: self ranks #1 in ${top1}/${corpus.length} (${(100 * top1 / corpus.length).toFixed(1)}%)${worstMargin < 1 ? ` (worst deficit ${worstMargin.toFixed(4)})` : ''}`)

// 2) BSA-official similar varieties: rank of similarTo in text kernel
let hits1 = 0, hits5 = 0, hits10 = 0, n = 0, examples = []
for (let i = 0; i < corpus.length; i++) {
  const target = corpus[i]!.similarTo
  if (!target) continue
  const tn = target.toLowerCase().replace(/[^a-z0-9]/g, '')
  const ranking = corpus.map((c, j) => ({ j, name: c.name, v: j === i ? -2 : cos(i, j) }))
    .sort((a, b) => b.v - a.v)
  const rank = ranking.findIndex((r) => r.name.toLowerCase().replace(/[^a-z0-9]/g, '') === tn) + 1
  if (rank <= 0) continue  // similar variety not in our corpus
  n++
  if (rank === 1) hits1++
  if (rank <= 5) hits5++
  if (rank <= 10) { hits10++; if (examples.length < 5 && rank > 1) examples.push(`${corpus[i]!.name} -> amtlich ähnlichste: ${target} (Text-Rang ${rank})`) }
}
console.log(`BSA similar-variety labels (in-corpus pairs: ${n}): Top-1 ${hits1}, Top-5 ${hits5} (${n ? (100 * hits5 / n).toFixed(0) : 0}%), Top-10 ${hits10}`)
examples.slice(0, 5).forEach((e) => console.log(`  ${e}`))

// 3) semantic neighbors for KWS Mintum (sanity glimpse)
{
  const i = corpus.findIndex((c) => c.name === 'KWS Mintum')
  if (i >= 0) {
    const top = corpus.map((c, j) => ({ name: c.name, v: j === i ? -2 : cos(i, j) })).sort((a, b) => b.v - a.v).slice(0, 5)
    console.log(`\nKWS Mintum — text-kernel Nachbarn: ${top.map((t) => `${t.name} (${t.v.toFixed(3)})`).join(', ')}`)
    console.log(`KWS Mintum — amtlich ähnlichste Sorte laut VD: ${corpus[i]!.similarTo}`)
  }
}
