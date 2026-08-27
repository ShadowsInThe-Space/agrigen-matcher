/**
 * Query scoring for the AgriGen Matcher — asymmetric hinge scoring (Fix P4).
 *
 * IMPORTANT (GC6): this module is QUERY SCORING, not a kernel. The scoring
 * map is asymmetric in (query, candidate): one-sided hinge terms penalize
 * only requirement violations (satisficing), never over-fulfillment. It is
 * therefore not symmetric and not positive semi-definite — there is no RKHS
 * reading and no kernel matrix to be built from it. The catalog kernel
 * remains the masked RBF in kernelMath.ts (source of truth, untouched by
 * this change); scoreCandidate/percentileOf only rank catalog candidates
 * against one farmer query on the active query dimensions.
 */

import { dimensionNormalizedRbf, medianHeuristicGamma, validateGamma, type FeatureMask } from './kernelMath.ts'
import { TRAIT_NAMES } from './traits.ts'

export type TraitDirection = 'benefit' | 'cost' | 'target'

/**
 * Static trait directions (Fix P4).
 *   benefit — more is better; only a shortfall against the query is penalized
 *   cost    — less is better; only exceeding the query is penalized
 *   target  — two-sided squared distance to the query
 * growing_days is deliberately absent: its direction depends on the query
 * (seasonLength 'short' → cost, 'long' → benefit, 'medium' → target) and is
 * derived per query in extractRequirements (traits.ts), not statically.
 */
export const TRAIT_DIRECTIONS: Readonly<Record<string, TraitDirection>> = {
  drought_tolerance: 'benefit',
  heat_tolerance: 'benefit',
  cold_tolerance: 'benefit',
  disease_resistance: 'benefit',
  nitrogen_efficiency: 'benefit',
  salinity_tolerance: 'benefit',
  yield_potential: 'benefit',
  root_depth: 'benefit', // deeper roots = more robust (drought resilience)
  water_requirement: 'cost',
  soil_ph_min: 'target',
  soil_ph_max: 'target',
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`)
}

/**
 * Masked, dimension-normalized hinge score over the ACTIVE query dimensions:
 *   benefit: (max(0, q_i − x_i))²   shortfall penalized, surplus free
 *   cost:    (max(0, x_i − q_i))²   surplus penalized, headroom free
 *   target:  (x_i − q_i)²           two-sided distance
 * score = exp(−γ · mean(term_i)). Query scoring (see module doc), not a
 * kernel in (q, x). No active query dimension → neutral 1, consistent with
 * dimensionNormalizedRbf mapping a null masked distance to 1.
 */
export function scoreCandidate(
  query: number[],
  candidate: number[],
  queryMask: FeatureMask,
  gamma: number,
  directions: Readonly<Record<string, TraitDirection>>,
): number {
  validateGamma(gamma)
  if (query.length !== candidate.length) {
    throw new Error('scoreCandidate: query and candidate must have the same dimension')
  }
  if (queryMask.length !== query.length) {
    throw new Error('scoreCandidate: query mask must have the same dimension as its feature vector')
  }
  let total = 0
  let active = 0
  for (let index = 0; index < query.length; index++) {
    if (queryMask[index] === 0) continue
    const name = TRAIT_NAMES[index]
    const direction = name === undefined ? undefined : directions[name]
    if (direction === undefined) {
      throw new Error(`scoreCandidate: no direction for active dimension '${name ?? index}'`)
    }
    const q = query[index]!
    const x = candidate[index]!
    assertFinite(q, 'Query component')
    assertFinite(x, 'Candidate component')
    const hinge =
      direction === 'benefit' ? Math.max(0, q - x) :
      direction === 'cost' ? Math.max(0, x - q) :
      x - q
    total += hinge * hinge
    active++
  }
  if (active === 0) return 1
  return Math.exp(-gamma * (total / active))
}

/**
 * Subspace γ (Fix P6): median heuristic restricted to the active query
 * dimensions via medianHeuristicGamma(rows, undefined, queryMask), so the
 * score width reflects the queried subspace instead of the full
 * 12-dimensional catalog spread.
 */
export function queryGamma(catalogRows: readonly number[][], queryMask: FeatureMask): number {
  return medianHeuristicGamma(catalogRows, undefined, queryMask)
}

/**
 * Percentile of a score within the catalog score distribution (Fix P2):
 * 100 × proportion of catalog scores STRICTLY below it. Strict comparison
 * means ties share a percentile and no candidate is inflated by beating
 * itself. An empty reference population carries no information → neutral 50.
 */
export function percentileOf(score: number, allScores: readonly number[]): number {
  assertFinite(score, 'Score')
  if (allScores.length === 0) return 50
  const below = allScores.reduce((count, value) => count + (value < score ? 1 : 0), 0)
  return (100 * below) / allScores.length
}

export interface RankedCandidate {
  index: number
  /** Primary key: hinge satisficing score (see scoreCandidate). */
  score: number
  /** Tiebreak key: masked RBF similarity on the active subspace (fixed mask ⇒ PSD ⇒ RKHS cosine). */
  similarity: number
}

/**
 * Rank all catalog rows against one query: primary = requirement satisfaction
 * (hinge score), secondary = overall profile similarity in the active
 * subspace (RBF kernel). The tiebreak resolves score ties — e.g. several
 * candidates fully satisfying a benefits-only query — toward the candidate
 * whose trait profile is closest to the query point. It does NOT override the
 * satisficing semantics: a candidate that misses a requirement can never
 * outrank one that satisfies it, however similar it is.
 */
export function rankCandidates(
  catalogRows: readonly number[][],
  query: number[],
  queryMask: FeatureMask,
  gamma: number,
  directions: Readonly<Record<string, TraitDirection>>,
): RankedCandidate[] {
  return catalogRows
    .map((row, index) => ({
      index,
      score: scoreCandidate(query, row, queryMask, gamma, directions),
      similarity: dimensionNormalizedRbf(query, row, queryMask, gamma),
    }))
    .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
}
