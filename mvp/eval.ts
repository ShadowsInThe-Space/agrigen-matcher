/**
 * Evaluation harness — measures match quality with label-free metrics.
 *
 * No external ground truth (qrels) exists for the 12-accession catalog, so
 * accuracy is measured against constructible truths:
 *
 *  M1 identity      A query built from accession X's own trait vector must
 *                   retrieve X at rank 1 (full 12-dim and partial subspaces).
 *  M2 partial ident Same with a random k-dim mask (k=4), averaged over seeds.
 *  M3 LOO stability Top-3 Jaccard of each demo scenario when any non-top
 *                   accession is removed from the catalog (robustness).
 *  M4 noise robust  Top-1 flip rate when query targets are perturbed by ε.
 *  M5 separation    Mean top1−top2 score gap across scenarios (resolvability).
 *
 * Run: node mvp/eval.ts   (writes mvp/eval-results.json for diffing across
 * loop iterations; exit 0 always — the iteration log interprets results)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { rankCandidates, queryGamma, TRAIT_DIRECTIONS } from './scoring.ts'
import { buildCatalog, TRAIT_NAMES, type AccessionRecord, type Catalog } from './traits.ts'

const DATA_PATH = new URL('../data/sample_eurisco.json', import.meta.url)

/** Deterministic PRNG (mulberry32) so every iteration compares identical seeds. */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function directionsFor(activeMask: number[]): Record<string, 'benefit' | 'cost' | 'target'> {
  const directions: Record<string, 'benefit' | 'cost' | 'target'> = {}
  TRAIT_NAMES.forEach((name, index) => {
    if (activeMask[index]) directions[name] = name === 'growing_days' ? 'target' : TRAIT_DIRECTIONS[name] ?? 'target'
  })
  return directions
}

interface Scored { id: string, score: number, rank: number }

/** Rank via rankCandidates (hinge score + kernel tiebreak), mapped to ids. */
function rankAll(catalog: Catalog, query: number[], mask: number[], gamma: number, directions: Record<string, 'benefit' | 'cost' | 'target'>): Scored[] {
  return rankCandidates(catalog.rows, query, mask, gamma, directions)
    .map(item => ({ id: catalog.ids[item.index]!, score: item.score }))
    .map((item, index) => ({ ...item, rank: index + 1 }))
}

/** M1: identity retrieval with the full feature mask. */
function identityAccuracy(catalog: Catalog): { top1: number, top3: number, meanReciprocalRank: number } {
  const fullMask = TRAIT_NAMES.map(() => 1)
  const gamma = queryGamma(catalog.rows, fullMask)
  const directions = directionsFor(fullMask)
  let top1 = 0
  let top3 = 0
  let reciprocal = 0
  for (let i = 0; i < catalog.rows.length; i++) {
    const ranked = rankAll(catalog, catalog.rows[i]!, fullMask, gamma, directions)
    const self = ranked.find(item => item.id === catalog.ids[i])!
    if (self.rank === 1) top1++
    if (self.rank <= 3) top3++
    reciprocal += 1 / self.rank
  }
  const n = catalog.rows.length
  return { top1: top1 / n, top3: top3 / n, meanReciprocalRank: reciprocal / n }
}

/** M2: identity with random k-dim masks, averaged over seeds. */
function partialIdentityAccuracy(catalog: Catalog, k: number, seeds: number, ranker: typeof rankAll = rankAll): number {
  const n = catalog.rows.length
  let top1 = 0
  let trials = 0
  for (let seed = 1; seed <= seeds; seed++) {
    const random = rng(seed)
    const mask = TRAIT_NAMES.map(() => 0)
    const dims = [...TRAIT_NAMES.keys()]
    for (let draw = 0; draw < k; draw++) {
      const pick = Math.floor(random() * dims.length)
      mask[dims.splice(pick, 1)[0]!] = 1
    }
    const gamma = queryGamma(catalog.rows, mask)
    const directions = directionsFor(mask)
    for (let i = 0; i < n; i++) {
      const ranked = ranker(catalog, catalog.rows[i]!, mask, gamma, directions)
      if (ranked[0]!.id === catalog.ids[i]) top1++
      trials++
    }
  }
  return top1 / trials
}

/** M3: leave-one-out stability of the three demo scenarios (top-3 Jaccard). */
function looStability(catalog: Catalog, scenarios: number[][]): number {
  let jaccardSum = 0
  let count = 0
  for (const mask of scenarios) {
    const gamma = queryGamma(catalog.rows, mask)
    const directions = directionsFor(mask)
    for (const query of catalog.rows) {
      const reference = rankAll(catalog, query, mask, gamma, directions).slice(0, 3).map(item => item.id)
      for (let j = 0; j < catalog.rows.length; j++) {
        if (reference.includes(catalog.ids[j]!)) continue
        const reduced: Catalog = {
          ids: catalog.ids.filter((_, index) => index !== j),
          labels: catalog.labels.filter((_, index) => index !== j),
          rows: catalog.rows.filter((_, index) => index !== j),
        }
        const perturbed = rankAll(reduced, query, mask, gamma, directions).slice(0, 3).map(item => item.id)
        const overlap = reference.filter(id => perturbed.includes(id)).length
        jaccardSum += overlap / (6 - overlap)
        count++
      }
    }
  }
  return count === 0 ? 1 : jaccardSum / count
}

/**
 * M4: top-1 flip rate AND satisfaction regret under query target noise (ε per
 * active dim). A raw flip between candidates that both fully satisfy the query
 * (equal hinge score) is a preference change, not a quality loss — the regret
 * rate counts only perturbations where the new top-1 strictly misses a
 * requirement the old top-1 satisfied (score drop > 1e-9).
 */
function noiseRobustness(catalog: Catalog, scenarios: number[][], epsilon: number, trials: number, ranker: typeof rankAll = rankAll): { flipRate: number, regretRate: number } {
  let flips = 0
  let regrets = 0
  let total = 0
  for (const mask of scenarios) {
    const gamma = queryGamma(catalog.rows, mask)
    const directions = directionsFor(mask)
    for (let seed = 100; seed < 100 + trials; seed++) {
      const random = rng(seed)
      for (const query of catalog.rows) {
        const baseline = ranker(catalog, query, mask, gamma, directions)
        const baselineTop = baseline[0]!
        const baselineScoreById = new Map(baseline.map(item => [item.id, item.score]))
        const noisy = query.map((value, index) =>
          mask[index] ? Math.min(1, Math.max(0, value + (random() * 2 - 1) * epsilon)) : value)
        const winner = ranker(catalog, noisy, mask, gamma, directions)[0]!
        if (winner.id !== baselineTop.id) flips++
        // Regret: does the noisy pick satisfy the ORIGINAL requirements less
        // than the baseline pick did? (both scored against the original query)
        if (baselineScoreById.get(winner.id)! < baselineTop.score - 1e-9) regrets++
        total++
      }
    }
  }
  return { flipRate: flips / total, regretRate: regrets / total }
}

/**
 * Iteration 5 experiment: margin-first tiebreak vs similarity tiebreak.
 * Among equal hinge scores, margin-first prefers candidates with larger
 * requirement headroom (robustness to intent under-specification), at the
 * cost of exact-profile identity retrieval. Eval-only — product ranking
 * (rankCandidates) stays similarity-based unless this experiment wins.
 */
function marginTiebreakRank(catalog: Catalog, query: number[], mask: number[], gamma: number, directions: Record<string, 'benefit' | 'cost' | 'target'>): Scored[] {
  const margins = catalog.rows.map(row => {
    let headroom = 0
    let active = 0
    for (let index = 0; index < row.length; index++) {
      if (!mask[index]) continue
      const name = TRAIT_NAMES[index]!
      const direction = directions[name]!
      const q = query[index]!
      const x = row[index]!
      headroom += direction === 'benefit' ? x - q : direction === 'cost' ? q - x : -Math.abs(x - q)
      active++
    }
    return active === 0 ? 0 : headroom / active
  })
  return rankCandidates(catalog.rows, query, mask, gamma, directions)
    .map((item, position) => ({ item, position, margin: margins[item.index]! }))
    .sort((a, b) =>
      b.item.score - a.item.score ||
      b.margin - a.margin ||
      b.item.similarity - a.item.similarity)
    .map(({ item }) => item)
    .map(item => ({ id: catalog.ids[item.index]!, score: item.score }))
    .map((item, index) => ({ ...item, rank: index + 1 }))
}
function separation(catalog: Catalog): number {
  const fullMask = TRAIT_NAMES.map(() => 1)
  const gamma = queryGamma(catalog.rows, fullMask)
  const directions = directionsFor(fullMask)
  let gapSum = 0
  for (const query of catalog.rows) {
    const ranked = rankAll(catalog, query, fullMask, gamma, directions)
    gapSum += ranked[0]!.score - ranked[1]!.score
  }
  return gapSum / catalog.rows.length
}

function main(): void {
  const records: AccessionRecord[] = JSON.parse(readFileSync(DATA_PATH, 'utf8'))
  const catalog = buildCatalog(records)

  // Demo scenario masks (drought/heat/water/salinity; cold/disease/days; nitrogen/yield/water)
  const scenarioMasks: number[][] = [
    [1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    [0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0],
  ]

  const identity = identityAccuracy(catalog)
  const partial = partialIdentityAccuracy(catalog, 4, 10)
  const loo = looStability(catalog, scenarioMasks)
  const noise = noiseRobustness(catalog, scenarioMasks, 0.05, 20)
  const sep = separation(catalog)
  // ε-sweep: regret as a function of perturbation magnitude (iteration 4).
  const sweep = [0.01, 0.02, 0.05, 0.1].map(epsilon => ({
    epsilon,
    flip: round(noiseRobustness(catalog, scenarioMasks, epsilon, 20).flipRate),
    regret: round(noiseRobustness(catalog, scenarioMasks, epsilon, 20).regretRate),
  }))
  const results = {
    timestamp: new Date().toISOString(),
    node: process.version,
    metrics: {
      identity_top1: round(identity.top1),
      identity_top3: round(identity.top3),
      identity_mrr: round(identity.meanReciprocalRank),
      partial_identity_top1_k4: round(partial),
      loo_top3_jaccard: round(loo),
      noise_flip_rate_eps005: round(noise.flipRate),
      noise_regret_rate_eps005: round(noise.regretRate),
      noise_sweep: sweep,
      separation_mean_gap: round(sep),
    },
  }
  writeFileSync(new URL('./eval-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n')
  console.log('AgriGen Eval — Baseline-Metriken (siehe mvp/eval-results.json)')
  for (const [key, value] of Object.entries(results.metrics)) {
    if (key === 'noise_sweep') continue
    console.log(`  ${key.padEnd(32)} ${value}`)
  }
  for (const point of results.metrics.noise_sweep as typeof sweep) {
    console.log(`  ε=${String(point.epsilon).padEnd(6)} flip ${String(point.flip).padEnd(8)} regret ${point.regret}`)
  }

  // Iteration 5 experiment: margin-first vs similarity tiebreak (A/B).
  const variantPartial = partialIdentityAccuracy(catalog, 4, 10, marginTiebreakRank)
  const variantNoise = noiseRobustness(catalog, scenarioMasks, 0.05, 20, marginTiebreakRank)
  console.log('  ── Iteration-5-Experiment: Margin-first-Tiebreaker (Produkt unverändert) ──')
  console.log(`  partial_identity_top1_k4   similarity ${(results.metrics.partial_identity_top1_k4 as number).toFixed(4)}  vs margin-first ${round(variantPartial).toFixed(4)}`)
  console.log(`  regret eps=0.05            similarity ${(results.metrics.noise_regret_rate_eps005 as number).toFixed(4)}  vs margin-first ${round(variantNoise.regretRate).toFixed(4)}`)
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}

main()
