/**
 * Pure Hilbert-space kernel utilities.
 *
 * Ported verbatim from the SeedShuffle production kernel
 * (seedshuffle_aistudio/server/utils/kernelMath.ts, battle-tested by 27
 * unit tests). Domain-general core — the only change is the removal of the
 * strain-specific ACTIVE_FEATURES constant, which lives in traits.ts here.
 *
 * Values and masks must share one feature order. A non-zero mask value means
 * observed/active. Missing observations never become an invented midpoint.
 */

export type FeatureMask = readonly number[]
const FALLBACK_GAMMA = 1

function assertFiniteVector(vector: readonly number[], label: string): void {
  if (vector.some(value => !Number.isFinite(value))) {
    throw new Error(`${label} must contain only finite numeric components`)
  }
}

function assertSameDimensions(a: readonly number[], b: readonly number[], label: string): void {
  if (a.length !== b.length) throw new Error(`${label} must have the same dimension`)
}

function observed(mask: FeatureMask | undefined, index: number): boolean {
  return mask === undefined || mask[index] !== 0
}

function assertMaskDimensions(mask: FeatureMask | undefined, dimensions: number, label: string): void {
  if (mask !== undefined && mask.length !== dimensions) {
    throw new Error(`${label} must have the same dimension as its feature vector`)
  }
}

/** Reject invalid linear-fusion weights instead of silently changing ranking. */
export function validateAlpha(alpha: number): number {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error('alpha must be a finite number in [0, 1]')
  }
  return alpha
}

/** Reject invalid RBF widths instead of producing NaN or inverted scoring. */
export function validateGamma(gamma: number): number {
  if (!Number.isFinite(gamma) || gamma <= 0) {
    throw new Error('gamma must be a finite number greater than 0')
  }
  return gamma
}

/** Cosine similarity. A zero vector deliberately has neutral similarity 0. */
export function cosineSimilarity(a: number[], b: number[]): number {
  assertSameDimensions(a, b, 'Cosine vectors')
  assertFiniteVector(a, 'Cosine vector')
  assertFiniteVector(b, 'Cosine vector')
  let maxA = 0
  let maxB = 0
  for (let index = 0; index < a.length; index++) {
    maxA = Math.max(maxA, Math.abs(a[index]!))
    maxB = Math.max(maxB, Math.abs(b[index]!))
  }
  if (maxA === 0 || maxB === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let index = 0; index < a.length; index++) {
    const ai = a[index]! / maxA
    const bi = b[index]! / maxB
    dot += ai * bi
    na += ai * ai
    nb += bi * bi
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** RBF (Gaussian) kernel: K(x,y) = exp(-gamma * ||x-y||²). */
export function rbfKernel(q: number[], x: number[], gamma: number): number {
  assertSameDimensions(q, x, 'RBF vectors')
  assertFiniteVector(q, 'RBF vector')
  assertFiniteVector(x, 'RBF vector')
  validateGamma(gamma)
  let sqDist = 0
  for (let index = 0; index < q.length; index++) {
    const diff = q[index]! - x[index]!
    sqDist += diff * diff
  }
  return Math.exp(-gamma * sqDist)
}

/**
 * Mean squared distance over dimensions observed by both inputs and enabled by
 * the current active feature set. `null` means no comparable dimension.
 */
export function maskedMeanSquaredDistance(
  a: readonly number[],
  b: readonly number[],
  leftMask?: FeatureMask,
  rightMask?: FeatureMask,
  activeMask?: FeatureMask,
): number | null {
  assertSameDimensions(a, b, 'Feature vectors')
  assertFiniteVector(a, 'Feature vector')
  assertFiniteVector(b, 'Feature vector')
  assertMaskDimensions(leftMask, a.length, 'Left feature mask')
  assertMaskDimensions(rightMask, a.length, 'Right feature mask')
  assertMaskDimensions(activeMask, a.length, 'Active feature mask')
  let squaredDistance = 0
  let dimensions = 0
  for (let index = 0; index < a.length; index++) {
    if (!observed(leftMask, index) || !observed(rightMask, index) || !observed(activeMask, index)) continue
    const diff = a[index]! - b[index]!
    squaredDistance += diff * diff
    dimensions++
  }
  return dimensions === 0 ? null : squaredDistance / dimensions
}

/**
 * Derive the reusable nonconstant feature mask from observed catalog values.
 * A requested active mask can only disable dimensions; it cannot re-enable a
 * zero-variance one.
 */
export function getNonConstantFeatureMask(
  rows: readonly (readonly number[])[],
  observationMasks?: readonly FeatureMask[],
  activeMask?: FeatureMask,
): number[] {
  if (rows.length === 0) return []
  const dimensions = rows[0]!.length
  assertMaskDimensions(activeMask, dimensions, 'Active feature mask')
  if (observationMasks !== undefined && observationMasks.length !== rows.length) {
    throw new Error('Observation mask count must match feature row count')
  }
  const minima = new Array<number | undefined>(dimensions).fill(undefined)
  const maxima = new Array<number | undefined>(dimensions).fill(undefined)
  rows.forEach((row, rowIndex) => {
    assertSameDimensions(row, rows[0]!, 'Feature rows')
    assertFiniteVector(row, 'Feature row')
    const observationMask = observationMasks?.[rowIndex]
    assertMaskDimensions(observationMask, dimensions, 'Observation mask')
    for (let index = 0; index < dimensions; index++) {
      if (!observed(activeMask, index) || !observed(observationMask, index)) continue
      const value = row[index]!
      minima[index] = minima[index] === undefined ? value : Math.min(minima[index]!, value)
      maxima[index] = maxima[index] === undefined ? value : Math.max(maxima[index]!, value)
    }
  })
  return minima.map((minimum, index) => minimum !== undefined && maxima[index] !== minimum ? 1 : 0)
}

/**
 * Masked RBF: query intent, candidate observations, and catalog activity must
 * all agree before a dimension contributes. No comparable dimension is neutral.
 * For RBF, K(x,x) = 1, so this kernel value IS the RKHS cosine similarity.
 */
export function dimensionNormalizedRbf(
  query: number[],
  candidate: number[],
  queryMask: FeatureMask,
  gamma: number,
  candidateObservationMask?: FeatureMask,
  activeFeatureMask?: FeatureMask,
): number {
  validateGamma(gamma)
  const distance = maskedMeanSquaredDistance(
    query, candidate, queryMask, candidateObservationMask, activeFeatureMask,
  )
  return distance === null ? 1 : Math.exp(-gamma * distance)
}

/**
 * Median heuristic using exactly the mean-squared metric used at runtime.
 * Pairwise masks are intersected, zero-variance dimensions removed, and pairs
 * with no comparable feature skipped. Degenerate data gets a safe width.
 */
export function medianHeuristicGamma(
  rows: readonly number[][],
  observationMasks?: readonly FeatureMask[],
  activeMask?: FeatureMask,
): number {
  if (rows.length < 2) return FALLBACK_GAMMA
  const nonConstantMask = getNonConstantFeatureMask(rows, observationMasks, activeMask)
  if (!nonConstantMask.some(Boolean)) return FALLBACK_GAMMA
  const distances: number[] = []
  for (let left = 0; left < rows.length; left++) {
    for (let right = left + 1; right < rows.length; right++) {
      const distance = maskedMeanSquaredDistance(
        rows[left]!, rows[right]!, observationMasks?.[left], observationMasks?.[right], nonConstantMask,
      )
      if (distance !== null) distances.push(distance)
    }
  }
  const positiveDistances = distances.filter(distance => distance > 0)
  if (positiveDistances.length === 0) return FALLBACK_GAMMA
  positiveDistances.sort((a, b) => a - b)
  const median = positiveDistances[Math.floor(positiveDistances.length / 2)]!
  return median > 0 && Number.isFinite(median) ? 1 / (2 * median) : FALLBACK_GAMMA
}

/** Validate normalized feature artifacts at their trust boundary. */
export function validateFeatureRanges(rows: number[][], tolerance = 0.001): void {
  for (const row of rows) {
    for (const value of row) {
      if (!Number.isFinite(value) || value < -tolerance || value > 1 + tolerance) {
        throw new Error(`Feature value ${value} is out of [0,1] range. Ensure the catalog dataset contains pre-normalized values.`)
      }
    }
  }
}

export interface RankedItem { id: string | number, score: number }
export interface RRFScoredItem { id: string | number, rrf_score: number }

export function reciprocalRankFusion(rankedLists: RankedItem[][], k = 60): RRFScoredItem[] {
  const rrfScores = new Map<string | number, number>()
  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      const contribution = 1 / (k + rank + 1)
      rrfScores.set(item.id, (rrfScores.get(item.id) || 0) + contribution)
    })
  }
  return [...rrfScores]
    .map(([id, rrf_score]) => ({ id, rrf_score }))
    .sort((a, b) => b.rrf_score - a.rrf_score)
}
