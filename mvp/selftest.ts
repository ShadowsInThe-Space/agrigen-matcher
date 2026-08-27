/**
 * Port self-test: verifies the kernel core invariants after the SeedShuffle →
 * AgriGen port, using only pure functions. Run:
 *   node --experimental-strip-types mvp/selftest.ts
 */

import {
  cosineSimilarity, dimensionNormalizedRbf, medianHeuristicGamma, reciprocalRankFusion,
  rbfKernel, validateAlpha, validateFeatureRanges, validateGamma,
} from './kernelMath.ts'
import { matrixRank, symmetricEigenvalues } from './metrics.ts'

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

console.log('─'.repeat(64))
console.log(`Ergebnis: ${passed} PASS, ${failed} FAIL`)
if (failed > 0) process.exit(1)
