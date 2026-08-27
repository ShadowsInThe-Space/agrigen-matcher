/**
 * AgriGen Matcher MVP demo — RKHS variety matching on EURISCO sample data.
 *
 * Pipeline: EURISCO JSON → normalize [0,1] → RBF kernel (γ via median
 * heuristic) → masked, query-dependent kernel scores (= RKHS cosine, since
 * K(x,x)=1) → Match-Score %.
 *
 * Run: node --experimental-strip-types mvp/demo.ts
 */

import { readFileSync } from 'node:fs'
import { dimensionNormalizedRbf, medianHeuristicGamma, validateFeatureRanges } from './kernelMath.ts'
import { matrixRank, symmetricEigenvalues } from './metrics.ts'
import { buildCatalog, extractRequirements, type AccessionRecord, type Catalog, type FarmingRequirements } from './traits.ts'

const DATA_PATH = new URL('../data/sample_eurisco.json', import.meta.url)

interface Scenario {
  title: string
  subtitle: string
  requirements: FarmingRequirements
}

const SCENARIOS: Scenario[] = [
  {
    title: 'SZENARIO A — Dürre & Hitze (Südeuropa)',
    subtitle: 'Extreme Trockenheit, hohe Hitze, knappe Wasserressourcen, mäßige Salinität',
    requirements: { droughtTolerance: 'extreme', heatTolerance: 'high', waterAvailability: 'low', salinityTolerance: 'moderate' },
  },
  {
    title: 'SZENARIO B — Kälte & kurze Saison (Nordeuropa)',
    subtitle: 'Extreme Kälte, kurze Vegetationsperiode, hoher Resistenzzüchtungsdruck',
    requirements: { coldTolerance: 'extreme', seasonLength: 'short', diseaseResistance: 'high' },
  },
  {
    title: 'SZENARIO C — Low-Input & Stickstoffeffizienz',
    subtitle: 'Maximale N-Effizienz (leguminosenähnlich), hoher Ertragsfokus, moderate Wasserlage',
    requirements: { nitrogenEfficiency: 'extreme', yieldPriority: 'high', waterAvailability: 'moderate' },
  },
]

function loadCatalog(): Catalog {
  const records: AccessionRecord[] = JSON.parse(readFileSync(DATA_PATH, 'utf8'))
  if (!Array.isArray(records) || records.length === 0) throw new Error('EURISCO dataset is empty')
  return buildCatalog(records)
}

function topMatches(catalog: Catalog, query: number[], queryMask: number[], gamma: number, count = 5) {
  return catalog.ids
    .map((id, index) => ({
      id,
      label: catalog.labels[index]!,
      score: dimensionNormalizedRbf(query, catalog.rows[index]!, queryMask, gamma),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
}

function main(): void {
  const catalog = loadCatalog()
  const n = catalog.rows.length
  const dimensions = catalog.rows[0]!.length

  // Trust boundary: the kernel expects pre-normalized [0,1] features.
  validateFeatureRanges(catalog.rows)

  const gamma = medianHeuristicGamma(catalog.rows)

  // Full 12×12 kernel matrix (all catalog pairs, all dimensions active).
  const allOnes = new Array(dimensions).fill(1)
  const kernelMatrix = catalog.rows.map(rowA =>
    catalog.rows.map(rowB => dimensionNormalizedRbf(rowA, rowB, allOnes, gamma)),
  )
  const rank = matrixRank(kernelMatrix)
  const trace = kernelMatrix.reduce((sum, row, i) => sum + row[i]!, 0)
  const minEigenvalue = Math.min(...symmetricEigenvalues(kernelMatrix))

  const line = '─'.repeat(74)
  console.log('╔' + '═'.repeat(72) + '╗')
  console.log('║ AgriGen Matcher — RKHS Sorten-Matching (MVP)'.padEnd(73) + '║')
  console.log('║ RBF-Kernel im Hilbert-Raum · Port des produktionserprobten SeedShuffle-Kerns'.padEnd(73) + '║')
  console.log('╚' + '═'.repeat(72) + '╝')
  console.log(`Katalog: ${n} EURISCO-Accessionen × ${dimensions} Traits (normalisiert [0,1])`)
  console.log(`γ (Median-Heuristik) = ${gamma.toFixed(4)}`)
  console.log(`Kernel-Matrix ${n}×${n}: Rang ${rank}/${n} · Spur ${trace.toFixed(3)} · min-λ = ${minEigenvalue.toExponential(2)} (PSD ✓)`)
  console.log(line)

  for (const scenario of SCENARIOS) {
    const { vector, mask, activeCount } = extractRequirements(scenario.requirements)
    const matches = topMatches(catalog, vector, mask, gamma)
    console.log()
    console.log(scenario.title)
    console.log(`  ${scenario.subtitle}`)
    console.log(`  Aktive Query-Dimensionen: ${activeCount}/${dimensions}`)
    console.log(`  ${'Rang'.padEnd(5)}${'Accession'.padEnd(11)}${'Sorte'.padEnd(46)}Score`)
    matches.forEach((match, position) => {
      const cultivar = match.label.slice(0, 44)
      console.log(`  ${String(position + 1).padEnd(5)}${match.id.padEnd(11)}${cultivar.padEnd(46)}${(match.score * 100).toFixed(1)} %`)
    })
    const gap = (matches[0]!.score - matches[1]!.score) * 100
    console.log(`  → Top-Treffer: ${matches[0]!.label} — Abstand zum Zweitplatzierten: ${gap.toFixed(1)} %-Punkte`)
    console.log(line)
  }

  console.log()
  console.log('Technik: K(x,y) = exp(-γ·d̄²(x,y)) mit maskierter Mitteldistanz;')
  console.log('da K(x,x)=1 ist der Kernelwert zugleich die RKHS-Kosinusähnlichkeit.')
}

main()
