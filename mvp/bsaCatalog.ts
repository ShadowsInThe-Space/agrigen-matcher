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
