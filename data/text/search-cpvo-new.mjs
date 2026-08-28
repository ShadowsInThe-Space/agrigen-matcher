// CPVO coverage search for the M2a crops (maize, rapeseed, soybean, sugar beet,
// mustard, flax, lupin, faba bean) — the ~240 BSL varieties added after the
// original 200-entry text kernel was built.
//
// Route (anonymous GET only, see data/text/README.md):
//   GET publicSearch?denomination={name}  (header `environment: PRO`)
//   → exact-match denomination search ACROSS ALL SPECIES, so registers are
//   filtered by the expected genus of the BSL crop before acceptance.
//
// BSL↔CPVO Fehlformen tried in order (first genus-matching hit wins):
//   1. sortenname as parsed from the BSL table
//   2. trailing column-glue tokens stripped: " -", " <digit>" (sugar beet type
//      column), " ca." (maize)
//   3. spaces removed entirely ("LG 31215" ↔ "LG31215")
//   4. (2)+(3) combined
// NOT_FOUND is documented, never guessed.
//
// Output: data/text/cpvo-coverage-new.json (array; FOUND entries carry the
// applicationNumber used by fetch-vd-pdfs.mjs for the VD download).
import fs from 'node:fs'

const CROPS = [
  ['koernermais', 'Zea'],
  ['winterraps', 'Brassica'],
  ['sojabohne', 'Glycine'],
  ['zuckerruebe', 'Beta'],
  ['senf', 'Sinapis'],
  ['lein', 'Linum'],
  ['lupine', 'Lupinus'],
  ['ackerbohne', 'Vicia'],
]
const API = 'https://online.plantvarieties.eu/api/publicSearch/v3/publicSearch'
const HDRS = { environment: 'PRO', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' }
const SLEEP_MS = 130

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Ordered de-duplicated candidate spellings for one BSL sortenname. */
function variants(name) {
  const stripGlue = (n) =>
    n.replace(/\s+-$/, '').replace(/\s+\d{1,2}$/, '').replace(/\s+ca\.$/, '').trim()
  const out = []
  for (const v of [name, stripGlue(name)]) {
    for (const w of [v, v.replace(/\s+/g, '')]) {
      if (w && !out.includes(w)) out.push(w)
    }
  }
  return out
}

/** Rank registers: granted first, then granted-number presence, then newest. */
function bestRegister(registers) {
  const rank = (r) =>
    (r.applicationStatus === 'G' ? 0 : 1) * 4 + (r.grantNumber ? 0 : 2)
  return [...registers].sort((a, b) => rank(a) - rank(b) || (b.applicationNumber ?? 0) - (a.applicationNumber ?? 0))[0]
}

const results = []
let found = 0, notFound = 0

for (const [crop, genus] of CROPS) {
  const records = JSON.parse(fs.readFileSync(new URL(`../bsa/${crop}.json`, import.meta.url), 'utf8'))
  const names = records.map((r) => r.sortenname).filter(Boolean)
  for (const name of names) {
    let hit = null, matchedAs = null
    for (const v of variants(name)) {
      const url = `${API}?denomination=${encodeURIComponent(v)}`
      const res = await fetch(url, { headers: HDRS })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${v}`)
      const { data } = await res.json()
      const registers = (data?.registers ?? []).filter((r) =>
        String(r.speciesName ?? '').toLowerCase().startsWith(genus.toLowerCase()))
      await sleep(SLEEP_MS)
      if (registers.length > 0) { hit = bestRegister(registers); matchedAs = v; break }
    }
    if (hit) {
      found++
      results.push({
        crop, name, matchedAs, status: 'FOUND',
        applicationNumber: hit.applicationNumber,
        applicationStatus: hit.applicationStatus ?? null,
        speciesName: hit.speciesName ?? null,
        cpvoDenomination: hit.denomination ?? null,
      })
    } else {
      notFound++
      results.push({ crop, name, matchedAs: null, status: 'NOT_FOUND', applicationNumber: null })
    }
  }
  console.error(`${crop}: cumulative FOUND ${found} / NOT_FOUND ${notFound}`)
}

fs.writeFileSync(new URL('./cpvo-coverage-new.json', import.meta.url), JSON.stringify(results, null, 1) + '\n')
console.log(`DONE: ${found} gefunden, ${notFound} nicht gefunden (${found + notFound} Sorten gesucht)`)
