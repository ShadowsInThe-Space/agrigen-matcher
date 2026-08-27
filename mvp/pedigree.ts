/**
 * Genealogy (pedigree) kernel over official ancestry strings.
 *
 * Data basis: `data/pedigree/genesys-ancestry.json` — MCPD field ANCEST
 * ("Ancestry") from EURISCO/Genesys genebank passport records, batch-queried
 * 2026-08-27 (see data/pedigree/SOURCES.md for route, coverage and provenance;
 * 83 of 373 BSL-2026 varieties carry a substantive pedigree string).
 *
 * Kernel construction (why this is PSD by construction):
 * Each variety v is mapped to a nonnegative ancestor-contribution vector
 * a(v) over the union of ancestor tokens: the variety itself carries weight 1,
 * each cross parent 1/2, each grandparent 1/4, … (halving per generation,
 * following the genebank cross notation; a parent that is itself a nested
 * cross is expanded recursively, its own ancestors weighted accordingly —
 * this mirrors "cross notation parents are parents", the standard germplasm-
 * database approximation, and never invents names: unknown founders simply
 * do not appear in other pedigrees' token space unless the identical breeder
 * line string appears, in which case shared ancestry is legitimate).
 * The kinship kernel is the cosine
 *     K(u,v) = <a(u),a(v)> / (||a(u)|| · ||a(v)||)
 * i.e. the Gram matrix of L2-normalized nonnegative vectors — positive
 * semi-definite. K(v,v) = 1. Convex fusion with the masked-RBF trait kernel
 * (α·K_traits + γ·K_pedigree, α,γ ≥ 0, α+γ = 1) is therefore PSD and stays
 * inside the RKHS framework (mirrors the SeedShuffle embedding-fusion
 * contract: only PSD-preserving combinations).
 *
 * Honest limitations (documented, not hidden):
 *   - Varieties without pedigree data get a founder vector (self only):
 *     K = 0 against everything except themselves. No invented kinship.
 *   - Pedigree strings are partial (breeder lines like "STAMM29-94-8" stay
 *     opaque tokens); missing parents bias kinship downward, never upward.
 *   - Backcross markers ("2*") are stripped from tokens rather than
 *     re-weighted — approximation favors under- over overstatement.
 */

export interface PedigreeRecord {
  crop: string
  name: string
  pedigree: string
  source: { inst: string; acc: string }
}

export interface PedigreeFile {
  _meta: { fetched: string; count: number; [k: string]: unknown }
  varieties: PedigreeRecord[]
}

/** Ancestor token -> contribution weight, including the variety itself at 1. */
export type AncestorVector = Map<string, number>

const MAX_DEPTH = 6
const OPAQUE_TOKEN_HINTS = /^(stamm|line|selection|sel\.?|sb|stru|kw|br)\b/i

function cleanToken(raw: string | null | undefined): string | null {
  let t = String(raw ?? '').trim()
  // strip trailing backcross markers: "Multiweiss 2*" -> "Multiweiss"
  t = t.replace(/\s*\d*\*+\s*$/, '').trim()
  // strip leading/trailing punctuation left over from splitting
  t = t.replace(/^[\s,;:()]+|[\s,;:()]+$/g, '')
  if (!t || t.length < 2) return null
  if (/^(unknown|unbekannt|n\/?a|\.|-)$/i.test(t)) return null
  return t.toLowerCase().replace(/[^a-z0-9]/g, '')
}

interface CrossNode {
  kind: 'leaf'
  token: string | null
  raw: string
}

interface SepNode {
  kind: 'cross'
  // sequential binary: left is the earlier part, right the LAST parent
  left: Node
  right: Node
}

type Node = CrossNode | SepNode

/**
 * Parse a genebank cross notation into a binary tree.
 * Separators, loosest to tightest: `//`, `/n/`, `/`, `*`, ` x `/` X `/`×`.
 * Parentheses nest. Splitting takes the LAST top-level separator, so
 * `A/B//C` becomes (A/B) × C — C gets 1/2, A and B get 1/4 each.
 */
export function parseCrossNotation(input: string): Node {
  let s = input.trim()
  // unwrap a single fully-wrapping paren group: "(Tobak x Elixer)" -> "Tobak x Elixer"
  while (s.startsWith('(') && s.endsWith(')') && matchingParenIsLast(s)) {
    s = s.slice(1, -1).trim()
  }
  if (!s) return { kind: 'leaf', token: null, raw: s }
  const i = topLevelSplit(s)
  if (i === -1) return { kind: 'leaf', token: cleanToken(s), raw: s }
  return {
    kind: 'cross',
    left: parseCrossNotation(s.slice(0, i)),
    right: parseCrossNotation(s.slice(sepEnd(s, i))),
  }
}

function matchingParenIsLast(s: string): boolean {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') {
      depth--
      if (depth === 0) return i === s.length - 1
    }
  }
  return false
}

/**
 * Index of the LAST top-level cross separator, or -1.
 * Separator groups: `/`, `//`, `/3/` (recorded at the group's FIRST `/`,
 * with the rest skipped so a group is never split mid-way), plus `*` and
 * spaced ` x `/` X `/`×`. Splitting at the last separator makes `A/B//C`
 * parse as (A/B) × C and `A/B//B` a backcross with B at 3/4 — matching
 * standard genebank notation semantics.
 */
function topLevelSplit(s: string): number {
  let depth = 0
  let best = -1
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '(') { depth++; continue }
    if (c === ')') { depth--; continue }
    if (depth !== 0) continue
    if (c === '/') {
      best = i
      let j = i + 1
      while (j < s.length && /[0-9]/.test(s[j]!)) j++
      if (s[j] === '/') j++
      i = j - 1
      continue
    }
    // '*' attached to a token ("Multiweiss 2*", "SB9(...)*Grej" has ')' before)
    // only separates when NOT glued to a preceding letter/digit
    if ((c === '*' && !/[a-zA-Z0-9]/.test(s[i - 1] ?? ' '))
      || ((c === 'x' || c === 'X' || c === '×') && isXSeparator(s, i))) {
      best = i
    }
  }
  return best
}

function sepEnd(s: string, i: number): number {
  const c = s[i]!
  if (c !== '/') return i + 1
  // consume `/`, optional digits, closing `/` (i.e. `//`, `/3/`)
  let j = i + 1
  while (j < s.length && /[0-9]/.test(s[j]!)) j++
  if (j < s.length && s[j] === '/') j++
  return j
}

function isXSeparator(s: string, i: number): boolean {
  const prev = s[i - 1] ?? ' '
  const next = s[i + 1] ?? ' '
  return /\s/.test(prev) && /\s/.test(next)
}

function accumulate(node: Node, weight: number, depth: number, out: AncestorVector): void {
  if (weight <= 0 || depth > MAX_DEPTH) return
  if (node.kind === 'leaf') {
    if (node.token === null) return
    out.set(node.token, (out.get(node.token) ?? 0) + weight)
    return
  }
  // right (last) parent and left sub-cross each contribute half
  accumulate(node.right, weight / 2, depth + 1, out)
  accumulate(node.left, weight / 2, depth + 1, out)
}

/** Build the ancestor-contribution vector for one variety (self at weight 1). */
export function ancestorVector(name: string, pedigree: string): AncestorVector {
  const norm = cleanToken(name)
  const out: AncestorVector = new Map()
  if (norm) out.set(norm, 1)
  if (pedigree && pedigree.trim()) {
    accumulate(parseCrossNotation(pedigree), 1, 0, out)
  }
  return out
}

function dot(a: AncestorVector, b: AncestorVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let sum = 0
  for (const [k, v] of small) sum += v * (large.get(k) ?? 0)
  return sum
}

/** Cosine kinship: 1 = identical, 0 = no shared ancestry. Diagonal is 1. */
export function kinship(a: AncestorVector, b: AncestorVector): number {
  const denom = Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b))
  if (denom === 0) return 0
  return dot(a, b) / denom
}

/** Convenience: kinship between two named varieties given their pedigrees. */
export function kinshipOf(
  nameA: string, pedA: string,
  nameB: string, pedB: string,
): number {
  return kinship(ancestorVector(nameA, pedA), ancestorVector(nameB, pedB))
}

/** True when the pedigree contains only opaque breeder-line tokens (no named variety). */
export function isOpaquePedigree(pedigree: string): boolean {
  const v = ancestorVector('x', pedigree)
  for (const k of v.keys()) if (!OPAQUE_TOKEN_HINTS.test(k)) return false
  return v.size > 0
}

/** Convex fusion of two PSD kernels (weights validated, sum normalized). */
export function fuseKernels(
  kTraits: readonly (readonly number[])[],
  kPedigree: readonly (readonly number[])[],
  gamma: number,
): number[][] {
  if (kTraits.length !== kPedigree.length) throw new Error('kernel dimensions differ')
  if (!Number.isFinite(gamma) || gamma < 0 || gamma > 1) throw new Error('gamma must be in [0,1]')
  const alpha = 1 - gamma
  return kTraits.map((row, i) =>
    row.map((v, j) => alpha * v + gamma * (kPedigree[i]?.[j] ?? 0)),
  )
}
