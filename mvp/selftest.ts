/**
 * Port self-test: verifies the kernel core invariants after the SeedShuffle →
 * AgriGen port and the query-scoring semantics (scoring.ts/traits.ts), using
 * only pure functions. Run (Node >= 22.18, no flags):
 *   node mvp/selftest.ts
 */

import {
  cosineSimilarity, dimensionNormalizedRbf, medianHeuristicGamma, reciprocalRankFusion,
  rbfKernel, validateAlpha, validateFeatureRanges, validateGamma,
} from './kernelMath.ts'
import { matrixRank, symmetricEigenvalues } from './metrics.ts'
import { percentileOf, queryGamma, scoreCandidate, TRAIT_DIRECTIONS } from './scoring.ts'
import { buildCatalog, CROP_GROUPS, extractRequirements, TRAIT_NAMES, type AccessionRecord } from './traits.ts'

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

check('percentileOf: Anteil strikt kleinerer Scores', percentileOf(0.5, [0.1, 0.5, 0.9]) === 100 / 3)
check('percentileOf: bester Score = 100', percentileOf(1, [0.1, 0.2]) === 100)
check('percentileOf: leere Population neutral (50)', percentileOf(0.7, []) === 50)

const gammaRows = [[0, 0, 0.9], [1, 1, 0.1], [0.5, 0.5, 0.5]]
const gammaFull = medianHeuristicGamma(gammaRows)
const gammaSub = queryGamma(gammaRows, [1, 0, 0])
check('queryGamma: Teilraum-γ weicht ab, endlich und > 0',
  gammaSub !== gammaFull && Number.isFinite(gammaSub) && gammaSub > 0)

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

console.log('─'.repeat(64))
console.log(`Ergebnis: ${passed} PASS, ${failed} FAIL`)
if (failed > 0) process.exit(1)
