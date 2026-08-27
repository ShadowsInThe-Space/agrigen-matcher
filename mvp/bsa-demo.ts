/**
 * BSA real-data smoke run: official Bundessortenamt winter wheat 2026.
 * 1) identity retrieval under observation masks (each variety's own mapped
 *    profile must retrieve itself at rank 1)
 * 2) a realistic farmer query on the three wizard-mapped requirement axes
 * Run: node mvp/bsa-demo.ts
 */

import { rankCandidates, queryGamma, scoreCandidate, percentileOf, TRAIT_DIRECTIONS } from './scoring.ts'
import { medianHeuristicGamma } from './kernelMath.ts'
import { dimensionNormalizedRbf } from './kernelMath.ts'
import { TRAIT_NAMES } from './traits.ts'
import { loadBsaCatalog, loadBsaNativeCatalog, BSL_TRAIT_NAMES, BSL_DIRECTIONS } from './bsaCatalog.ts'

const catalog = loadBsaCatalog()
const n = catalog.rows.length
console.log(`BSA-Real-Daten-Katalog: ${n} Winterweichweizen-Sorten (offizielle BSL 2026)`)
const dims = catalog.observationMasks[0]!.length
const activePerRow = catalog.observationMasks.map(m => m.filter(Boolean).length)
const avgActive = activePerRow.reduce((a, b) => a + b, 0) / n
console.log(`Aktive Dimensionen je Sorte (Beobachtungsmasken): Ø ${avgActive.toFixed(1)} von ${dims}`)

const fullObservedMask = TRAIT_NAMES.map((_, index) => catalog.observationMasks.some(m => m[index] === 1) ? 1 : 0)
const activeNames = TRAIT_NAMES.filter((_, index) => fullObservedMask[index] === 1)
console.log(`Beobachtete Merkmale: ${activeNames.join(', ')}`)

// ── 1) Identity retrieval under masks ────────────────────────────────────
const identityMask = fullObservedMask
const identityGamma = medianHeuristicGamma(catalog.rows, catalog.observationMasks, identityMask)
const directions: Record<string, 'benefit' | 'cost' | 'target'> = {}
TRAIT_NAMES.forEach((name, index) => {
  if (identityMask[index]) directions[name] = name === 'growing_days' ? 'cost' : TRAIT_DIRECTIONS[name] ?? 'benefit'
})
let top1 = 0
let top3 = 0
for (let i = 0; i < n; i++) {
  const ranked = rankCandidates(catalog.rows, catalog.rows[i]!, identityMask, identityGamma, directions, 0, catalog.observationMasks)
  const self = ranked.findIndex(item => item.index === i) + 1
  if (self === 1) top1++
  if (self <= 3) top3++
}
console.log(`Identity-Retrieval (maskiert): top-1 ${(top1 / n).toFixed(4)} · top-3 ${(top3 / n).toFixed(4)}`)

// ── 2) Real farmer query: high disease pressure + early maturity + yield ──
console.log('\nANFRAGE: hoher Krankheitsdruck, frühe Reife, hoher Ertragsfokus')
const qIdx = (name: string) => TRAIT_NAMES.indexOf(name as (typeof TRAIT_NAMES)[number])
const query = new Array<number>(TRAIT_NAMES.length).fill(0)
const queryMask = new Array<number>(TRAIT_NAMES.length).fill(0)
const queryDirections: Record<string, 'benefit' | 'cost' | 'target'> = {}
for (const [name, target, direction] of [
  ['disease_resistance', 0.9, 'benefit'],
  ['growing_days', 0.15, 'cost'],
  ['yield_potential', 0.85, 'benefit'],
] as [string, number, 'benefit' | 'cost' | 'target'][]) {
  query[qIdx(name)] = target
  queryMask[qIdx(name)] = 1
  queryDirections[name] = direction
}
const gamma = queryGamma(catalog.rows, queryMask)
const allScores = catalog.rows.map(row => scoreCandidate(query, row, queryMask, gamma, queryDirections, 0.1, undefined))
const maskedScores = catalog.rows.map((row, index) => scoreCandidate(query, row, queryMask, gamma, queryDirections, 0.1, catalog.observationMasks[index]))
const ranked = catalog.rows
  .map((row, index) => ({
    index,
    score: maskedScores[index]!,
    similarity: dimensionNormalizedRbf(query, row, queryMask, gamma, catalog.observationMasks[index]),
  }))
  .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
  .slice(0, 8)
console.log(`Teilraum-γ = ${gamma.toFixed(4)} · Toleranzband δ = 0.1`)
console.log('Rang  Sorte                                Score   Perzentil')
for (const [position, item] of ranked.entries()) {
  const percentile = percentileOf(item.score, maskedScores)
  console.log(`${String(position + 1).padEnd(5)}${catalog.labels[item.index]!.padEnd(52).slice(0, 50)}${item.score.toFixed(3).padEnd(7)}besser als ${percentile.toFixed(1)} %`)
}
void allScores

// ═══════════════════════════════════════════════════════════════════════════
// Nativer BSL-Merkmalsspace (It 33): 15 Einzel-Deskriptoren statt Aggregat
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ Nativer BSL-Space: 15 Einzel-Deskriptoren ═══')
const native = loadBsaNativeCatalog()
const nativeDims = BSL_TRAIT_NAMES.length
const nativeActive = native.observationMasks.map(m => m.filter(Boolean).length)
console.log(`${native.rows.length} Sorten · aktive Dimensionen je Sorte: Ø ${(nativeActive.reduce((a, b) => a + b, 0) / native.rows.length).toFixed(1)} von ${nativeDims}`)

const nativeFullMask = BSL_TRAIT_NAMES.map((_, index) => native.observationMasks.some(m => m[index] === 1) ? 1 : 0)
const nativeGamma = medianHeuristicGamma(native.rows, native.observationMasks, nativeFullMask)
let nativeTop1 = 0
let nativeTop3 = 0
for (let i = 0; i < native.rows.length; i++) {
  const ranked = rankCandidates(native.rows, native.rows[i]!, nativeFullMask, nativeGamma, BSL_DIRECTIONS, 0, native.observationMasks, BSL_TRAIT_NAMES)
  const self = ranked.findIndex(item => item.index === i) + 1
  if (self === 1) nativeTop1++
  if (self <= 3) nativeTop3++
}
console.log(`Identity-Retrieval (nativ, maskiert): top-1 ${(nativeTop1 / native.rows.length).toFixed(4)} · top-3 ${(nativeTop3 / native.rows.length).toFixed(4)}  (12-Trait-Squeeze: 0.5172/0.8448)`)

// Realistische PATHOGEN-spezifische Anfrage, wie sie der native Space erst erlaubt:
console.log('\nANFRAGE (nativ): Septoria- und Fusarium-Druck hoch, standfest, früh, ertragsstark')
const nq = new Array<number>(nativeDims).fill(0)
const nqMask = new Array<number>(nativeDims).fill(0)
for (const [name, target] of [
  ['blattseptoria', 0.2], ['aehrenfusarium', 0.25], ['mehltau', 0.3], ['gelbrost', 0.3],
  ['braunrost', 0.3], ['drechslera', 0.3], ['pseudocercosporella', 0.3],
  ['lager', 0.2], ['reife', 0.25], ['kornertrag_st2', 0.85], ['kornertrag_st1', 0.7],
] as [string, number][]) {
  const index = BSL_TRAIT_NAMES.indexOf(name as (typeof BSL_TRAIT_NAMES)[number])
  nq[index] = target
  nqMask[index] = 1
}
const nGamma = queryGamma(native.rows, nqMask)
const nScores = native.rows.map((row, index) => scoreCandidate(nq, row, nqMask, nGamma, BSL_DIRECTIONS, 0.1, native.observationMasks[index], BSL_TRAIT_NAMES))
const nRanked = native.rows
  .map((row, index) => ({
    index,
    score: nScores[index]!,
    similarity: dimensionNormalizedRbf(nq, row, nqMask, nGamma, native.observationMasks[index]),
  }))
  .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
  .slice(0, 8)
console.log(`Teilraum-γ = ${nGamma.toFixed(4)} · δ = 0.1 · aktiveDims ${nqMask.filter(Boolean).length}/15`)
console.log('Rang  Sorte                                Score   Perzentil')
for (const [position, item] of nRanked.entries()) {
  console.log(`${String(position + 1).padEnd(5)}${native.labels[item.index]!.padEnd(52).slice(0, 50)}${item.score.toFixed(3).padEnd(7)}besser als ${percentileOf(item.score, nScores).toFixed(1)} %`)
}
