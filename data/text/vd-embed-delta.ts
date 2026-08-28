// Delta extension of the VD text corpus for the M2a crops (maize, rapeseed,
// soybean, sugar beet, mustard, flax, lupin, faba bean).
//
// Contract (constraints from the extension task):
//   - parseVd is copied from data/text/vd-embed-pipeline.ts (same section
//     14/15/16 markers, same filters) so new texts are comparable to the
//     cached 200, EXTENDED by a multi-language section-16 fallback: the M2a
//     VDs come from non-BSA exam offices (EN/FR/DE/ES headers, wrapped
//     columns), where the original "Denomination of si…" marker never appears
//     contiguously. Section-15 text extraction is unchanged.
//   - Embedding input format identical to the original pipeline:
//       `${cpvoName ?? name} (${taxon ?? crop}): ${text}`
//     via Ollama bge-m3 on neobox through the SSH tunnel
//       ssh -N -L 11500:127.0.0.1:11434 neobox   →  http://127.0.0.1:11500/api/embed
//   - MERGE ONLY: the existing 200 corpus entries and their cached vectors are
//     never re-embedded or rewritten; new entries are appended. New vectors
//     are rounded to 5 decimals like the existing cache. Idempotent: entries
//     already present (normalized crop+name) are skipped.
import fs from 'node:fs'
import { execSync } from 'node:child_process'

// ── parse (copied from vd-embed-pipeline.ts) ─────────────────────────────────
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

  // section 16: officially most-similar variety. The original pipeline only
  // caught the contiguous "Denomination of si…" header of the BSA wheat VDs;
  // the M2a VDs come from other exam offices with EN/FR/DE/ES headers where
  // "Denomination of" and "similar variety" wrap onto separate lines. Fallback:
  // scan the section-16 table for the first data row — a designation (letters/
  // digits, single-space separated) followed by a wide column gap — skipping
  // header vocabulary and explicit none-values (NONE/None/Aucune/Keine).
  const s16 = lines.slice(end, end + 60).join('\n')
  let similarTo = null
  if (s16.includes('Denomination of si')) {
    const after = s16.split('Denomination of si')[1] ?? ''
    const m = after.match(/^\s*([A-Za-z][A-Za-z0-9.'äöüß-]*(?:\s+[A-Za-z0-9.'äöüß-]+)?)\s/m)
    if (m) similarTo = m[1]!.trim()
  }
  if (!similarTo) {
    const HEADER_STOP = /^(denomination|dénomination|denominación|bezeichnung|characteristics|caractère|caracteres|state|niveau|ausprägungsstufe|merkmal|similar|variété|variedad|variety|kandidatensorte|candidate|voisine|voisin|de la|of|different|différent|diferente|unterschiedlich)/i
    const NONE_VALUE = /^(none|aucune|keine|ninguna)\s*$/i
    for (const raw of s16.split('\n').slice(1)) {
      const line = raw.trim()
      if (!line || /^1[6-9]\./.test(line) || NONE_VALUE.test(line)) continue
      const m = line.match(/^([A-Z0-9][A-Za-z0-9.'äöüß-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.'äöüß-]*)*)\s{3,}\S/)
      if (!m) continue
      const candidate = m[1]!.replace(/\s*\([^)]*\)\s*$/, '').trim()
      if (!candidate || !/[A-Za-zÄÖÜäöü]/.test(candidate) || HEADER_STOP.test(candidate)) continue
      if (candidate.length > 40) continue
      similarTo = candidate
      break
    }
  }
  return { denomination, taxonCommon, text, similarTo }
}

// ── load delta + existing corpus ─────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync('/tmp/vd-manifest-new.json', 'utf8'))
  .filter((m) => m.status === 'VD' && m.file)
console.log(`new VD files: ${manifest.length}`)

const corpusUrl = new URL('./vd-corpus.json', import.meta.url)
const embUrl = new URL('./vd-embeddings.json', import.meta.url)
const corpusDoc = JSON.parse(fs.readFileSync(corpusUrl, 'utf8'))
const existingEmb = JSON.parse(fs.readFileSync(embUrl, 'utf8'))
const existing = corpusDoc.varieties
const EXISTING_N = existing.length
if (existingEmb.length !== EXISTING_N) throw new Error(`corpus ${EXISTING_N} != embeddings ${existingEmb.length}`)
const key = (v) => `${v.crop}|${v.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`
const existingKeys = new Set(existing.map(key))

const delta = []
let alreadyPresent = 0, parseFail = 0
for (const m of manifest) {
  if (existingKeys.has(key(m))) { alreadyPresent++; continue }
  const p = parseVd(m.file)
  if (!p || !p.text) { parseFail++; continue }
  delta.push({ crop: m.crop, name: m.name, cpvoName: p.denomination, taxon: p.taxonCommon, similarTo: p.similarTo, applicationNumber: m.applicationNumber, text: p.text })
}
console.log(`parsed with substantive text: ${delta.length}/${manifest.length} (already in corpus: ${alreadyPresent}, parse-fail: ${parseFail})`)

// cross-crop name-collision audit (eval matches similarTo by name alone)
const byNormName = new Map()
for (const v of [...existing, ...delta]) {
  const n = v.name.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!byNormName.has(n)) byNormName.set(n, [])
  byNormName.get(n).push(`${v.crop}:${v.name}`)
}
const collisions = [...byNormName.values()].filter((xs) => xs.length > 1)
console.log(`normalized-name collisions across corpus: ${collisions.length}${collisions.length ? ' → ' + collisions.map((c) => c.join(' vs ')).join('; ') : ''}`)

// ── embed the delta (bge-m3 via tunnel) ─────────────────────────────────────
const OLLAMA = 'http://127.0.0.1:11500/api/embed'
const round5 = (v) => Math.round(v * 1e5) / 1e5
const newEmb = []
const CHUNK = 16
for (let i = 0; i < delta.length; i += CHUNK) {
  const chunk = delta.slice(i, i + CHUNK).map((c) => `${c.cpvoName ?? c.name} (${c.taxon ?? c.crop}): ${c.text}`)
  const res = await fetch(OLLAMA, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'bge-m3', input: chunk }),
  })
  const d = await res.json()
  if (!d.embeddings) { console.error('embed fail at', i, JSON.stringify(d).slice(0, 120)); process.exit(1) }
  for (const vec of d.embeddings) newEmb.push(vec.map(round5))
  if ((i / CHUNK) % 6 === 0) console.error(`  embedded ${Math.min(i + CHUNK, delta.length)}/${delta.length}`)
}
console.log(`newly embedded: ${newEmb.length} x ${newEmb[0]?.length ?? 0}-dim`)
if (newEmb.length !== delta.length) throw new Error('embedding count mismatch')
if (!newEmb.every((e) => e.length === existingEmb[0].length)) throw new Error('embedding dim mismatch vs existing cache')

// ── merge (append-only, existing prefix untouched) ──────────────────────────
const mergedEmb = [...existingEmb, ...newEmb]
const mergedDoc = {
  ...corpusDoc,
  _meta: {
    ...corpusDoc._meta,
    count: existing.length + delta.length,
    extended: '2026-08-29',
    extension_note: 'M2a-Fruchtarten (Mais, Raps, Soja, Zuckerrübe, Senf, Lein, Lupine, Ackerbohne) via data/text/vd-embed-delta.ts ergänzt; Bestand vom 2026-08-27 unverändert.',
  },
  varieties: [...existing, ...delta],
}
fs.writeFileSync(corpusUrl, JSON.stringify(mergedDoc, null, 1) + '\n')
fs.writeFileSync(embUrl, JSON.stringify(mergedEmb) + '\n')

// verify: re-read and check the prefix is byte-identical in value space
const rereadDoc = JSON.parse(fs.readFileSync(corpusUrl, 'utf8'))
const rereadEmb = JSON.parse(fs.readFileSync(embUrl, 'utf8'))
const prefixOk = rereadEmb.slice(0, EXISTING_N).every((v, i) => v.every((x, k) => x === existingEmb[i][k]))
const varietiesPrefixOk = rereadDoc.varieties.slice(0, EXISTING_N).every((v, i) => JSON.stringify(v) === JSON.stringify(existing[i]))
console.log(`merged corpus: ${rereadDoc.varieties.length} varieties, ${rereadEmb.length} embeddings`)
console.log(`existing prefix unchanged: embeddings=${prefixOk} varieties=${varietiesPrefixOk}`)
if (!prefixOk || !varietiesPrefixOk) { console.error('PREFIX MUTATED — aborting'); process.exit(1) }
const withSim = delta.filter((c) => c.similarTo).length
console.log(`delta entries with official similar-variety label: ${withSim}`)
console.log(`sample new text (${delta[0]?.name}): ${delta[0]?.text.slice(0, 200)}...`)
