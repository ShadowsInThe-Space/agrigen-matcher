/**
 * AgriGen Matcher MVP demo — kernel-based variety matching on EURISCO
 * sample data. Two deliberately separated mechanisms (GC6):
 *
 *  1. Catalog core: masked RBF kernel K(x,y) = exp(-γ·d̄²) on normalized
 *     [0,1] traits. The full-mask catalog kernel matrix is kept purely as a
 *     DIAGNOSTIC object (rank + smallest eigenvalue with a conditional PSD
 *     check, Fix M2) — it is not the ranking path.
 *  2. Query scoring: one-sided hinge terms (satisficing) on the active
 *     requirement dimensions with a subspace γ (median heuristic restricted
 *     to the query mask, Fix P6), reported with catalog percentiles (Fix P2).
 *     This is query scoring, NOT a kernel: asymmetric in (query, candidate),
 *     no PSD guarantee, no RKHS reading (see scoring.ts).
 *
 * Run (Node >= 22.18, no flags): node mvp/demo.ts
 */

import { readFileSync } from 'node:fs'
import { dimensionNormalizedRbf, medianHeuristicGamma, validateFeatureRanges } from './kernelMath.ts'
import { matrixRank, symmetricEigenvalues } from './metrics.ts'
import { percentileOf, queryGamma, scoreCandidate } from './scoring.ts'
import { buildCatalog, extractRequirements, TRAIT_NAMES, type AccessionRecord, type Catalog, type FarmingRequirements } from './traits.ts'

const DATA_PATH = new URL('../data/sample_eurisco.json', import.meta.url)

const TOP_K = 5
const PSD_TOLERANCE = -1e-10
const TIE_THRESHOLD = 0.01
const NAME_WIDTH = 38
const SCORE_HEADER = 'Query-Score (dim.)'

interface Scenario {
  title: string
  subtitle: string
  requirements: FarmingRequirements
}

/**
 * Expectation check (code comment only, never printed, Brief 5): with hinge
 * query scoring, scenario A must promote the drought class — Sorghum
 * bicolor 'DesertKing' (drought 10, heat 10, lowest water requirement)
 * satisfies every requirement exactly, so its score is exactly 1 and the
 * sunflower/maize class follows. Scenario C must rank the legumes (Vicia
 * faba, Glycine max) ahead of cereals, which only works with group-wise
 * yield normalization (Fix P1) — the old global min-max buried every grain
 * crop at the bottom of the yield axis.
 */
const SCENARIOS: Scenario[] = [
  {
    title: 'SZENARIO A — Dürre & Hitze (Südeuropa)',
    subtitle: 'Extreme Trockenheit, hohe Hitze, knappe Wasserressourcen, mäßige Salinität',
    requirements: { droughtTolerance: 'extreme', heatTolerance: 'high', waterAvailability: 'low', salinityTolerance: 'moderate' },
  },
  {
    title: 'SZENARIO B — Kälte & kurze Saison (Nordeuropa)',
    subtitle: 'Extreme Kälte, kurze Vegetationsperiode, hoher Resistenzzüchtungsdruck',
    requirements: { coldTolerance: 'extreme', seasonLength: 'short', diseaseResistance: 'high' },
  },
  {
    title: 'SZENARIO C — Leguminosen-Screening / Low-Input',
    subtitle: 'Maximale Stickstoff-Effizienz, hoher Ertragsfokus, moderate Wasserlage',
    requirements: { nitrogenEfficiency: 'extreme', yieldPriority: 'high', waterAvailability: 'moderate' },
  },
]

interface ScoredCandidate {
  id: string
  label: string
  score: number
  percentile: number
}

function loadCatalog(): Catalog {
  const records: AccessionRecord[] = JSON.parse(readFileSync(DATA_PATH, 'utf8'))
  if (!Array.isArray(records) || records.length === 0) throw new Error('EURISCO dataset is empty')
  return buildCatalog(records)
}

/** Score every catalog candidate against one query (hinge scoring, Fix P4/P6) and attach percentiles (Fix P2). */
function rankedMatches(
  catalog: Catalog,
  requirements: FarmingRequirements,
): { matches: ScoredCandidate[], gamma: number, activeDimensions: string[] } {
  const { vector, mask, directions } = extractRequirements(requirements)
  const gamma = queryGamma(catalog.rows, mask)
  const allScores = catalog.rows.map(row => scoreCandidate(vector, row, mask, gamma, directions))
  const matches: ScoredCandidate[] = catalog.ids
    .map((id, index) => ({
      id,
      label: catalog.labels[index]!,
      score: allScores[index]!,
      percentile: percentileOf(allScores[index]!, allScores),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
  const activeDimensions = TRAIT_NAMES.filter((_, index) => mask[index] === 1)
  return { matches, gamma, activeDimensions }
}

/**
 * Exact 1.0 means every hinge term is zero, i.e. the candidate fulfills ALL
 * requirements (over-fulfillment is free). The cell stays a plain number;
 * the fulfillment is flagged in a footnote line below the table, so rows
 * keep a compact fixed width and 1.000 cannot be misread as a "100% match".
 */
function scoreCell(score: number): string {
  return score.toFixed(3)
}

/** 1-based rank pairs of consecutive candidates that are practically tied (gap < threshold). */
function tiedPairs(matches: ScoredCandidate[], threshold: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (let index = 1; index < matches.length; index++) {
    if (matches[index - 1]!.score - matches[index]!.score < threshold) pairs.push([index, index + 1])
  }
  return pairs
}

/** Print a comma-separated list wrapped at `width`, continuation lines indented by 4 spaces. */
function printWrapped(prefix: string, items: string[], width = 74): void {
  const indent = '    '
  let line = prefix
  for (const item of items) {
    const candidate = line === prefix ? `${line}${item}` : `${line}, ${item}`
    if (candidate.length > width && line !== prefix) {
      console.log(line + ',')
      line = `${indent}${item}`
    } else {
      line = candidate
    }
  }
  console.log(line)
}

function main(): void {
  const catalog = loadCatalog()
  const n = catalog.rows.length
  const dimensions = catalog.rows[0]!.length

  // Trust boundary: the kernel expects pre-normalized [0,1] features.
  validateFeatureRanges(catalog.rows)

  // Catalog kernel matrix over ALL dimensions with ONE fixed mask — the
  // precondition for PSD (and thus the RKHS reading). Diagnostic only (M2):
  // ranking happens through hinge query scoring, not through this matrix.
  const fullMask = new Array(dimensions).fill(1)
  const catalogGamma = medianHeuristicGamma(catalog.rows)
  const kernelMatrix = catalog.rows.map(rowA =>
    catalog.rows.map(rowB => dimensionNormalizedRbf(rowA, rowB, fullMask, catalogGamma)),
  )
  const rank = matrixRank(kernelMatrix)
  const trace = kernelMatrix.reduce((sum, row, i) => sum + row[i]!, 0)
  const minEigenvalue = Math.min(...symmetricEigenvalues(kernelMatrix))
  const psdOk = minEigenvalue >= PSD_TOLERANCE

  const line = '─'.repeat(74)
  console.log('╔' + '═'.repeat(72) + '╗')
  console.log('║ AgriGen Matcher — kernel-basiertes Sorten-Matching (MVP)'.padEnd(73) + '║')
  console.log('║ RBF-Katalog-Kern · Hinge-Query-Scoring · Perzentil-Ranking'.padEnd(73) + '║')
  console.log('╚' + '═'.repeat(72) + '╝')
  console.log(`Katalog: ${n} EURISCO-Accessionen × ${dimensions} Traits (normalisiert [0,1])`)
  console.log(`Katalog-Kern γ (Median-Heuristik, volle Maske) = ${catalogGamma.toFixed(4)}`)
  console.log(
    `Kernel-Matrix ${n}×${n} (Diagnose): Rang ${rank}/${n} · Spur ${trace.toFixed(3)} · `
    + `min-λ = ${minEigenvalue.toExponential(2)} (${psdOk ? 'PSD ✓' : 'PSD ✗'})`,
  )
  if (!psdOk) {
    console.error('Kernel-Matrix ist nicht positiv semidefinit — RKHS-Interpretation ungültig, Abbruch.')
    process.exit(1)
  }
  console.log(line)

  for (const scenario of SCENARIOS) {
    const { matches, gamma, activeDimensions } = rankedMatches(catalog, scenario.requirements)
    const scoreWidth = Math.max(SCORE_HEADER.length, ...matches.map(match => scoreCell(match.score).length))
    console.log()
    console.log(scenario.title)
    console.log(`  ${scenario.subtitle}`)
    printWrapped(`  Aktive Query-Dimensionen (${activeDimensions.length}/${dimensions}): `, activeDimensions)
    console.log(`  Teilraum-γ (Median-Heuristik im Query-Subraum) = ${gamma.toFixed(4)}`)
    console.log(
      `  ${'Rang'.padEnd(5)} ${'Accession'.padEnd(11)} ${'Sorte'.padEnd(NAME_WIDTH)} ${SCORE_HEADER.padEnd(scoreWidth)} Perzentil`,
    )
    matches.forEach((match, position) => {
      const name = match.label.length > NAME_WIDTH ? `${match.label.slice(0, NAME_WIDTH - 1)}…` : match.label
      console.log(
        `  ${String(position + 1).padEnd(5)} ${match.id.padEnd(11)} ${name.padEnd(NAME_WIDTH)} `
        + `${scoreCell(match.score).padEnd(scoreWidth)} besser als ${match.percentile.toFixed(1)} % des Katalogs`,
      )
    })
    for (const [position, match] of matches.entries()) {
      if (match.score === 1) {
        console.log(`  * Rang ${position + 1} erfüllt das Anforderungsprofil vollständig`)
      }
    }
    const ties = tiedPairs(matches, TIE_THRESHOLD)
    if (ties.length > 0) {
      for (const [upperRank, lowerRank] of ties) {
        console.log(
          `  → Rang ${upperRank} und ${lowerRank} praktisch gleichwertig `
          + `(Score-Abstand < ${TIE_THRESHOLD.toFixed(3)})`,
        )
      }
    } else {
      const [first, second] = matches
      console.log(
        `  → Abstand Rang 1 zu Rang 2: ${(first!.score - second!.score).toFixed(3)} `
        + `· Perzentil ${first!.percentile.toFixed(1)} % vs. ${second!.percentile.toFixed(1)} %`,
      )
    }
    console.log(line)
  }

  console.log()
  console.log('Katalog-Ähnlichkeit: RBF-Kernel — feste Maske → positiv definit → echter RKHS; Kernelwert = RKHS-Kosinus.')
  console.log('Anfrage-Scoring: einseitige Hinge-Terme (Satisficing) im Query-Subraum — Query-Scoring, kein Kernel.')
}

main()
