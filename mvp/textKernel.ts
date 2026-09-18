// SPDX-License-Identifier: AGPL-3.0-or-later
// AgriGen Matcher · Copyright (C) 2026 Marc-Dennis Haberland (Adaptive AI Solutions)
// Kommerzielle Lizenz ohne Copyleft: hallo@adaptive-ai-solutions.de
/**
 * Text kernel over official CPVO UPOV variety descriptions, embedded with bge-m3.
 *
 * Data basis (deterministic, no network at load time):
 *   - `data/text/vd-corpus.json` — 200 bilingual per-variety texts parsed from
 *     official Variety Description PDFs (section 15) plus the examiner's
 *     officially most-similar variety (section 16, `similarTo`), fetched from
 *     the anonymous CPVO register API on 2026-08-27 (route + provenance:
 *     data/text/README.md).
 *   - `data/text/vd-embeddings.json` — cached 1024-dim bge-m3 vectors
 *     (Ollama on neobox, model `bge-m3:latest`), rounded to 5 decimals.
 *     Regenerate via data/text/vd-embed-pipeline.ts (needs the SSH tunnel).
 *
 * The cosine kernel K(u,v) = <e(u),e(v)>/(||e(u)||·||e(v)||) is the Gram
 * matrix of L2-normalized vectors — PSD by construction, so convex fusion
 * with the masked-RBF trait kernel stays PSD and inside the RKHS framework.
 *
 * Validation labels: `similarTo` is the variety the EXAMINING OFFICE named as
 * most similar (with differentiating characteristics) during DUS testing — an
 * official, label-free ground truth. Note it is chosen to be similar AND
 * distinguishable, so top-1 retrieval is not the expected mode; top-k is.
 */

import { readFileSync } from 'node:fs'

export interface TextKernelData {
  names: string[]
  crops: string[]
  similarTo: (string | null)[]
  embeddings: number[][]
  /** cosine between two corpus entries */
  cos: (i: number, j: number) => number
}

const norm = (v: readonly number[]): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
export const normalizeName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function loadTextKernel(): TextKernelData {
  const corpusUrl = new URL('../data/text/vd-corpus.json', import.meta.url)
  const embUrl = new URL('../data/text/vd-embeddings.json', import.meta.url)
  const corpus = JSON.parse(readFileSync(corpusUrl, 'utf8')) as {
    varieties: { crop: string, name: string, similarTo: string | null }[]
  }
  const embeddings = JSON.parse(readFileSync(embUrl, 'utf8')) as number[][]

  if (!Array.isArray(corpus.varieties) || corpus.varieties.length === 0) {
    throw new Error('vd-corpus.json is empty or malformed')
  }
  if (embeddings.length !== corpus.varieties.length) {
    throw new Error(`embedding count ${embeddings.length} != corpus count ${corpus.varieties.length}`)
  }
  const dims = embeddings[0]!.length
  if (!embeddings.every((e) => e.length === dims)) throw new Error('inconsistent embedding dimensions')
  embeddings.forEach((e, i) => {
    if (!e.every(Number.isFinite)) throw new Error(`non-finite embedding component at index ${i}`)
  })

  const norms = embeddings.map(norm)
  if (norms.some((n) => n === 0)) throw new Error('zero embedding vector in cache')

  return {
    names: corpus.varieties.map((v) => v.name),
    crops: corpus.varieties.map((v) => v.crop),
    similarTo: corpus.varieties.map((v) => v.similarTo ?? null),
    embeddings,
    cos: (i, j) => embeddings[i]!.reduce((s, x, k) => s + x * embeddings[j]![k], 0) / (norms[i]! * norms[j]!),
  }
}

/** Text→text identity: does the kernel rank each variety's own VD first? */
export function textIdentityTop1(tk: TextKernelData): number {
  let top1 = 0
  for (let i = 0; i < tk.names.length; i++) {
    let best = -2, bestJ = -1
    for (let j = 0; j < tk.names.length; j++) {
      if (j === i) continue
      const v = tk.cos(i, j)
      if (v > best) { best = v; bestJ = j }
    }
    if (tk.cos(i, i) >= best) top1++
  }
  return top1 / tk.names.length
}

/**
 * Retrieval of the officially most-similar variety (examiner's label).
 * Only pairs where the labelled variety is itself in the corpus count.
 */
export function textOfficialSimilarRetrieval(tk: TextKernelData): {
  pairs: number, top1: number, top5: number, top10: number
} {
  const normed = tk.names.map(normalizeName)
  let pairs = 0, top1 = 0, top5 = 0, top10 = 0
  for (let i = 0; i < tk.names.length; i++) {
    const target = tk.similarTo[i]
    if (!target) continue
    const t = normed.indexOf(normalizeName(target))
    if (t < 0 || t === i) continue
    pairs++
    const ranking = tk.names
      .map((_, j) => ({ j, v: j === i ? -2 : tk.cos(i, j) }))
      .sort((a, b) => b.v - a.v)
    const rank = ranking.findIndex((r) => r.j === t) + 1
    if (rank === 1) top1++
    if (rank <= 5) top5++
    if (rank <= 10) top10++
  }
  return { pairs, top1, top5, top10 }
}
