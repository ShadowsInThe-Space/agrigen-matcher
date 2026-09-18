// SPDX-License-Identifier: AGPL-3.0-or-later
// AgriGen Matcher · Copyright (C) 2026 Marc-Dennis Haberland (Adaptive AI Solutions)
// Kommerzielle Lizenz ohne Copyleft: hallo@adaptive-ai-solutions.de
/**
 * Demo + validation for the genealogy kernel on the real EURISCO/Genesys
 * ancestry data (data/pedigree/genesys-ancestry.json, fetched 2026-08-27).
 *
 * Checks (exit 1 on failure, mirroring the repo's eval-gate style):
 *   1. Parser sanity on hand-checked notations.
 *   2. Kernel PSD over ALL 373 BSL varieties (pedigree ones + founders).
 *   3. Diagonal = 1, kinship symmetric, range [0,1].
 *   4. Ground-truth pairs from the official pedigree strings:
 *      KWS Donovan = Tobak x Anapolis   -> K(Donovan, Tobak) large
 *      Knut        = Sheriff x RGT Reform -> K(Knut, RGT Reform) large
 *      Debian      = (Tobak x Elixer) x Forum -> K(Debian, Tobak) moderate
 *   5. A fusion smoke test: convex trait-RBF + kinship stays PSD.
 */

import { readFileSync } from 'node:fs'
import { ancestorVector, fuseKernels, kinship, kinshipOf, parseCrossNotation } from './pedigree.ts'
import { symmetricEigenvalues } from './metrics.ts'
import { loadBsaUnionCatalog } from './bsaCatalog.ts'

const PED_PATH = new URL('../data/pedigree/genesys-ancestry.json', import.meta.url)
const pedFile = JSON.parse(readFileSync(PED_PATH, 'utf8')) as {
  varieties: { crop: string; name: string; pedigree: string }[]
}
const pedByVariety = new Map(pedFile.varieties.map((v) => [v.name, v]))

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// ── 1. Parser sanity ────────────────────────────────────────────────────────
{
  const t1 = ancestorVector('Debian', '(Tobak x Elixer) x Forum')
  check('parser: Debian weights {self 1, tobak 1/4, elixer 1/4, forum 1/2}',
    Math.abs((t1.get('tobak') ?? 0) - 0.25) < 1e-12
    && Math.abs((t1.get('forum') ?? 0) - 0.5) < 1e-12
    && Math.abs((t1.get('elixer') ?? 0) - 0.25) < 1e-12
    && Math.abs((t1.get('debian') ?? 0) - 1) < 1e-12)

  const t2 = ancestorVector('Akteur', '87-308/Astron//Astron')
  check('parser: backcross Astron//Astron gives astron 1/2+1/4',
    Math.abs((t2.get('astron') ?? 0) - 0.75) < 1e-12)

  const node = parseCrossNotation('A/B/C')
  check('parser: sequential split is binary', node.kind === 'cross' && node.right.kind === 'leaf')

  const t3 = ancestorVector('X', 'Multiweiss 2*/Jubilar')
  check('parser: backcross marker stripped', t3.has('multiweiss') && t3.has('jubilar'))
}

// ── 2.+3. Kernel over the full catalog ──────────────────────────────────────
const catalog = loadBsaUnionCatalog()
const names = catalog.ids as string[]
const vectors = names.map((n) => ancestorVector(n, pedByVariety.get(n)?.pedigree ?? ''))
const K: number[][] = vectors.map((va) => vectors.map((vb) => kinship(va, vb)))

{
  const n = names.length
  const diagOk = K.every((row, i) => Math.abs(row[i]! - 1) < 1e-12)
  const symOk = K.every((row, i) => row.every((v, j) => Math.abs(v - K[j]![i]!) < 1e-12))
  const rangeOk = K.every((row) => row.every((v) => v >= -1e-12 && v <= 1 + 1e-9))
  check(`kernel over ${n} catalog varieties: diagonal 1`, diagOk)
  check('kernel symmetric', symOk)
  check('kernel values in [0,1]', rangeOk)

  const eig = symmetricEigenvalues(K)
  const min = Math.min(...eig)
  check('kernel PSD (min eigenvalue >= -1e-9)', min >= -1e-9, `min λ = ${min.toExponential(2)}`)
}

// ── 4. Ground-truth pairs, string-level against the official pedigree data ──
// (kinshipOf is independent of catalog membership — some parents like Tobak or
//  RGT Reform fell to the union catalog's hygiene gate, their pedigree record
//  still exists in genesys-ancestry.json)
{
  const ped = (n: string) => pedByVariety.get(n)?.pedigree ?? ''

  const donTob = kinshipOf('KWS Donovan', ped('KWS Donovan'), 'Tobak', ped('Tobak'))
  check('KWS Donovan = Tobak x Anapolis -> K(Donovan,Tobak) >= 0.3', donTob >= 0.3, donTob.toFixed(3))

  const knutReform = kinshipOf('Knut', ped('Knut'), 'RGT Reform', ped('RGT Reform'))
  check('Knut = Sheriff x RGT Reform -> K(Knut,Reform) >= 0.3', knutReform >= 0.3, knutReform.toFixed(3))

  const debTob = kinshipOf('Debian', ped('Debian'), 'Tobak', ped('Tobak'))
  check('Debian = (Tobak x Elixer) x Forum -> K(Debian,Tobak) in [0.15,0.5]',
    debTob >= 0.15 && debTob <= 0.5, debTob.toFixed(3))

  const unrelated = kinshipOf('Bussard', ped('Bussard'), 'Faxe', ped('Faxe'))
  check('unrelated breeding programs stay at 0', unrelated === 0, unrelated.toFixed(3))

  // matrix == string-level agreement on a real in-catalog pair with shared ancestry
  const withPed = names.filter((n) => pedByVariety.has(n))
  let agreed = false, shown = ''
  outer: for (const a of withPed) {
    for (const b of withPed) {
      if (a === b) continue
      const mat = K[names.indexOf(a)]![names.indexOf(b)]!
      if (mat > 0.2) {
        const str = kinshipOf(a, ped(a), b, ped(b))
        agreed = Math.abs(mat - str) < 1e-12
        shown = `${a}~${b} K=${mat.toFixed(3)}`
        break outer
      }
    }
  }
  check('matrix == string-level kinship on in-catalog pair', agreed, shown)
}

// ── 5. Fusion smoke test (PSD preservation) ─────────────────────────────────
{
  // stand-in trait kernel: identity (PSD), fused must stay PSD
  const traits = K.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)))
  const fused = fuseKernels(traits, K, 0.3)
  const eig = symmetricEigenvalues(fused)
  const min = Math.min(...eig)
  check('convex fusion trait+pedigree stays PSD', min >= -1e-9, `min λ = ${min.toExponential(2)}`)

  let threw = false
  try { fuseKernels(traits, K, 1.5) } catch { threw = true }
  check('fusion rejects gamma > 1', threw)
}

// ── Coverage summary ─────────────────────────────────────────────────────────
{
  const withPed = names.filter((n) => pedByVariety.has(n)).length
  console.log(`\ncoverage: ${withPed}/${names.length} catalog varieties with pedigree data`)
  // densest connected pair overall (sanity glimpse)
  let best = { a: '', b: '', v: 0 }
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const v = K[i]![j]!
      if (v > best.v && names[i] !== names[j]) best = { a: names[i]!, b: names[j]!, v }
    }
  }
  console.log(`closest non-identical pair: ${best.a} ~ ${best.b} (K=${best.v.toFixed(3)})`)
}

console.log(failures === 0 ? '\nALL PEDIGREE CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
