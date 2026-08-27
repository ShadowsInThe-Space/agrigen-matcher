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
import { rankCandidates, queryGamma, queryGammaSampled, scoreCandidate, TRAIT_DIRECTIONS } from './scoring.ts'
import { dimensionNormalizedRbf, medianHeuristicGamma } from './kernelMath.ts'
import { buildCatalog, extractRequirements, LEVEL, TRAIT_NAMES, type AccessionRecord, type Catalog, type FarmingRequirements } from './traits.ts'

const DATA_PATH = new URL('../data/eurisco_150.json', import.meta.url)

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
function noiseRobustness(catalog: Catalog, scenarios: number[][], epsilon: number, trials: number, ranker: typeof rankAll = rankAll, seedBase = 100): { flipRate: number, regretRate: number } {
  let flips = 0
  let regrets = 0
  let total = 0
  for (const mask of scenarios) {
    const gamma = queryGamma(catalog.rows, mask)
    const directions = directionsFor(mask)
    for (let seed = seedBase; seed < seedBase + trials; seed++) {
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

  experiments(catalog, scenarioMasks)
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}

// ═══════════════════════════════════════════════════════════════════════════
// Iteration 6 — normalization variant: per-column min-max stretch
// ═══════════════════════════════════════════════════════════════════════════

/** Stretch every column to [0,1] over the given rows (affine, monotone per dim). */
function stretchRows(rows: readonly number[][]): { rows: number[][], transforms: { min: number, span: number }[] } {
  const dims = rows[0]!.length
  const transforms: { min: number, span: number }[] = []
  const stretched = rows.map(row => [...row])
  for (let d = 0; d < dims; d++) {
    const values = rows.map(row => row[d]!)
    const min = Math.min(...values)
    const max = Math.max(...values)
    transforms.push({ min, span: max === min ? 1 : max - min })
    if (max === min) continue
    for (const row of stretched) row[d] = (row[d]! - min) / (max - min)
  }
  return { rows: stretched, transforms }
}

const applyStretch = (query: number[], transforms: { min: number, span: number }[]): number[] =>
  query.map((value, d) => Math.min(1, Math.max(0, (value - transforms[d]!.min) / transforms[d]!.span)))

/**
 * Honest LOO for a catalog-relative normalization: after each removal the
 * stretch MUST be recomputed on the reduced catalog — otherwise the metric
 * hides exactly the rescale fragility this iteration is testing.
 */
function looWithRestretch(catalog: Catalog, masks: number[][]): number {
  let jaccardSum = 0
  let count = 0
  for (const mask of masks) {
    const directions = directionsFor(mask)
    for (const query of catalog.rows) {
      const reference = rankAll(catalog, query, mask, queryGamma(catalog.rows, mask), directions)
        .slice(0, 3).map(item => item.id)
      for (let j = 0; j < catalog.rows.length; j++) {
        if (reference.includes(catalog.ids[j]!)) continue
        const reducedIds = catalog.ids.filter((_, index) => index !== j)
        const reducedRows = catalog.rows.filter((_, index) => index !== j)
        const restretched = stretchRows(reducedRows).rows
        const reduced: Catalog = { ids: reducedIds, labels: [], rows: restretched }
        const perturbed = rankAll(reduced, query, mask, queryGamma(restretched, mask), directions)
          .slice(0, 3).map(item => item.id)
        const overlap = reference.filter(id => perturbed.includes(id)).length
        jaccardSum += overlap / (6 - overlap)
        count++
      }
    }
  }
  return count === 0 ? 1 : jaccardSum / count
}

const DEMO_REQUIREMENTS: FarmingRequirements[] = [
  { droughtTolerance: 'extreme', heatTolerance: 'high', waterAvailability: 'low', salinityTolerance: 'moderate' },
  { coldTolerance: 'extreme', seasonLength: 'short', diseaseResistance: 'high' },
  { nitrogenEfficiency: 'extreme', yieldPriority: 'high', waterAvailability: 'moderate' },
]
const DEMO_EXPECTED_TOP1 = ['EUR-006', 'EUR-003', 'EUR-012']

function scenarioWinners(catalog: Catalog, requirements: FarmingRequirements[], stretch?: { min: number, span: number }[]): string[] {
  return requirements.map(requirement => {
    const { vector, mask, directions } = extractRequirements(requirement)
    const query = stretch ? applyStretch(vector, stretch) : vector
    const gamma = queryGamma(catalog.rows, mask)
    return rankAll(catalog, query, mask, gamma, directions)[0]!.id
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Iteration 7 — tiebreak-γ variant: similarity width ≠ score width
// ═══════════════════════════════════════════════════════════════════════════

function gammaTiebreakRank(factor: number): typeof rankAll {
  return (catalog, query, mask, gamma, directions) => {
    return catalog.rows
      .map((row, index) => ({
        index,
        score: scoreCandidate(query, row, mask, gamma, directions),
        similarity: dimensionNormalizedRbf(query, row, mask, gamma * factor),
      }))
      .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
      .map(item => ({ id: catalog.ids[item.index]!, score: item.score }))
      .map((item, position) => ({ ...item, rank: position + 1 }))
  }
}

function experiments(catalog: Catalog, scenarioMasks: number[][]): void {
  // ── It 6: min-max-stretched normalization (A/B) ─────────────────────────
  const { rows: stretchedRows, transforms } = stretchRows(catalog.rows)
  const variantCatalog: Catalog = { ids: catalog.ids, labels: [], rows: stretchedRows }
  const variantLoo = looWithRestretch(variantCatalog, scenarioMasks)
  const variantIdentity = identityAccuracy(variantCatalog)
  const variantPartial = partialIdentityAccuracy(variantCatalog, 4, 10)
  const variantRegret = noiseRobustness(variantCatalog, scenarioMasks, 0.05, 20).regretRate
  const variantSeparation = separation(variantCatalog)
  const variantWinners = scenarioWinners(variantCatalog, DEMO_REQUIREMENTS, transforms)
  const winnersOk = variantWinners.every((id, index) => id === DEMO_EXPECTED_TOP1[index])

  console.log('  ── It 6: Per-Column-Min-Max-Stretch (eval-only) ──')
  console.log(`  identity_top1            produkt ${(identityAccuracy(catalog).top1).toFixed(4)}  vs stretch ${round(variantIdentity.top1).toFixed(4)}`)
  console.log(`  partial_identity_k4      produkt 1.0000  vs stretch ${round(variantPartial).toFixed(4)}`)
  console.log(`  loo (re-stretched!)      produkt 1.0000  vs stretch ${round(variantLoo).toFixed(4)}`)
  console.log(`  regret eps005            produkt 0.0917  vs stretch ${round(variantRegret).toFixed(4)}`)
  console.log(`  separation               produkt ${(separation(catalog)).toFixed(4)}  vs stretch ${round(variantSeparation).toFixed(4)}`)
  console.log(`  demo top1 A/B/C          stretch ${variantWinners.join('/')} ${winnersOk ? '(erwartungstreu)' : '(ERWARTUNG GEBROCHEN)'}`)

  // ── It 7: tiebreak-γ factor sweep ───────────────────────────────────────
  console.log('  ── It 7: Tiebreak-γ-Faktor (eval-only) ──')
  for (const factor of [0.5, 1, 2]) {
    const ranker = gammaTiebreakRank(factor)
    const partial = partialIdentityAccuracy(catalog, 4, 10, ranker)
    const regret = noiseRobustness(catalog, scenarioMasks, 0.05, 20, ranker).regretRate
    console.log(`  γ·${factor}: partial ${round(partial).toFixed(4)}  regret ${round(regret).toFixed(4)}`)
  }

  // ── It 10: catalog-data noise (measurement error in recorded traits) ────
  console.log('  ── It 10: Katalog-Datenrauschen (Traits verrauscht, Query fix) ──')
  for (const epsilon of [0.02, 0.05]) {
    let top3Overlap = 0
    let trials = 0
    for (const mask of scenarioMasks) {
      const gamma = queryGamma(catalog.rows, mask)
      const directions = directionsFor(mask)
      for (const query of catalog.rows) {
        const reference = rankAll(catalog, query, mask, gamma, directions).slice(0, 3).map(item => item.id)
        for (let seed = 200; seed < 210; seed++) {
          const random = rng(seed)
          const noisyCatalog: Catalog = {
            ids: catalog.ids,
            labels: [],
            rows: catalog.rows.map(row => row.map((value, index) =>
              mask[index] ? Math.min(1, Math.max(0, value + (random() * 2 - 1) * epsilon)) : value)),
          }
          const perturbed = rankAll(noisyCatalog, query, mask, gamma, directions).slice(0, 3).map(item => item.id)
          top3Overlap += reference.filter(id => perturbed.includes(id)).length / 3
          trials++
        }
      }
    }
    console.log(`  ε=${String(epsilon).padEnd(5)} top-3-Treue (Ø Überlappung) ${round(top3Overlap / trials).toFixed(4)}`)
  }

  // ── It 11: partial identity k-sweep ─────────────────────────────────────
  console.log('  ── It 11: Teilraum-Identität nach k (5 Seeds) ──')
  for (const k of [2, 3, 4, 6, 8, 12]) {
    const accuracy = k === 12 ? identityAccuracy(catalog).top1 : partialIdentityAccuracy(catalog, k, 5)
    console.log(`  k=${String(k).padEnd(3)} top-1 ${round(accuracy).toFixed(4)}`)
  }

  // ── It 13: seed stability of the noise metrics ──────────────────────────
  console.log('  ── It 13: Seed-Stabilität (regret ε=0.05, zwei Seed-Basen) ──')
  const seedsA = noiseRobustness(catalog, scenarioMasks, 0.05, 20, rankAll, 100)
  const seedsB = noiseRobustness(catalog, scenarioMasks, 0.05, 20, rankAll, 500)
  console.log(`  base 100: flip ${round(seedsA.flipRate).toFixed(4)} regret ${round(seedsA.regretRate).toFixed(4)}`)
  console.log(`  base 500: flip ${round(seedsB.flipRate).toFixed(4)} regret ${round(seedsB.regretRate).toFixed(4)}`)

  // ── It 14: synthetic stress catalog + duplicate boundary ────────────────
  console.log('  ── It 14: Synthetischer Stress-Katalog (n=100) ──')
  const synthetic = syntheticCatalog(100, 42, 0)
  const syntheticDup = syntheticCatalog(100, 42, 2)
  const synthIdentity = identityAccuracy(synthetic)
  const synthPartial = partialIdentityAccuracy(synthetic, 4, 5)
  const synthDupIdentity = identityAccuracy(syntheticDup)
  console.log(`  ohne Duplikate:  identity ${round(synthIdentity.top1).toFixed(4)}  partial k=4 ${round(synthPartial).toFixed(4)}`)
  console.log(`  mit 2 Duplikaten: identity ${round(synthDupIdentity.top1).toFixed(4)} (Grenze: exakte Duplikate sind prinzipiell ununterscheidbar)`)

  // ── It 15: performance sanity at catalog scale ──────────────────────────
  console.log('  ── It 15: Performance (Median-γ + Ranking, 12 Dims) ──')
  for (const n of [100, 1000, 5000]) {
    const rows = syntheticCatalog(n, 7, 0).rows
    const fullMask = TRAIT_NAMES.map(() => 1)
    const query = rows[0]!
    const directions = directionsFor(fullMask)
    const tGamma = time(() => medianHeuristicGamma(rows))
    const gamma = medianHeuristicGamma(rows)
    const tRank = time(() => rankCandidates(rows, query, fullMask, gamma, directions))
    console.log(`  n=${String(n).padEnd(5)} γ-Kalibration ${tGamma.toFixed(1)} ms  Ranking ${tRank.toFixed(2)} ms`)
  }

  // ── It 16: sampled γ — deviation, time, rank identity ───────────────────
  console.log('  ── It 16: Gesampelter γ (500 Zeilen) vs voller Median-Heuristik ──')
  for (const n of [1000, 5000]) {
    const rows = syntheticCatalog(n, 7, 0).rows
    const fullMask = TRAIT_NAMES.map(() => 1)
    const directions = directionsFor(fullMask)
    const fullGamma = medianHeuristicGamma(rows)
    const tSampled = time(() => queryGammaSampled(rows, fullMask, 500, 1))
    const sampledGamma = queryGammaSampled(rows, fullMask, 500, 1)
    let rankIdentical = true
    for (let i = 0; i < Math.min(rows.length, 200) && rankIdentical; i++) {
      const a = rankCandidates(rows, rows[i]!, fullMask, fullGamma, directions)[0]!.index
      const b = rankCandidates(rows, rows[i]!, fullMask, sampledGamma, directions)[0]!.index
      if (a !== b) rankIdentical = false
    }
    console.log(`  n=${String(n).padEnd(5)} γ voll ${fullGamma.toFixed(4)} vs gesampelt ${sampledGamma.toFixed(4)} (Δ ${Math.abs(fullGamma - sampledGamma).toFixed(4)}) · ${tSampled.toFixed(1)} ms · Top-1 identisch: ${rankIdentical ? 'ja' : 'NEIN'}`)
  }

  // ── It 17: LOO with the actual demo requirement queries ─────────────────
  console.log('  ── It 17: LOO mit echten Demo-Anfragen ──')
  let demoLooSum = 0
  let demoLooCount = 0
  for (const requirement of DEMO_REQUIREMENTS) {
    const { vector, mask, directions } = extractRequirements(requirement)
    const gamma = queryGamma(catalog.rows, mask)
    const reference = rankAll(catalog, vector, mask, gamma, directions).slice(0, 3).map(item => item.id)
    for (let j = 0; j < catalog.rows.length; j++) {
      if (reference.includes(catalog.ids[j]!)) continue
      const reduced: Catalog = {
        ids: catalog.ids.filter((_, index) => index !== j),
        labels: [],
        rows: catalog.rows.filter((_, index) => index !== j),
      }
      const perturbed = rankAll(reduced, vector, mask, gamma, directions).slice(0, 3).map(item => item.id)
      const overlap = reference.filter(id => perturbed.includes(id)).length
      demoLooSum += overlap / (6 - overlap)
      demoLooCount++
    }
  }
  console.log(`  top-3 Jaccard unter LOO: ${round(demoLooSum / demoLooCount).toFixed(4)} (${demoLooCount} Entfernungen)`)

  // ── It 21: wizard consistency — LEVEL-quantized self-retrieval ──────────
  // The real UX path: farmers state coarse levels, not decimals. Does a query
  // built by quantizing accession X's own traits to the wizard levels still
  // retrieve X? Quantization can only move targets toward the level grid.
  console.log('  ── It 21: Wizard-Konsistenz (LEVEL-quantisierte Selbst-Retrieval) ──')
  const wizardFull = wizardConsistency(catalog, TRAIT_NAMES.map(() => 1))
  console.log(`  volle Maske:   top-1 ${round(wizardFull.top1).toFixed(4)}  top-3 ${round(wizardFull.top3).toFixed(4)}`)
  const wizardPartials = [1, 2, 3].map(seed => wizardConsistency(catalog, randomMask(4, seed)))
  const wizardPartialAvg = wizardPartials.reduce((sum, result) => sum + result.top3, 0) / wizardPartials.length
  console.log(`  4-Dim-Masken:  top-3 Ø ${round(wizardPartialAvg).toFixed(4)} (3 Seeds)`)

  // ── It 22: finer level grid A/B (only meaningful if It 21 shows a gap) ──
  const fineLevels = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
  const fineWizardFull = wizardConsistency(catalog, TRAIT_NAMES.map(() => 1), fineLevels)
  const fineWizardPartials = [1, 2, 3].map(seed => wizardConsistency(catalog, randomMask(4, seed), fineLevels))
  const fineWizardPartialAvg = fineWizardPartials.reduce((sum, result) => sum + result.top3, 0) / fineWizardPartials.length
  console.log(`  ── It 22: Feineres LEVEL-Raster (9 Stufen) A/B ──`)
  console.log(`  volle Maske:  top-1 ${round(fineWizardFull.top1).toFixed(4)}  top-3 ${round(fineWizardFull.top3).toFixed(4)}`)
  console.log(`  4-Dim-Masken: top-3 Ø ${round(fineWizardPartialAvg).toFixed(4)} (3 Seeds; 4-Stufen-Raster: ${round(wizardPartialAvg).toFixed(4)})`)
}

/** Mirror of the product wizard scale (traits.LEVEL) so the metric tracks the shipped grid. */
const WIZARD_LEVELS = Object.values(LEVEL)

/** Quantize a value to the nearest wizard level (ties → lower level). */
function quantize(value: number, levels: readonly number[]): number {
  return levels.reduce((best, level) =>
    Math.abs(level - value) < Math.abs(best - value) ? level : best, levels[0]!)
}

/** Random k-dim mask with a fixed seed (shared with partial identity seeds). */
function randomMask(k: number, seed: number): number[] {
  const random = rng(seed)
  const mask = TRAIT_NAMES.map(() => 0)
  const dims = [...TRAIT_NAMES.keys()]
  for (let draw = 0; draw < k; draw++) {
    const pick = Math.floor(random() * dims.length)
    mask[dims.splice(pick, 1)[0]!] = 1
  }
  return mask
}

function wizardConsistency(catalog: Catalog, mask: number[], levels: readonly number[] = WIZARD_LEVELS): { top1: number, top3: number } {
  const gamma = queryGamma(catalog.rows, mask)
  const directions = directionsFor(mask)
  let top1 = 0
  let top3 = 0
  for (let i = 0; i < catalog.rows.length; i++) {
    const query = catalog.rows[i]!.map(value => quantize(value, levels))
    const ranked = rankAll(catalog, query, mask, gamma, directions)
    const self = ranked.find(item => item.id === catalog.ids[i])!
    if (self.rank === 1) top1++
    if (self.rank <= 3) top3++
  }
  const n = catalog.rows.length
  return { top1: top1 / n, top3: top3 / n }
}

function time(fn: () => unknown): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

/** Synthetic catalog: n rows × 12 dims uniform [0,1]; `duplicates` copies of row 0. */
function syntheticCatalog(n: number, seed: number, duplicates: number): Catalog {
  const random = rng(seed)
  const rows = Array.from({ length: n }, () => Array.from({ length: TRAIT_NAMES.length }, () => round(random())))
  for (let d = 1; d <= duplicates && d < n; d++) rows[d] = [...rows[0]!]
  return { ids: rows.map((_, index) => `SYN-${index}`), labels: [], rows }
}

main()
