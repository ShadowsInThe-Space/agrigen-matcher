/**
 * BSL 2026 M2a parser: Winterraps (S. 228–230) und Ackerbohne (S. 270–272).
 * Spaltenreihenfolge je Tabelle DOPPELT verifiziert: visueller Header-Lesung
 * (pdftoppm) und pdftotext -bbox x-Min-Koordinaten (s. PARSE-NOTES.md).
 *
 * Winterraps-Zeile: Sortenname + Linie/Hybride-Token [L|H] + 12 Noten
 *   buehbeginn, reifeverzoegerung_stroh, reife, pflanzenlaenge, lager,
 *   tausendkornmasse, kornertrag, oelertrag, oelgehalt, rohproteinertrag,
 *   rohproteingehalt, glucosinolatgehalt
 * Ackerbohne-Zeile: Sortenname + 12 Noten
 *   tanningehalt, buehbeginn, reife, pflanzenlaenge, lager, ascochyta,
 *   botrytis, rost, tausendkornmasse, kornertrag, rohproteinertrag,
 *   rohproteingehalt
 *
 * Run: node data/bsa/parse-m2a.ts
 */

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PDF = new URL('./bsl_getreide_2026.pdf', import.meta.url)

interface Record {
  sortenname: string
  section: string
  is_new: boolean
  footnotes: number[]
  zuechtyp?: string | null
  [key: string]: unknown
}

const RAPS_FIELDS = [
  'buehbeginn', 'reifeverzoegerung_stroh', 'reife', 'pflanzenlaenge', 'lager',
  'tausendkornmasse', 'kornertrag', 'oelertrag', 'oelgehalt', 'rohproteinertrag',
  'rohproteingehalt', 'glucosinolatgehalt',
]
const BOHNE_FIELDS = [
  'tanningehalt', 'buehbeginn', 'reife', 'pflanzenlaenge', 'lager', 'ascochyta',
  'botrytis', 'rost', 'tausendkornmasse', 'kornertrag', 'rohproteinertrag',
  'rohproteingehalt',
]

function extract(from: number, to: number): string {
  return execSync(`pdftotext -layout -f ${from} -l ${to} "${PDF.pathname}" -`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

function parseTable(raw: string, fields: string[], typeToken: boolean): Record[] {
  const records: Record[] = []
  let section = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || /^Seite\s+\d+/.test(trimmed)) continue
    const sectionMatch = trimmed.match(/^(Mit Voraussetzung|In einem anderen EU-Land|Erucasäure|Ohne Voraussetzung|In Frühjahrsaussaat|In Herbstaussaat)/)
    if (sectionMatch) { section = trimmed.replace(/\s+/g, ' ').slice(0, 80); continue }
    let rest = trimmed
    let isNew = false
    if (rest.startsWith('neu ')) { isNew = true; rest = rest.slice(4) }
    const tokens = rest.split(/\s+/)
    // Fußnoten-Marker von Namen lösen
    let nameTokens: string[] = []
    while (tokens.length && !/^\d\)$/.test(tokens[0]!) && !(typeToken && /^[LH]$/.test(tokens[0]!)) && !/^([1-9]|-)$/.test(tokens[0]!)) {
      nameTokens.push(tokens.shift()!)
    }
    const footnotes: number[] = []
    while (tokens.length && /^\d\)$/.test(tokens[0]!)) footnotes.push(Number(tokens.shift()!.replace(')', '')))
    let zuechtyp: string | null = null
    if (typeToken && tokens.length && /^[LH]$/.test(tokens[0]!)) zuechtyp = tokens.shift()!
    const values = tokens
    if (!nameTokens.length || values.length !== fields.length) continue
    if (!values.every(token => token === '-' || /^[1-9]$/.test(token))) continue
    const record: Record = {
      sortenname: nameTokens.join(' '),
      section: section || 'unbekannt',
      is_new: isNew,
      footnotes,
      zuechtyp,
    }
    fields.forEach((field, index) => { record[field] = values[index] === '-' ? null : Number(values[index]) })
    records.push(record)
  }
  return records
}

function verifyBbox(page: number, expected: string[]): void {
  const bbox = execSync(`pdftotext -bbox -f ${page} -l ${page} "${PDF.pathname}" -`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const hits: [number, string][] = []
  for (const match of bbox.matchAll(/<word xMin="([0-9.]+)"[^>]*>([^<]+)<\/word>/g)) {
    const word = match[2]!
    if (expected.includes(word.toLowerCase()) || expected.some(field => word.toLowerCase() === field)) {
      hits.push([Number(match[1]), word])
    }
  }
  // Cluster: erste x-Position je erwartetem Wort (Header-Wörter können mehrzeilig sein)
  const firstX = new Map<string, number>()
  for (const [x, word] of hits.sort((a, b) => a[0] - b[0])) {
    const key = word.toLowerCase()
    if (!firstX.has(key)) firstX.set(key, x)
  }
  const order = [...firstX.entries()].sort((a, b) => a[1] - b[1]).map(([word]) => word)
  const expectedSubset = expected.filter(field => order.includes(field))
  const mismatch = expectedSubset.filter((field, index) => order.indexOf(field) !== index)
  if (mismatch.length > 0) {
    throw new Error(`bbox-Reihenfolge abweichend auf S.${page}: erwartet Reihenfolge ${expectedSubset.join(' < ')}, gefunden ${order.join(' < ')}`)
  }
  console.log(`  bbox OK S.${page}: ${order.join(' < ')}`)
}


const MAIS_FIELDS = [
  'buehzeitpunkt_weiblich', 'pflanzenlaenge', 'kaelteempfindlichkeit_jugend', 'lager',
  'bestockung', 'staengelfaeule', 'kornertrag', 'tausendkornmasse',
  'silo_gesamttrockenmasse', 'staerkegehalt',
]

function parseMais(raw: string): Record[] {
  const records: Record[] = []
  let section = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || /^Seite\s+\d+/.test(trimmed)) continue
    if (/^Reifegruppe|^Mit Voraussetzung|^In einem anderen EU-Land/.test(trimmed)) { section = trimmed.slice(0, 70); continue }
    let rest = trimmed
    let isNew = false
    if (rest.startsWith('neu ')) { isNew = true; rest = rest.slice(4) }
    const tokens = rest.split(/\s+/)
    const nameTokens: string[] = []
    while (tokens.length && !/^K$/.test(tokens[0]!) && !/^([1-9]|-)$/.test(tokens[0]!)) nameTokens.push(tokens.shift()!)
    const footnotes: number[] = []
    while (tokens.length && /^\d\)$/.test(tokens[0]!)) footnotes.push(Number(tokens.shift()!.replace(')', '')))
    // K/S-Reifetokens: "K 210" und "S 200"
    let kornerreife: number | null = null
    let siloreife: number | null = null
    if (tokens[0] === 'K' && /^\d+$/.test(tokens[1] ?? '')) { kornerreife = Number(tokens[1]); tokens.splice(0, 2) }
    if (tokens[0] === 'S' && /^\d+$/.test(tokens[1] ?? '')) { siloreife = Number(tokens[1]); tokens.splice(0, 2) }
    const values = tokens
    if (!nameTokens.length || kornerreife === null || values.length !== MAIS_FIELDS.length) continue
    if (!values.every(token => token === '-' || /^[1-9]$/.test(token))) continue
    const record: Record = { sortenname: nameTokens.join(' '), section: section || 'unbekannt', is_new: isNew, footnotes, kornerreife, siloreife }
    MAIS_FIELDS.forEach((field, index) => { record[field] = values[index] === '-' ? null : Number(values[index]) })
    records.push(record)
  }
  return records
}


const SOJA_FIELDS = [
  'nabelfarbe', 'reife', 'pflanzenlaenge', 'lager', 'kornertrag',
  'oelertrag', 'rohproteinertrag', 'oelgehalt', 'rohproteingehalt', 'tausendkornmasse',
]

function parseSoja(raw: string): Record[] {
  const records: Record[] = []
  let section = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || /^Seite\s+\d+/.test(trimmed)) continue
    if (/^Mit Voraussetzung|^In einem anderen EU-Land|^Ohne Voraussetzung/.test(trimmed)) { section = trimmed.slice(0, 70); continue }
    let rest = trimmed
    let isNew = false
    if (rest.startsWith('neu ')) { isNew = true; rest = rest.slice(4) }
    const tokens = rest.split(/\s+/)
    const nameTokens: string[] = []
    while (tokens.length && !/^([1-9]|-)$/.test(tokens[0]!)) nameTokens.push(tokens.shift()!)
    // Fußnoten vom Namen lösen
    while (nameTokens.length && /^\d\)$/.test(nameTokens[nameTokens.length - 1]!)) nameTokens.pop()
    // 10 führende Noten-Token; dahinter folgen Ergänzungs-Angaben (ignoriert)
    const values = tokens.slice(0, SOJA_FIELDS.length)
    if (!nameTokens.length || values.length !== SOJA_FIELDS.length) continue
    if (!values.every(token => token === '-' || /^[1-9]$/.test(token))) continue
    const record: Record = { sortenname: nameTokens.join(' '), section: section || 'unbekannt', is_new: isNew, footnotes: [] }
    SOJA_FIELDS.forEach((field, index) => { record[field] = values[index] === '-' ? null : Number(values[index]) })
    records.push(record)
  }
  return records
}

function main(): void {
  console.log('Winterraps S. 228–230 …')
  const rapsRaw = extract(228, 230)
  verifyBbox(228, RAPS_FIELDS.map(field => field.replace(/_/g, '')))
  const raps = parseTable(rapsRaw, RAPS_FIELDS, true)
  const bohneRaw = extract(270, 272)
  console.log('Ackerbohne S. 270–272 …')
  verifyBbox(270, BOHNE_FIELDS.map(field => field.replace(/_/g, '')))
  const bohne = parseTable(bohneRaw, BOHNE_FIELDS, false)

  const summarize = (records: Record[], fields: string[]) => {
    const cells = records.length * fields.length
    const nulls = records.reduce((sum, r) => sum + fields.filter(f => r[f] === null).length, 0)
    return `${records.length} Sorten · ${nulls}/${cells} null · Erst/Letzt: ${records[0]?.sortenname ?? '-'} / ${records[records.length - 1]?.sortenname ?? '-'}`
  }
  console.log('  Raps:', summarize(raps, RAPS_FIELDS))
  console.log('  Ackerbohne:', summarize(bohne, BOHNE_FIELDS))

  writeFileSync(new URL('./winterraps.json', import.meta.url), JSON.stringify(raps, null, 2) + '\n')
  writeFileSync(new URL('./ackerbohne.json', import.meta.url), JSON.stringify(bohne, null, 2) + '\n')

  console.log('Körnermais S. 206–219 …')
  verifyBbox(206, ['buehzeitpunkt', 'pflanzenlaenge', 'kaelteempfindlichkeit', 'lager', 'bestockung', 'staengelfaeule', 'kornertrag', 'tausendkornmasse', 'gesamttrockenmasse', 'staerkegehalt'])
  const mais = parseMais(extract(206, 219))
  console.log('  Mais:', summarize(mais, MAIS_FIELDS))
  writeFileSync(new URL('./koernermais.json', import.meta.url), JSON.stringify(mais, null, 2) + '\n')
  console.log('Sojabohne S. 283–284 …')
  verifyBbox(283, ['nabelfarbe', 'reife', 'pflanzenlaenge', 'lager', 'kornertrag', 'oelertrag', 'rohproteinertrag', 'oelgehalt', 'rohproteingehalt', 'tausendkornmasse'])
  const soja = parseSoja(extract(283, 284))
  console.log('  Soja:', summarize(soja, SOJA_FIELDS))
  writeFileSync(new URL('./sojabohne.json', import.meta.url), JSON.stringify(soja, null, 2) + '\n')
  console.log(`  Stichprobe Soja: ${soja[0]?.sortenname} ${SOJA_FIELDS.map(f => soja[0]?.[f]).join(' ')}`)
  console.log(`  Stichprobe Mais: ${mais[0]?.sortenname} K${mais[0]?.kornerreife} S${mais[0]?.siloreife} ${MAIS_FIELDS.map(f => mais[0]?.[f]).join(' ')}`)

  // Stichproben gegen Rohtext (erste Datenzeile je Kultur)
  const firstRaps = raps[0]
  const firstBohne = bohne[0]
  console.log(`  Stichprobe Raps: ${firstRaps?.sortenname} [${firstRaps?.zuechtyp}] ${RAPS_FIELDS.map(f => firstRaps?.[f]).join(' ')}`)
  console.log(`  Stichprobe Ackerbohne: ${firstBohne?.sortenname} ${BOHNE_FIELDS.map(f => firstBohne?.[f]).join(' ')}`)
}

main()
