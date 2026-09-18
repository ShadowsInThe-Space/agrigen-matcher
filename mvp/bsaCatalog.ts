// SPDX-License-Identifier: AGPL-3.0-or-later
// AgriGen Matcher · Copyright (C) 2026 Marc-Dennis Haberland (Adaptive AI Solutions)
// Kommerzielle Lizenz ohne Copyleft: hallo@adaptive-ai-solutions.de
/**
 * BSA real-data catalog: official Bundessortenamt winter wheat notes
 * (Beschreibende Sortenliste Getreide 2026, parsed by data/bsa/parse-wheat.ts)
 * mapped into the AgriGen 12-trait space with observation masks.
 *
 * This is the M2-lite "adapt the algorithm to the available data" path:
 * dimensions the BSL does not observe stay masked (never imputed); the
 * masked kernel was designed for exactly this (loop pass 14, user directive).
 *
 * Trait mapping (documented, invertible):
 *   disease_resistance ← worst-case resistance over observed diseases:
 *     BSL "Anfälligkeit" notes 1–9 (1 = low susceptibility); resistance
 *     rating = 10 − note ∈ [1, 9]; a variety is as vulnerable as its weakest
 *     resistance → min over {Mehltau, Gelbrost, Braunrost, Blattseptoria,
 *     Ährenfusarium, Drechslera, Pseudocercosporella}.
 *   growing_days  ← Reife note (1–9, 1 = early); same axis semantics as the
 *     EURISCO growing_days (relative maturity within the crop).
 *   yield_potential ← mean(Kornertrag Stufe 1, Stufe 2) (1–9).
 *   nitrogen_efficiency — BSL N-Efficiency table not yet joined (v1); masked.
 *   all other dimensions — not observed by BSL; masked.
 *
 * BSL notes are 1–9 (not 1–10 like EURISCO ratings): normalizer (v−1)/8.
 * Varieties with no observed notes at all (49 in the source) are dropped —
 * they carry no information for matching.
 */

import { readFileSync } from 'node:fs'
import type { AccessionRecord, Catalog } from './traits.ts'
import { TRAIT_NAMES } from './traits.ts'

export interface BslWheatRecord {
  sortenname: string
  section: string
  is_new: boolean
  footnotes: number[]
  reife: number | null
  aehrenschieben: number | null
  pflanzenlaenge: number | null
  lager: number | null
  mehltau: number | null
  gelbrost: number | null
  braunrost: number | null
  blattseptoria: number | null
  aehrenfusarium: number | null
  drechslera: number | null
  pseudocercosporella: number | null
  bestandesdichte: number | null
  kornzahl_aehre: number | null
  tausendkornmasse: number | null
  kornertrag_st1: number | null
  kornertrag_st2: number | null
}

export interface BsaCatalog extends Catalog {
  observationMasks: number[][]
}

const DISEASES: (keyof BslWheatRecord)[] = [
  'mehltau', 'gelbrost', 'braunrost', 'blattseptoria',
  'aehrenfusarium', 'drechslera', 'pseudocercosporella',
]

const note1to9 = (note: number): number => (note - 1) / 8

export function buildBsaCatalog(records: BslWheatRecord[]): BsaCatalog {
  const usable = records.filter(record => record.reife !== null || DISEASES.some(key => record[key] !== null))
  const idx = (name: string) => TRAIT_NAMES.indexOf(name as (typeof TRAIT_NAMES)[number])

  // min-max over usable records for mapped dimensions (catalog-relative,
  // same contract as the physical dims in the EURISCO path).
  const maturityNotes = usable.map(r => r.reife).filter((v): v is number => v !== null)
  const yieldNotes = usable
    .map(r => [r.kornertrag_st1, r.kornertrag_st2].filter((v): v is number => v !== null))
    .filter(values => values.length > 0)
    .map(values => values.reduce((a, b) => a + b, 0) / values.length)

  const rows: number[][] = []
  const observationMasks: number[][] = []
  const ids: string[] = []
  const labels: string[] = []

  for (const record of usable) {
    const row = new Array<number>(TRAIT_NAMES.length).fill(0)
    const mask = new Array<number>(TRAIT_NAMES.length).fill(0)

    // disease_resistance: worst-case over observed resistances
    const resistances = DISEASES
      .map(key => record[key])
      .filter((v): v is number => v !== null)
      .map(note => 10 - note)
    if (resistances.length > 0) {
      const worst = Math.min(...resistances)
      row[idx('disease_resistance')] = note1to9(worst)
      mask[idx('disease_resistance')] = 1
    }

    // growing_days: relative maturity within the catalog
    if (record.reife !== null && maturityNotes.length > 1) {
      const min = Math.min(...maturityNotes)
      const max = Math.max(...maturityNotes)
      row[idx('growing_days')] = max === min ? 0.5 : (record.reife - min) / (max - min)
      mask[idx('growing_days')] = 1
    }

    // yield_potential: mean of available yield notes, relative within catalog
    const yields = [record.kornertrag_st1, record.kornertrag_st2].filter((v): v is number => v !== null)
    if (yields.length > 0 && yieldNotes.length > 1) {
      const mean = yields.reduce((a, b) => a + b, 0) / yields.length
      const min = Math.min(...yieldNotes)
      const max = Math.max(...yieldNotes)
      row[idx('yield_potential')] = max === min ? 0.5 : (mean - min) / (max - min)
      mask[idx('yield_potential')] = 1
    }

    ids.push(record.sortenname.replace(/\s+/g, '-'))
    labels.push(`Triticum aestivum '${record.sortenname}' (${record.section.includes('EU-Land') ? 'EU' : 'DE'})`)
    rows.push(row)
    observationMasks.push(mask)
  }

  return { ids, labels, rows, observationMasks }
}

export function loadBsaCatalog(): BsaCatalog {
  const records: BslWheatRecord[] = JSON.parse(
    readFileSync(new URL('../data/bsa/winterweizen.json', import.meta.url), 'utf8'))
  return buildBsaCatalog(records)
}

// AccessionRecord compatibility helper (for tooling that expects the interface).
export function asAccessionRecords(records: BslWheatRecord[]): AccessionRecord[] {
  return records.map(record => ({
    accession_id: record.sortenname.replace(/\s+/g, '-'),
    genus: 'Triticum', species: 'aestivum', cultivar: record.sortenname,
    origin_country: record.section.includes('EU-Land') ? 'EU' : 'Germany',
    biological_status: 'Bred_cultivar',
    traits: {},
  }))
}

// ═══════════════════════════════════════════════════════════════════════════
// Native BSL trait space (It 33): individual descriptors as dimensions —
// 7 single resistances instead of the worst-case aggregate + morphology and
// yield notes. Much finer resolution than the 12-trait squeeze.
// ═══════════════════════════════════════════════════════════════════════════

export const BSL_TRAIT_NAMES = [
  'mehltau', 'gelbrost', 'braunrost', 'blattseptoria', 'aehrenfusarium',
  'drechslera', 'pseudocercosporella', 'lager', 'reife', 'pflanzenlaenge',
  'bestandesdichte', 'kornzahl_aehre', 'tausendkornmasse', 'kornertrag_st1', 'kornertrag_st2',
] as const

/**
 * Directions in the native BSL space:
 *  - susceptibilities (diseases, lodging) are 'cost' — BSL 1 = low = good
 *  - reife is 'cost' (early maturity bias: harvest logistics + drought escape;
 *    the dominant preference in German wheat practice — documented assumption)
 *  - morphology (height, stand density) is 'target' — two-sided preferences
 *  - yield components are 'benefit'
 */
export const BSL_DIRECTIONS: Readonly<Record<string, 'benefit' | 'cost' | 'target'>> = {
  mehltau: 'cost', gelbrost: 'cost', braunrost: 'cost', blattseptoria: 'cost',
  aehrenfusarium: 'cost', drechslera: 'cost', pseudocercosporella: 'cost',
  lager: 'cost', reife: 'cost',
  pflanzenlaenge: 'target', bestandesdichte: 'target',
  kornzahl_aehre: 'benefit', tausendkornmasse: 'benefit',
  kornertrag_st1: 'benefit', kornertrag_st2: 'benefit',
}

export function buildBsaNativeCatalog(records: BslWheatRecord[]): BsaCatalog {
  const usable = records.filter(record =>
    BSL_TRAIT_NAMES.some(name => record[name as keyof BslWheatRecord] !== null))
  const rows: number[][] = []
  const observationMasks: number[][] = []
  const ids: string[] = []
  const labels: string[] = []
  for (const record of usable) {
    const row: number[] = []
    const mask: number[] = []
    for (const name of BSL_TRAIT_NAMES) {
      const note = record[name as keyof BslWheatRecord]
      if (typeof note === 'number') {
        row.push((note - 1) / 8)
        mask.push(1)
      } else {
        row.push(0)
        mask.push(0)
      }
    }
    ids.push(record.sortenname.replace(/\s+/g, '-'))
    labels.push(`Triticum aestivum '${record.sortenname}' (${record.section.includes('EU-Land') ? 'EU' : 'DE'})`)
    rows.push(row)
    observationMasks.push(mask)
  }
  return { ids, labels, rows, observationMasks }
}

export function loadBsaNativeCatalog(): BsaCatalog {
  const records: BslWheatRecord[] = JSON.parse(
    readFileSync(new URL('../data/bsa/winterweizen.json', import.meta.url), 'utf8'))
  return buildBsaNativeCatalog(records)
}

// ═══════════════════════════════════════════════════════════════════════════
// Union trait space across all five BSL crops (It 34): every descriptor any
// crop observes becomes a dimension; varieties mask what they lack. Cross-
// crop queries run on the naturally shared subspace (mehltau, lager, reife,
// bestandesdichte, kornertrag …) — the masked kernel needs no schema rape.
// ═══════════════════════════════════════════════════════════════════════════

export const UNION_TRAIT_NAMES = [
  'aehrenschieben', 'reife', 'reifeverzoegerung_stroh', 'pflanzenlaenge', 'lager',
  'halmknicken', 'aehrenknicken', 'mehltau', 'gelbrost', 'braunrost', 'blattseptoria',
  'aehrenfusarium', 'drechslera', 'pseudocercosporella', 'netzflecken', 'rhynchosporium',
  'ramularia', 'zwergrost', 'gelbmosaik_baymv1', 'gelbmosaik_baymv2',
  'gerstengelbverzwergung', 'mutterkorn', 'bestandesdichte', 'kornzahl_aehre',
  'kernzahl_aehre', 'kornzahl_rispe', 'tausendkornmasse', 'tausendkernmasse',
  'kornertrag_st1', 'kornertrag_st2', 'vesenertrag_st1', 'vesenertrag_st2',
  'sortierung_2_0', 'sortierung_2_5', 'hektolitergewicht', 'spelzenanteil',
  'anteil_nicht_entspelzter_koerner',
  'buehbeginn', 'tanningehalt', 'ascochyta', 'botrytis', 'rost',
  'kornertrag', 'oelertrag', 'oelgehalt', 'rohproteinertrag', 'rohproteingehalt', 'glucosinolatgehalt',
  'buehzeitpunkt_weiblich', 'kaelteempfindlichkeit_jugend', 'bestockung',
  'staengelfaeule', 'silo_gesamttrockenmasse', 'staerkegehalt', 'nabelfarbe',
  'cercospora', 'ruebenfrischmasse', 'bereinigter_zucker_ertrag', 'zuckergehalt',
  'bereinigter_zuckergehalt', 'kalium_natrium', 'aminostickstoff',
  'bitterstoffgehalt', 'determinierter_wuchs', 'bluetenfarbe', 'ornamentierung',
] as const

/** Hafer: Rispenschieben ist das phänologische Pendant zum Ährenschieben (dokumentierte Analogie). */
const UNION_ALIASES: Readonly<Record<string, string>> = { rispenschieben: 'aehrenschieben' }

export const UNION_DIRECTIONS: Readonly<Record<string, 'benefit' | 'cost' | 'target'>> = {
  aehrenschieben: 'target', reife: 'cost', reifeverzoegerung_stroh: 'target',
  pflanzenlaenge: 'target', bestandesdichte: 'target', spelzenanteil: 'target',
  lager: 'cost', halmknicken: 'cost', aehrenknicken: 'cost',
  mehltau: 'cost', gelbrost: 'cost', braunrost: 'cost', blattseptoria: 'cost',
  aehrenfusarium: 'cost', drechslera: 'cost', pseudocercosporella: 'cost',
  netzflecken: 'cost', rhynchosporium: 'cost', ramularia: 'cost', zwergrost: 'cost',
  gelbmosaik_baymv1: 'cost', gelbmosaik_baymv2: 'cost', gerstengelbverzwergung: 'cost',
  mutterkorn: 'cost', anteil_nicht_entspelzter_koerner: 'cost',
  kornzahl_aehre: 'benefit', kernzahl_aehre: 'benefit', kornzahl_rispe: 'benefit',
  tanningehalt: 'cost', ascochyta: 'cost', botrytis: 'cost', rost: 'cost', glucosinolatgehalt: 'cost',
  buehbeginn: 'target', buehzeitpunkt_weiblich: 'target',
  kaelteempfindlichkeit_jugend: 'cost', bestockung: 'cost', staengelfaeule: 'cost',
  silo_gesamttrockenmasse: 'benefit', staerkegehalt: 'benefit',
  nabelfarbe: 'target', // Farbcodierung, kosmetisch — zweiseitig neutral
  cercospora: 'cost',
  ruebenfrischmasse: 'benefit', bereinigter_zucker_ertrag: 'benefit',
  zuckergehalt: 'benefit', bereinigter_zuckergehalt: 'benefit',
  kalium_natrium: 'cost', aminostickstoff: 'cost', // niedrige Gehalte = Qualität
  // Lupine: Bitterstoffgehalt 1 = bitterstoffarm → cost (Alkaloid-Inhaltsstoff,
  // niedrig = gut); Wuchstyp determiniert/indeterminiert und die Farbcodes
  // Blütenfarbe/Ornamentierung sind zweiseitig neutral (analog nabelfarbe).
  bitterstoffgehalt: 'cost', determinierter_wuchs: 'target',
  bluetenfarbe: 'target', ornamentierung: 'target',
  oelertrag: 'benefit', oelgehalt: 'benefit', rohproteinertrag: 'benefit', rohproteingehalt: 'benefit',
  kornertrag: 'benefit', // Lücke seit It 34: plain kornertrag (Raps/Bohne/Mais/Soja/Senf/Lein/Lupine)
  tausendkornmasse: 'benefit', tausendkernmasse: 'benefit',
  kornertrag_st1: 'benefit', kornertrag_st2: 'benefit',
  vesenertrag_st1: 'benefit', vesenertrag_st2: 'benefit',
  sortierung_2_0: 'benefit', sortierung_2_5: 'benefit', hektolitergewicht: 'benefit',
}

type LooseRecord = Record<string, unknown> & { sortenname: string; section: string; zuechtyp?: string | null; form?: string }

const CROP_FILES: ReadonlyArray<[string, string, string]> = [
  ['winterweizen.json', 'Triticum aestivum', 'Weizen'],
  ['wintergerste.json', 'Hordeum vulgare', 'Gerste'],
  ['wintergerste2.json', 'Hordeum vulgare', 'Gerste'],
  ['winterroggen.json', 'Secale cereale', 'Roggen'],
  ['dinkel.json', 'Triticum spelta', 'Dinkel'],
  ['hafer.json', 'Avena sativa', 'Hafer'],
  ['winterraps.json', 'Brassica napus', 'Raps'],
  ['ackerbohne.json', 'Vicia faba', 'Ackerbohne'],
  ['koernermais.json', 'Zea mays', 'Mais'],
  ['sojabohne.json', 'Glycine max', 'Sojabohne'],
  ['zuckerruebe.json', 'Beta vulgaris', 'Zuckerrübe'],
  ['senf.json', 'Sinapis alba', 'Senf'],
  ['lein.json', 'Linum usitatissimum', 'Lein'],
  ['lupine.json', 'Lupinus', 'Lupine'],
]

export interface UnionCatalog extends BsaCatalog {
  crops: string[]
}

/** Minimum observed descriptors for a variety to be matchable (It 35):
 *  BSL records describing only the 3-dim virus block cannot be meaningfully
 *  matched — same data-hygiene philosophy as the duplicate guard. */
export const MIN_OBSERVED_DIMS = 8

export function loadBsaUnionCatalog(): UnionCatalog {
  const rows: number[][] = []
  const observationMasks: number[][] = []
  const ids: string[] = []
  const labels: string[] = []
  const crops: string[] = []
  let droppedForCoverage = 0
  for (const [file, latin, crop] of CROP_FILES) {
    const records = JSON.parse(readFileSync(new URL(`../data/bsa/${file}`, import.meta.url), 'utf8')) as LooseRecord[]
    for (const record of records) {
      const row = new Array<number>(UNION_TRAIT_NAMES.length).fill(0)
      const mask = new Array<number>(UNION_TRAIT_NAMES.length).fill(0)
      let observed = 0
      for (const [rawKey, rawValue] of Object.entries(record)) {
        const key = UNION_ALIASES[rawKey] ?? rawKey
        const index = UNION_TRAIT_NAMES.indexOf(key as (typeof UNION_TRAIT_NAMES)[number])
        if (index >= 0 && typeof rawValue === 'number') {
          row[index] = (rawValue - 1) / 8
          mask[index] = 1
          observed++
        }
      }
      if (observed < MIN_OBSERVED_DIMS) {
        if (observed > 0) droppedForCoverage++
        continue
      }
      const typeSuffix = typeof record.zuechtyp === 'string' && record.zuechtyp ? ` [${record.zuechtyp}]` : ''
      const formSuffix = typeof record.form === 'string' && record.form === 'zweizeilig' ? ', 2-zeilig' : ''
      // Lupine: Artspezifika stehen im section-Feld ("Lupinus angustifolius — …")
      const lupinusSpecies = record.section.startsWith('Lupinus ') ? record.section.split(' — ')[0]! : ''
      const latinName = lupinusSpecies || latin
      ids.push(record.sortenname.replace(/\s+/g, '-'))
      labels.push(`${latinName} '${record.sortenname}'${typeSuffix}${formSuffix} (${crop})`)
      crops.push(crop)
      rows.push(row)
      observationMasks.push(mask)
    }
  }
  if (droppedForCoverage > 0) {
    console.log(`  Datenhygiene: ${droppedForCoverage} Records mit < ${MIN_OBSERVED_DIMS} beobachteten Deskriptoren ausgeschlossen (nicht sinnvoll matchbar)`)
  }
  return { ids, labels, rows, observationMasks, crops }
}
