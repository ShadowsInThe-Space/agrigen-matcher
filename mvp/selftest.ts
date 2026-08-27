/**
 * Port self-test: verifies the kernel core invariants after the SeedShuffle →
 * AgriGen port and the query-scoring semantics (scoring.ts/traits.ts), using
 * only pure functions — plus gold values pinned against a REAL run on the
 * EURISCO sample catalog (γ, min-λ, per-scenario Top-1), the PSD
 * counterexample for varying masks, and the Jacobi eigenvalue solver.
 * Run (Node >= 22.18, no flags):
 *   node mvp/selftest.ts
 */

import { readFileSync } from 'node:fs'
import {
  assertFixedScoringMask, cosineSimilarity, dimensionNormalizedRbf, medianHeuristicGamma,
  reciprocalRankFusion, rbfKernel, validateAlpha, validateFeatureRanges, validateGamma,
} from './kernelMath.ts'
import { matrixRank, symmetricEigenvalues } from './metrics.ts'
import { percentileOf, queryGamma, queryGammaSampled, rankCandidates, scoreCandidate, TRAIT_DIRECTIONS } from './scoring.ts'
import { loadBsaUnionCatalog, UNION_TRAIT_NAMES, UNION_DIRECTIONS } from './bsaCatalog.ts'
import {
  buildCatalog, CROP_GROUPS, extractRequirements, TRAIT_NAMES, WIZARD_TOLERANCE,
  type AccessionRecord, type Catalog, type FarmingRequirements,
} from './traits.ts'

let passed = 0
let failed = 0

function check(name: string, condition: boolean): void {
  if (condition) { passed++; console.log(`  PASS  ${name}`) } else { failed++; console.log(`  FAIL  ${name}`) }
}

function throws(fn: () => unknown): boolean {
  try { fn(); return false } catch { return true }
}

const identity = (n: number) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0))

console.log('AgriGen kernelMath port — self-test')
console.log('─'.repeat(64))

check('rbf(x, x) === 1', rbfKernel([0.2, 0.8], [0.2, 0.8], 2.5) === 1)
check('rbf symmetrisch', rbfKernel([0.1, 0.9], [0.7, 0.3], 1.5) === rbfKernel([0.7, 0.3], [0.1, 0.9], 1.5))
check('rbf monoton fallend in Distanz',
  rbfKernel([0, 0], [0.2, 0], 2) > rbfKernel([0, 0], [0.6, 0], 2) &&
  rbfKernel([0, 0], [0.6, 0], 2) > rbfKernel([0, 0], [1, 0], 2))
check('validateGamma lehnt 0 und Negative ab', throws(() => validateGamma(0)) && throws(() => validateGamma(-1)))
check('validateAlpha lehnt 1.5 ab', throws(() => validateAlpha(1.5)))
check('validateFeatureRanges lehnt 1.5 ab', throws(() => validateFeatureRanges([[1.5]])))
check('cosine identischer Vektoren === 1', Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-12)
check('cosine orthogonaler Vektoren === 0', Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-12)

const rows = [[0, 0], [1, 1]]
const gamma = medianHeuristicGamma(rows)
check(`Median-Heuristik: γ = 1/(2·d̄²) (${gamma.toFixed(4)})`, Math.abs(gamma - 1 / (2 * 1)) < 1e-12)
check('γ > 0 und endlich', Number.isFinite(gamma) && gamma > 0)

const allZeroMask = [0, 0]
check('leerer Query ist neutral (Score 1)', dimensionNormalizedRbf([0.5, 0.5], [0.1, 0.9], allZeroMask, gamma) === 1)

const rrf = reciprocalRankFusion([
  [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.5 }, { id: 'c', score: 0.3 }],
  [{ id: 'c', score: 0.8 }, { id: 'a', score: 0.4 }],
])
check('RRF: in beiden Listen vorne gewinnt', rrf[0]!.id === 'a')

check('Rang(Einheitsmatrix) = n', matrixRank(identity(6)) === 6)
check('Rang(All-Einsen-Matrix) = 1', matrixRank([[1, 1, 1], [1, 1, 1], [1, 1, 1]]) === 1)
const eig = symmetricEigenvalues(identity(4))
check('Eigenwerte der Einheitsmatrix alle 1', eig.every(value => Math.abs(value - 1) < 1e-9))

// Jacobi solver on a NON-trivial symmetric matrix (Fix M4): A = Q·diag(1,2,3)·Qᵀ
// with Q = G₁₂(0.7)·G₀₁(0.3) — a product of two Givens rotations (orthogonal by
// construction) that occupies every off-diagonal cell of A. Eigenvalues of A are
// rotation-invariant, so they must come back as exactly {1, 2, 3}.
const matMul = (a: number[][], b: number[][]) =>
  a.map(row => b[0]!.map((_, j) => row.reduce((sum, v, k) => sum + v * b[k]![j]!, 0)))
const c1 = Math.cos(0.3), s1 = Math.sin(0.3), c2 = Math.cos(0.7), s2 = Math.sin(0.7)
const rotation = matMul([[1, 0, 0], [0, c2, -s2], [0, s2, c2]], [[c1, -s1, 0], [s1, c1, 0], [0, 0, 1]])
const rotatedDiagonal = matMul(
  matMul(rotation, [[1, 0, 0], [0, 2, 0], [0, 0, 3]]),
  rotation[0]!.map((_, j) => rotation.map(row => row[j]!)),
)
const jacobiEigenvalues = symmetricEigenvalues(rotatedDiagonal).sort((x, y) => x - y)
check('Jacobi: rotierte diag(1,2,3) → Eigenwerte {1,2,3} je ±1e-9',
  jacobiEigenvalues.every((value, i) => Math.abs(value - (i + 1)) < 1e-9))

console.log('Query-Scoring (Hinge) & Trait-Richtungen')
console.log('─'.repeat(64))

check('TRAIT_DIRECTIONS statisch für alle Traits außer growing_days',
  TRAIT_NAMES.every(name => name === 'growing_days' || TRAIT_DIRECTIONS[name] !== undefined))
const vecAt = (name: string, value: number, fill = 0): number[] => {
  const vector = new Array<number>(TRAIT_NAMES.length).fill(fill)
  vector[TRAIT_NAMES.indexOf(name)] = value
  return vector
}
const maskOf = (name: string): number[] => TRAIT_NAMES.map(trait => trait === name ? 1 : 0)
check('Hinge benefit: Übererfüllung kostet nichts',
  scoreCandidate(vecAt('drought_tolerance', 0.9), vecAt('drought_tolerance', 1.0), maskOf('drought_tolerance'), 1, { drought_tolerance: 'benefit' }) === 1)
check('Hinge benefit: Fehlbetrag wird bestraft',
  scoreCandidate(vecAt('drought_tolerance', 0.9), vecAt('drought_tolerance', 0.5), maskOf('drought_tolerance'), 1, { drought_tolerance: 'benefit' }) === Math.exp(-0.16))
check('Hinge cost: Unterschreiten kostet nichts',
  scoreCandidate(vecAt('water_requirement', 0.15), vecAt('water_requirement', 0.0), maskOf('water_requirement'), 1, { water_requirement: 'cost' }) === 1)
check('Hinge cost: Überschuss wird bestraft',
  scoreCandidate(vecAt('water_requirement', 0.15), vecAt('water_requirement', 0.55), maskOf('water_requirement'), 1, { water_requirement: 'cost' }) === Math.exp(-0.16))
check('Hinge target: zweiseitig symmetrisch',
  scoreCandidate(vecAt('soil_ph_min', 0.5), vecAt('soil_ph_min', 0.7), maskOf('soil_ph_min'), 1, { soil_ph_min: 'target' }) ===
  scoreCandidate(vecAt('soil_ph_min', 0.5), vecAt('soil_ph_min', 0.3), maskOf('soil_ph_min'), 1, { soil_ph_min: 'target' }))
check('Score ohne aktive Query-Dimension neutral (1)',
  scoreCandidate(vecAt('drought_tolerance', 0.9), vecAt('drought_tolerance', 0.1), new Array(TRAIT_NAMES.length).fill(0), 2, {}) === 1)
check('Nur aktive Query-Dimensionen zählen',
  scoreCandidate(vecAt('drought_tolerance', 0.9, 0.9), vecAt('drought_tolerance', 0.9, 0.1), maskOf('drought_tolerance'), 5, { drought_tolerance: 'benefit' }) === 1)
check('Aktive Dimension ohne Richtung wird abgelehnt',
  throws(() => scoreCandidate(vecAt('drought_tolerance', 0.5), vecAt('drought_tolerance', 0.5), maskOf('drought_tolerance'), 1, {})))
check('Hinge benefit asymmetrisch: score(q,x) < score(x,q) — deklariert (Query-Scoring, kein Kernel)',
  scoreCandidate(vecAt('drought_tolerance', 0.9), vecAt('drought_tolerance', 0.5), maskOf('drought_tolerance'), 1, { drought_tolerance: 'benefit' }) === Math.exp(-0.16) &&
  scoreCandidate(vecAt('drought_tolerance', 0.5), vecAt('drought_tolerance', 0.9), maskOf('drought_tolerance'), 1, { drought_tolerance: 'benefit' }) === 1)

check('percentileOf: Anteil strikt kleinerer Scores', percentileOf(0.5, [0.1, 0.5, 0.9]) === 100 / 3)
check('percentileOf: bester Score = 100', percentileOf(1, [0.1, 0.2]) === 100)
check('percentileOf: leere Population neutral (50)', percentileOf(0.7, []) === 50)

const gammaRows = [[0, 0, 0.9], [1, 1, 0.1], [0.5, 0.5, 0.5]]
const gammaFull = medianHeuristicGamma(gammaRows)
const gammaSub = queryGamma(gammaRows, [1, 0, 0])
check('queryGamma: Teilraum-γ weicht ab, endlich und > 0',
  gammaSub !== gammaFull && Number.isFinite(gammaSub) && gammaSub > 0)

// ── Loop-Iteration 2: Kernel-Tiebreaker in rankCandidates ────────────────
{
  const twoDimMask = TRAIT_NAMES.map(trait => trait === 'drought_tolerance' || trait === 'root_depth' ? 1 : 0)
  const dir2 = { drought_tolerance: 'benefit', root_depth: 'benefit' }
  const row = (drought: number, root: number): number[] => {
    const vector = new Array<number>(TRAIT_NAMES.length).fill(0)
    vector[TRAIT_NAMES.indexOf('drought_tolerance')] = drought
    vector[TRAIT_NAMES.indexOf('root_depth')] = root
    return vector
  }
  const query = row(0.9, 0.5)
  const tie = rankCandidates([row(1.0, 0.9), row(1.0, 0.5)], query, twoDimMask, 1, dir2)
  check('Tiebreaker: Score-Gleichstand wird nach Profilähnlichkeit aufgelöst',
    tie[0]!.score === tie[1]!.score && tie[0]!.similarity > tie[1]!.similarity)
  const prio = rankCandidates([row(0.89, 0.5), row(1.0, 0.9)], query, twoDimMask, 1, dir2)
  check('Tiebreaker überschreibt Satisficing nicht: Fehlbetrag verliert trotz höherer Ähnlichkeit',
    prio[0]!.score > prio[1]!.score && prio[0]!.similarity < prio[1]!.similarity)
  const selfFirst = rankCandidates([row(1.0, 0.9), query], query, twoDimMask, 1, dir2)
  check('Tiebreaker: Selbst-Retrieval gewinnt den Gleichstand (Similarität exakt 1)',
    selfFirst[0]!.similarity === 1)
}

const req = extractRequirements({
  nitrogenEfficiency: 'extreme', yieldPriority: 'high', waterAvailability: 'moderate', seasonLength: 'short',
})
check('extractRequirements: statische Richtungen (benefit/cost) nur für aktive Dimensionen',
  req.directions.nitrogen_efficiency === 'benefit' && req.directions.yield_potential === 'benefit' &&
  req.directions.water_requirement === 'cost' && req.directions.growing_days === 'cost' &&
  Object.keys(req.directions).length === 4)
check('growing_days-Richtung dynamisch (long→benefit, medium→target)',
  extractRequirements({ seasonLength: 'long' }).directions.growing_days === 'benefit' &&
  extractRequirements({ seasonLength: 'medium' }).directions.growing_days === 'target')

check('CROP_GROUPS: Leguminosen-Gruppe vollständig',
  ['Glycine', 'Phaseolus', 'Vicia'].every(genus => CROP_GROUPS[genus] === 'legume'))
const mkRecord = (genus: string, yieldValue: number): AccessionRecord => ({
  accession_id: 'TEST', genus, species: 'test', cultivar: 'Test', origin_country: 'DE',
  biological_status: 'Bred_cultivar',
  traits: {
    drought_tolerance: 5, heat_tolerance: 5, cold_tolerance: 5, disease_resistance: 5,
    soil_ph_min: 6, soil_ph_max: 7, growing_days: 150, yield_potential_t_ha: yieldValue,
    water_requirement_mm: 500, nitrogen_efficiency: 5, salinity_tolerance: 5, root_depth_cm: 100,
  },
})
const yieldIndex = TRAIT_NAMES.indexOf('yield_potential')
const groupCatalog = buildCatalog([mkRecord('Triticum', 6), mkRecord('Zea', 12), mkRecord('Glycine', 4)])
check('Crop-Group-Ertrag: Gruppen-min 0 / Gruppen-max 1 / Einzelgruppe neutral 0.5',
  groupCatalog.rows[0]![yieldIndex] === 0 && groupCatalog.rows[1]![yieldIndex] === 1 &&
  groupCatalog.rows[2]![yieldIndex] === 0.5)

console.log('assertFixedScoringMask — feste Maske als PSD-Voraussetzung')
console.log('─'.repeat(64))

const fixedMask = [1, 0, 1]
check('assertFixedScoringMask: identische Masks (undefined ausgenommen) akzeptiert',
  !throws(() => assertFixedScoringMask([fixedMask, undefined, fixedMask])))
check('assertFixedScoringMask: alle undefined akzeptiert',
  !throws(() => assertFixedScoringMask([undefined, undefined])))
check('assertFixedScoringMask: variierende Masks werfen',
  throws(() => assertFixedScoringMask([fixedMask, [0, 1, 1]])))

// PSD counterexample from the professor's review — the documented limit of
// VARYING per-point masks. The mask is attached to the point; mask-disjoint
// pairs are neutralized to K = 1 while mask-sharing pairs see the real
// projected distance. Construction: 4 points [1,0],[0,1],[0,0],[1,0] with
// masks (1,0),(0,1),(1,0),(0,1) and γ = 50 gives
//   K(1,3) = K(2,4) = exp(−50·1) ≈ 1.9e−22, all other entries 1,
// i.e. unit diagonal but spectrum {3, 1, 1, exp(−γ)−1} → min-λ ≈ −1 < 0.
// NOTE: the literal points [1,0],[0,1],[1,0],[0,1] from the brief yield the
// all-ones matrix (rank 1, min-λ = 0, PSD at the boundary, NOT indefinite)
// because mask-sharing pairs coincide — the mask partners must be apart by 1
// in their shared dimension for indefiniteness to materialize. This test pins
// the boundary: K(z,z) = 1 everywhere ALONE does not make an RKHS cosine.
const psdPoints = [[1, 0], [0, 1], [0, 0], [1, 0]]
const psdMasks = [[1, 0], [0, 1], [1, 0], [0, 1]]
const psdGamma = 50
const psdMatrix = psdPoints.map((p, i) =>
  psdPoints.map((q, j) => dimensionNormalizedRbf(p, q, psdMasks[i]!, psdGamma, psdMasks[j]!)))
const psdMinEigenvalue = Math.min(...symmetricEigenvalues(psdMatrix))
check(`PSD-Gegenbeispiel (variierende Masks): K(z,z)=1 überall, aber min-λ = ${psdMinEigenvalue.toFixed(3)} < 0`,
  psdMatrix.every((row, i) => row[i] === 1) && psdMinEigenvalue < 0)

console.log('Goldwerte — echter EURISCO-Katalog (Stand f8a2c09)')
console.log('─'.repeat(64))

/**
 * Gold values extracted from a REAL run at commit f8a2c09 against
 * data/eurisco_150.json (150 accessions). Regenerate by replicating demo.ts:
 *   catalog:  buildCatalog(JSON.parse(readFileSync('../data/eurisco_150.json')))
 *   γ:        medianHeuristicGamma(catalog.rows)                       [volle Maske]
 *   min-λ:    symmetricEigenvalues over K = dimensionNormalizedRbf(a, b, fullMask, γ)
 *   Top-1:    extractRequirements → queryGamma(catalog.rows, mask) →
 *             scoreCandidate je Zeile → Sortierung desc → ids[0]         (je Szenario)
 * Tolerances: γ |diff| < 5e-4 (1e-3 raster), min-λ strict > 0, Top-1 exact
 * string compare. A Top-1 flip or γ drift beyond tolerance is a scoring
 * regression and must fail this suite.
 */
const GOLD_CATALOG_GAMMA = 4.595706962331078
const GOLD_TOP1: Readonly<Record<'A' | 'B' | 'C', string>> = { A: 'EUR-116', B: 'EUR-102', C: 'EUR-066' }

const DATA_PATH = new URL('../data/eurisco_150.json', import.meta.url)
function loadCatalog(): Catalog {
  const records: AccessionRecord[] = JSON.parse(readFileSync(DATA_PATH, 'utf8'))
  if (!Array.isArray(records) || records.length === 0) throw new Error('EURISCO dataset is empty')
  return buildCatalog(records)
}

const goldCatalog = loadCatalog()
validateFeatureRanges(goldCatalog.rows)
const goldDimensions = goldCatalog.rows[0]!.length
const goldFullMask = new Array<number>(goldDimensions).fill(1)

/** Directions for an active mask: growing_days is query-dependent → 'target' default here. */
function goldDirectionsFor(mask: number[]): Record<string, 'benefit' | 'cost' | 'target'> {
  const directions: Record<string, 'benefit' | 'cost' | 'target'> = {}
  TRAIT_NAMES.forEach((name, index) => {
    if (mask[index]) directions[name] = name === 'growing_days' ? 'target' : TRAIT_DIRECTIONS[name] ?? 'target'
  })
  return directions
}

const goldGamma = medianHeuristicGamma(goldCatalog.rows)
check(`Gold: Katalog-γ (Median-Heuristik, volle Maske) = ${goldGamma.toFixed(4)} ± 5e-4`,
  Math.abs(goldGamma - GOLD_CATALOG_GAMMA) < 5e-4)
const goldKernel = goldCatalog.rows.map(rowA =>
  goldCatalog.rows.map(rowB => dimensionNormalizedRbf(rowA, rowB, goldFullMask, goldGamma)))
const goldMinEigenvalue = Math.min(...symmetricEigenvalues(goldKernel))
check(`Gold: Kernel-Matrix PSD, min-λ = ${goldMinEigenvalue.toExponential(2)} strikt > 0`,
  goldMinEigenvalue > 0)

const GOLD_SCENARIOS: ReadonlyArray<['A' | 'B' | 'C', FarmingRequirements]> = [
  ['A', { droughtTolerance: 'extreme', heatTolerance: 'high', waterAvailability: 'low', salinityTolerance: 'moderate' }],
  ['B', { coldTolerance: 'extreme', seasonLength: 'short', diseaseResistance: 'high' }],
  ['C', { nitrogenEfficiency: 'extreme', yieldPriority: 'high', waterAvailability: 'moderate' }],
]
/** Mirrors demo.ts rankedMatches: rankCandidates (score + kernel tiebreak). */
function topAccession(catalog: Catalog, requirements: FarmingRequirements): string {
  const { vector, mask, directions } = extractRequirements(requirements)
  const gamma = queryGamma(catalog.rows, mask)
  return catalog.ids[rankCandidates(catalog.rows, vector, mask, gamma, directions, WIZARD_TOLERANCE)[0]!.index]!
}
for (const [key, requirements] of GOLD_SCENARIOS) {
  check(`Gold: Szenario ${key} Top-1 = ${GOLD_TOP1[key]}`,
    topAccession(goldCatalog, requirements) === GOLD_TOP1[key])
}

const goldRowOf = (id: string): number[] => goldCatalog.rows[goldCatalog.ids.indexOf(id)]!
// Crop-Group-Pins gemessen am eurisco_150-Datensatz (Generator-Seed 20260827,
// data/generate-150.ts); Gruppen-Minima/Maxima ändern sich mit jeder
// Regeneration — Werte dann neu messen, nicht raten.
check(`Crop-Group real: Weizen-Ertrag in cereal-Gruppe = 0.5204 (Katalog-relativ)`,
  Math.abs(goldRowOf('EUR-001')![yieldIndex]! - 0.520408163265306) < 1e-9)
check('Crop-Group real: Beta = 0.8397 (root_tuber, unterhalb Gruppenmaximum)',
  Math.abs(goldRowOf('EUR-007')![yieldIndex]! - 0.839662447257384) < 1e-9)
check('Crop-Group real: Solanum = 0.2068 (root_tuber, über Gruppenminimum)',
  Math.abs(goldRowOf('EUR-004')![yieldIndex]! - 0.206751054852321) < 1e-9)
check('Crop-Group real: Helianthus = 0.5385 (oilseed, 8-Member-Gruppe)',
  Math.abs(goldRowOf('EUR-010')![yieldIndex]! - 0.538461538461539) < 1e-9)

// ── Loop-Iteration 9: Genauigkeits-Deckel gepinnt (stille Regressionsschutz) ──
{
  const identityOk = goldCatalog.rows.every((row, index) =>
    rankCandidates(goldCatalog.rows, row, goldFullMask, goldGamma, goldDirectionsFor(goldFullMask), WIZARD_TOLERANCE)[0]!.index === index)
  check('Deckel: Identity-Retrieval 12/12 (Selbst auf Rang 1 unter Vollmaske)', identityOk)

  // Partial identity, k=4, drei feste Seeds (deterministisch, schnell).
  let partialHits = 0
  let partialTrials = 0
  for (let seed = 1; seed <= 3; seed++) {
    const randomState = { state: seed >>> 0 }
    const random = () => {
      randomState.state = (randomState.state + 0x6d2b79f5) | 0
      let t = Math.imul(randomState.state ^ (randomState.state >>> 15), 1 | randomState.state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const mask = new Array<number>(goldDimensions).fill(0)
    const dims = [...Array<number>(goldDimensions).keys()]
    for (let draw = 0; draw < 4; draw++) {
      const pick = Math.floor(random() * dims.length)
      mask[dims.splice(pick, 1)[0]!] = 1
    }
    const gamma = queryGamma(goldCatalog.rows, mask)
    const directions = goldDirectionsFor(mask)
    for (let index = 0; index < goldCatalog.rows.length; index++) {
      if (rankCandidates(goldCatalog.rows, goldCatalog.rows[index]!, mask, gamma, directions, WIZARD_TOLERANCE)[0]!.index === index) partialHits++
      partialTrials++
    }
  }
  check(`Deckel: Partielles Identity-Retrieval k=4 = 100 % (${partialHits}/${partialTrials})`,
    partialHits === partialTrials)
}

// ── Loop-It 36: BSA-Echtdaten-Deckel gepinnt (224 offizielle BSL-2026-Sorten) ──
{
  const union = loadBsaUnionCatalog()
  const unionGamma = medianHeuristicGamma(union.rows, union.observationMasks, UNION_TRAIT_NAMES.map(() => 1))
  check(`BSA-Real: 273 Sorten über 5 Fruchtarten im Union-Space (aktuell ${union.rows.length})`,
    union.rows.length === 273)
  const byCrop: Record<string, number[]> = {}
  union.crops.forEach((crop, index) => { (byCrop[crop] ??= []).push(index) })
  const ceilings: Record<string, number> = { Weizen: 1, Gerste: 1, Roggen: 1, Dinkel: 1, Hafer: 0.94 }
  for (const [crop, indexes] of Object.entries(byCrop)) {
    let top1 = 0
    for (const i of indexes) {
      const ranked = rankCandidates(union.rows, union.rows[i]!, union.observationMasks[i]!, unionGamma, UNION_DIRECTIONS, 0, union.observationMasks, UNION_TRAIT_NAMES)
      if (ranked[0]!.index === i) top1++
    }
    const observed = top1 / indexes.length
    check(`BSA-Real: Identity ${crop} top-1 ${(observed).toFixed(4)} ≥ ${(ceilings[crop] ?? 1).toFixed(2)} (${top1}/${indexes.length})`,
      observed >= (ceilings[crop] ?? 1) - 1e-9)
  }
}

// ── Loop-It 29: Toleranzband (Dead-Zone δ) ────────────────────────────────
check('Toleranzband: Kandidat innerhalb des Bands ist frei',
  scoreCandidate(vecAt('drought_tolerance', 0.5), vecAt('drought_tolerance', 0.42), maskOf('drought_tolerance'), 1, { drought_tolerance: 'benefit' }, 0.1) === 1)
check('Toleranzband: Fehlbetrag zählt erst ab Bandkante (exp(−0.01), milder als ohne Band exp(−0.04))',
  Math.abs(scoreCandidate(vecAt('drought_tolerance', 0.5), vecAt('drought_tolerance', 0.3), maskOf('drought_tolerance'), 1, { drought_tolerance: 'benefit' }, 0.1) - Math.exp(-0.01)) < 1e-12 &&
  Math.abs(scoreCandidate(vecAt('drought_tolerance', 0.5), vecAt('drought_tolerance', 0.3), maskOf('drought_tolerance'), 1, { drought_tolerance: 'benefit' }) - Math.exp(-0.04)) < 1e-12)
check('Toleranzband: target-Dim zweiseitig mit Dead-Zone',
  Math.abs(scoreCandidate(vecAt('soil_ph_min', 0.5), vecAt('soil_ph_min', 0.62), maskOf('soil_ph_min'), 1, { soil_ph_min: 'target' }, 0.1) - Math.exp(-0.0004)) < 1e-12)
check('Null-Überlappung: Kandidat ohne gemeinsame Beobachtung ist KEIN Match (Score 0)',
  scoreCandidate(vecAt('drought_tolerance', 0.9), vecAt('drought_tolerance', 0.5), maskOf('drought_tolerance'), 1, { drought_tolerance: 'benefit' }, 0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) === 0)

check('Toleranzband: negatives δ wird abgelehnt',
  throws(() => scoreCandidate(vecAt('drought_tolerance', 0.5), vecAt('drought_tolerance', 0.5), maskOf('drought_tolerance'), 1, { drought_tolerance: 'benefit' }, -0.1)))

// ── Loop-It 16/18: gesampelter γ + Duplikat-Guard ─────────────────────────
{
  check('queryGammaSampled: kleiner Katalog = voller Fallback (identisch)',
    queryGammaSampled(goldCatalog.rows, goldFullMask, 500, 1) === queryGamma(goldCatalog.rows, goldFullMask))
  const bigRows = Array.from({ length: 600 }, (_, i) =>
    Array.from({ length: goldDimensions }, (_, d) => ((i * 37 + d * 11) % 97) / 96))
  const bigFull = new Array<number>(goldDimensions).fill(1)
  const bigGammaFull = medianHeuristicGamma(bigRows)
  const bigGammaSampled = queryGammaSampled(bigRows, bigFull, 200, 3)
  check('queryGammaSampled: endliches γ nahe voller Heuristik (±20 %)',
    Number.isFinite(bigGammaSampled) && bigGammaSampled > 0 &&
    Math.abs(bigGammaSampled - bigGammaFull) / bigGammaFull < 0.2)

  const twinTraits = {
    drought_tolerance: 5, heat_tolerance: 5, cold_tolerance: 5, disease_resistance: 5,
    soil_ph_min: 6, soil_ph_max: 7, growing_days: 200, yield_potential_t_ha: 7,
    water_requirement_mm: 550, nitrogen_efficiency: 5, salinity_tolerance: 5, root_depth_cm: 100,
  }
  const twins: AccessionRecord[] = [
    { accession_id: 'D1', genus: 'Triticum', species: 'aestivum', cultivar: 'A', origin_country: 'X', biological_status: 'Bred_cultivar', traits: { ...twinTraits } },
    { accession_id: 'D2', genus: 'Hordeum', species: 'vulgare', cultivar: 'B', origin_country: 'Y', biological_status: 'Bred_cultivar', traits: { ...twinTraits } },
  ]
  check('Duplikat-Guard: identische Trait-Vektoren werden als Datenfehler abgelehnt',
    throws(() => buildCatalog(twins)))
}

console.log('─'.repeat(64))
console.log(`Ergebnis: ${passed} PASS, ${failed} FAIL`)
if (failed > 0) process.exit(1)
