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
  for (const match of bbox.matchAll(/<word xMin="([0-9.]+)" yMin="([0-9.]+)" xMax="([0-9.]+)" yMax="([0-9.]+)">([^<]+)<\/word>/g)) {
    const [, xMin, yMin, xMax, yMax, word] = match as unknown as [string, string, string, string, string, string]
    // Nur ROTIERTE Wörter zählen (hohe Box): die Legende unten auf der Seite
    // (z. B. "Ornamentierung des Korns: 1 = keine …") enthält dieselben Wörter
    // horizontal am linken Rand und würde die x-Ordnung verfälschen.
    const width = Number(xMax) - Number(xMin)
    const height = Number(yMax) - Number(yMin)
    if (height <= width * 1.5) continue
    if (expected.includes(word.toLowerCase()) || expected.some(field => word.toLowerCase() === field)) {
      hits.push([Number(xMin), word])
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


const RUEBE_FIELDS = [
  'cercospora', 'mehltau', 'ramularia', 'rost', 'ruebenfrischmasse',
  'bereinigter_zucker_ertrag', 'zuckergehalt', 'bereinigter_zuckergehalt',
  'kalium_natrium', 'aminostickstoff',
]

function parseRuebe(raw: string): Record[] {
  const records: Record[] = []
  let section = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || /^Seite\s+\d+/.test(trimmed)) continue
    if (/^Monogerme|^Polygerme|^Mit Voraussetzung|^In einem anderen EU-Land|^Ohne Voraussetzung|^Runkelrübe/.test(trimmed)) { section = trimmed.slice(0, 70); continue }
    let rest = trimmed
    let isNew = false
    if (rest.startsWith('neu ')) { isNew = true; rest = rest.slice(4) }
    // Fußnoten-Marker "1), 4)" innerhalb/ nach dem Namen entfernen und sammeln
    const footnotes: number[] = []
    rest = rest.replace(/\b(\d)\)/g, (_m, d) => { footnotes.push(Number(d)); return '' }).replace(/\s+,/g, ' ').replace(/,\s*$/g, '').replace(/\s+,/g, ' ').replace(/\s+/g, ' ').trim()
    const tokens = rest.split(' ')
    // Noten = die genau 10 Token direkt vor dem "ZR <nummer>"-Token (oder Zeilenende)
    const zrIndex = tokens.findIndex(t => t === 'ZR')
    const end = zrIndex >= 0 ? zrIndex : tokens.length
    const tail = tokens.slice(0, end)
    if (tail.length < RUEBE_FIELDS.length) continue
    const values = tail.slice(tail.length - RUEBE_FIELDS.length)
    const nameTokens = tail.slice(0, tail.length - RUEBE_FIELDS.length)
    if (!nameTokens.length) continue
    if (!values.every(token => token === '-' || /^[1-9]$/.test(token))) continue
    const record: Record = { sortenname: nameTokens.join(' '), section: section || 'unbekannt', is_new: isNew, footnotes }
    RUEBE_FIELDS.forEach((field, index) => { record[field] = values[index] === '-' ? null : Number(values[index]) })
    records.push(record)
  }
  return records
}

// ── M2a final: Senf, Lein, Lupine — letzte drei Notentabellen des Hefts ────
// Spaltenfolgen per pdftotext -bbox verifiziert (S. 250/256/276); WICHTIG:
// Senf und Lein haben trotz gleicher Deskriptoren VERSCHIEDENE Reihenfolgen —
// Senf: … lager < tausendkornmasse < kornertrag …, Lein: … kornertrag … < tausendkornmasse (zuletzt).

const SENF_FIELDS = [
  'buehbeginn', 'reife', 'pflanzenlaenge', 'lager', 'tausendkornmasse',
  'kornertrag', 'oelertrag', 'oelgehalt',
]

const LEIN_FIELDS = [
  'buehbeginn', 'pflanzenlaenge', 'reife', 'lager', 'kornertrag',
  'oelertrag', 'oelgehalt', 'tausendkornmasse',
]

const LUPINE_FIELDS = [
  'bitterstoffgehalt', 'determinierter_wuchs', 'bluetenfarbe', 'ornamentierung',
  'buehbeginn', 'reife', 'pflanzenlaenge', 'lager', 'tausendkornmasse',
  'kornertrag', 'rohproteinertrag', 'rohproteingehalt',
]

/**
 * Senf/Lein: Zeile = Name [+ Kornfarbe b/g nur Lein] + N Noten + Registry-Block.
 * Trailing-Anker = Token-Folge «<kenn> <2-3stellig> <4-stellige Jahreszahl>»
 * (Kenn-Nummer 'SF'/'LN' + Nummer + 'zugelassen seit'); dahinter stehen
 * Züchter-Nummer und ggf. (B)/(V)-Marker, die verworfen werden. Beispiel:
 * `Juliet b 6 5 6 6 4 3 4 5 LN 133 2002 404 (B) 10864` — Noten enden an 'LN'.
 */
function parseKennTable(raw: string, fields: string[], kennToken: string, farbeField: string | null): Record[] {
  const records: Record[] = []
  let section = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || /^Seite\s+\d+/.test(trimmed)) continue
    if (/^In Körnernutzung geprüft/.test(trimmed)) continue // kapitelkonstant, fließt nicht ins section-Feld
    if (/^Mit Voraussetzung|^In einem anderen EU-Land|^Ohne Voraussetzung|^Erucasäure/.test(trimmed)) {
      section = trimmed.replace(/\s+/g, ' ').slice(0, 70)
      continue
    }
    let rest = trimmed
    let isNew = false
    if (rest.startsWith('neu ')) { isNew = true; rest = rest.slice(4) }
    const tokens = rest.split(/\s+/)
    const kennIndex = tokens.findIndex((token, index) =>
      token === kennToken && /^\d{2,3}$/.test(tokens[index + 1] ?? '') && /^(19|20)\d{2}$/.test(tokens[index + 2] ?? ''))
    if (kennIndex < 0) continue
    const tail = tokens.slice(0, kennIndex)
    if (tail.length < fields.length) continue
    const values = tail.slice(tail.length - fields.length)
    const head = tail.slice(0, tail.length - fields.length)
    let farbe: string | null = null
    if (farbeField) {
      if (!head.length || !/^[bg]$/.test(head[head.length - 1]!)) continue
      farbe = head.pop()!
    }
    if (!head.length) continue
    if (!values.every(token => token === '-' || /^[1-9]$/.test(token))) continue
    const record: Record = { sortenname: head.join(' '), section: section || 'unbekannt', is_new: isNew, footnotes: [] }
    if (farbeField) record[farbeField] = farbe
    fields.forEach((field, index) => { record[field] = values[index] === '-' ? null : Number(values[index]) })
    records.push(record)
  }
  return records
}

/**
 * Lupine: zwei Arten-Abschnitte (Lupinus angustifolius / Lupinus albus — eine
 * dritte Art, Lupinus luteus, ist laut Erläuterungen S. 278 derzeit nicht
 * zugelassen) × Zulassungs-Status → beides ins section-Feld. Die Notentabelle
 * S. 276 hat KEINE Registry-Spalten (Ergänzende Angaben stehen ab S. 277 in
 * eigener Tabelle) — Zeile = Name + exakt 12 Noten, Trailing-Run-Ansatz.
 */
function parseLupine(raw: string): Record[] {
  const records: Record[] = []
  let species = ''
  let sub = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || /^Seite\s+\d+/.test(trimmed)) continue
    if (/^Blaue Lupine/.test(trimmed)) { species = 'Lupinus angustifolius'; continue }
    if (/^Weiße Lupine/.test(trimmed)) { species = 'Lupinus albus'; continue }
    if (/^Mit Voraussetzung|^In einem anderen EU-Land/.test(trimmed)) { sub = trimmed.replace(/\s+/g, ' ').slice(0, 40); continue }
    let rest = trimmed
    let isNew = false
    if (rest.startsWith('neu ')) { isNew = true; rest = rest.slice(4) }
    const tokens = rest.split(/\s+/)
    if (tokens.length < 1 + LUPINE_FIELDS.length) continue
    const values = tokens.slice(tokens.length - LUPINE_FIELDS.length)
    const nameTokens = tokens.slice(0, tokens.length - LUPINE_FIELDS.length)
    if (!nameTokens.length) continue
    if (!values.every(token => token === '-' || /^[1-9]$/.test(token))) continue
    const record: Record = {
      sortenname: nameTokens.join(' '),
      section: `${species || 'Lupinus'} — ${sub || 'unbekannt'}`,
      is_new: isNew,
      footnotes: [],
    }
    LUPINE_FIELDS.forEach((field, index) => { record[field] = values[index] === '-' ? null : Number(values[index]) })
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
  console.log('Zuckerrübe S. 291–292 …')
  const ruebe = parseRuebe(extract(291, 292))
  console.log('  Zuckerrübe:', summarize(ruebe, RUEBE_FIELDS))
  writeFileSync(new URL('./zuckerruebe.json', import.meta.url), JSON.stringify(ruebe, null, 2) + '\n')
  console.log(`  Stichprobe Rübe: ${ruebe[0]?.sortenname} ${RUEBE_FIELDS.map(f => ruebe[0]?.[f]).join(' ')}`)

  console.log('Senf S. 250 …')
  verifyBbox(250, SENF_FIELDS.map(field => field.replace(/_/g, '')))
  const senf = parseKennTable(extract(250, 250), SENF_FIELDS, 'SF', null)
  console.log('  Senf:', summarize(senf, SENF_FIELDS))
  writeFileSync(new URL('./senf.json', import.meta.url), JSON.stringify(senf, null, 2) + '\n')
  console.log(`  Stichprobe Senf: ${senf[0]?.sortenname} ${SENF_FIELDS.map(f => senf[0]?.[f]).join(' ')} / letzte: ${senf[senf.length - 1]?.sortenname} ${SENF_FIELDS.map(f => senf[senf.length - 1]?.[f]).join(' ')}`)

  console.log('Lein S. 256 …')
  verifyBbox(256, LEIN_FIELDS.map(field => field.replace(/_/g, '')))
  const lein = parseKennTable(extract(256, 256), LEIN_FIELDS, 'LN', 'kornfarbe')
  console.log('  Lein:', summarize(lein, LEIN_FIELDS))
  writeFileSync(new URL('./lein.json', import.meta.url), JSON.stringify(lein, null, 2) + '\n')
  console.log(`  Stichprobe Lein: ${lein[0]?.sortenname} [${lein[0]?.kornfarbe}] ${LEIN_FIELDS.map(f => lein[0]?.[f]).join(' ')} / letzte: ${lein[lein.length - 1]?.sortenname} [${lein[lein.length - 1]?.kornfarbe}] ${LEIN_FIELDS.map(f => lein[lein.length - 1]?.[f]).join(' ')}`)

  console.log('Lupine S. 276 …')
  verifyBbox(276, LUPINE_FIELDS.map(field => field.replace(/_/g, '')))
  const lupine = parseLupine(extract(276, 276))
  console.log('  Lupine:', summarize(lupine, LUPINE_FIELDS))
  writeFileSync(new URL('./lupine.json', import.meta.url), JSON.stringify(lupine, null, 2) + '\n')
  console.log(`  Stichprobe Lupine: ${lupine[0]?.sortenname} ${LUPINE_FIELDS.map(f => lupine[0]?.[f]).join(' ')} / letzte: ${lupine[lupine.length - 1]?.sortenname} ${LUPINE_FIELDS.map(f => lupine[lupine.length - 1]?.[f]).join(' ')}`)
  console.log(`  Stichprobe Mais: ${mais[0]?.sortenname} K${mais[0]?.kornerreife} S${mais[0]?.siloreife} ${MAIS_FIELDS.map(f => mais[0]?.[f]).join(' ')}`)

  // Stichproben gegen Rohtext (erste Datenzeile je Kultur)
  const firstRaps = raps[0]
  const firstBohne = bohne[0]
  console.log(`  Stichprobe Raps: ${firstRaps?.sortenname} [${firstRaps?.zuechtyp}] ${RAPS_FIELDS.map(f => firstRaps?.[f]).join(' ')}`)
  console.log(`  Stichprobe Ackerbohne: ${firstBohne?.sortenname} ${BOHNE_FIELDS.map(f => firstBohne?.[f]).join(' ')}`)
}

main()
