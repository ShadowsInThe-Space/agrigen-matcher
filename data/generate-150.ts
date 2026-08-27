/**
 * Deterministic generator for the 150-accession demo catalog (data/eurisco_150.json).
 *
 * Transparency contract: the catalog is MODELED sample data in EURISCO JSON
 * format, not a real EURISCO export. The original 12 hand-crafted accessions
 * (EUR-001..012 from data/sample_eurisco.json) are kept verbatim; EUR-013..150
 * are generated from agronomically plausible per-genus profiles WITH trait
 * correlations, so the kernel sees realistic structure:
 *
 *   - drought tolerance ↔ deeper roots, lower water requirement
 *   - cold ↔ heat tolerance anti-correlated (climate adaptation)
 *   - legumes skew high on nitrogen efficiency
 *   - growing days / yield / root depth follow per-genus realistic ranges
 *     (grain dry-mass vs. root/tuber fresh-mass stay in their crop groups —
 *     the crop-group yield normalization depends on that separation)
 *
 * Run: node data/generate-150.ts   (seed fixed → byte-identical output)
 */

import { readFileSync, writeFileSync } from 'node:fs'

interface GenusProfile {
  genus: string
  species: string
  group: 'cereal' | 'legume' | 'root_tuber' | 'oilseed'
  days: [number, number]
  yieldRange: [number, number]
  water: [number, number]
  root: [number, number]
  /** Relative frequency in the catalog. */
  weight: number
  /** Botanical hard limits on climate adaptation (tropical/temperate origin). */
  coldRange: [number, number]
  heatRange: [number, number]
}

const GENERA: GenusProfile[] = [
  { genus: 'Triticum', species: 'aestivum', group: 'cereal', days: [240, 300], yieldRange: [5.5, 11.0], water: [450, 700], root: [90, 160], weight: 4, coldRange: [4, 10], heatRange: [2, 8] },
  { genus: 'Hordeum', species: 'vulgare', group: 'cereal', days: [130, 190], yieldRange: [5.0, 9.5], water: [420, 650], root: [80, 150], weight: 3, coldRange: [4, 10], heatRange: [2, 9] },
  { genus: 'Avena', species: 'sativa', group: 'cereal', days: [140, 190], yieldRange: [4.5, 8.0], water: [480, 680], root: [70, 130], weight: 2, coldRange: [4, 10], heatRange: [2, 8] },
  { genus: 'Secale', species: 'cereale', group: 'cereal', days: [240, 290], yieldRange: [4.0, 7.5], water: [380, 560], root: [100, 190], weight: 2, coldRange: [5, 10], heatRange: [2, 8] },
  { genus: 'Sorghum', species: 'bicolor', group: 'cereal', days: [100, 135], yieldRange: [5.5, 9.5], water: [300, 450], root: [150, 210], weight: 3, coldRange: [1, 4], heatRange: [6, 10] },
  { genus: 'Zea', species: 'mays', group: 'cereal', days: [95, 150], yieldRange: [8.0, 14.0], water: [350, 550], root: [120, 190], weight: 3, coldRange: [2, 6], heatRange: [5, 10] },
  { genus: 'Glycine', species: 'max', group: 'legume', days: [110, 155], yieldRange: [2.5, 4.8], water: [400, 600], root: [90, 160], weight: 2, coldRange: [3, 7], heatRange: [4, 9] },
  { genus: 'Phaseolus', species: 'vulgaris', group: 'legume', days: [85, 120], yieldRange: [1.8, 3.5], water: [280, 450], root: [70, 130], weight: 2, coldRange: [2, 5], heatRange: [4, 10] },
  { genus: 'Vicia', species: 'faba', group: 'legume', days: [120, 170], yieldRange: [3.0, 5.5], water: [400, 620], root: [80, 140], weight: 2, coldRange: [4, 9], heatRange: [2, 8] },
  { genus: 'Solanum', species: 'tuberosum', group: 'root_tuber', days: [100, 160], yieldRange: [35, 60], water: [400, 620], root: [40, 80], weight: 3, coldRange: [3, 8], heatRange: [3, 9] },
  { genus: 'Beta', species: 'vulgaris', group: 'root_tuber', days: [150, 210], yieldRange: [55, 85], water: [450, 650], root: [80, 140], weight: 3, coldRange: [4, 8], heatRange: [3, 8] },
  { genus: 'Helianthus', species: 'annuus', group: 'oilseed', days: [100, 140], yieldRange: [2.2, 4.2], water: [320, 500], root: [120, 190], weight: 2, coldRange: [2, 6], heatRange: [4, 9] },
]

const COUNTRIES = [
  'Germany', 'Spain', 'Sweden', 'Netherlands', 'France', 'Italy', 'Denmark', 'Finland',
  'Poland', 'Hungary', 'Austria', 'Portugal', 'Greece', 'Romania', 'Czechia', 'France',
]
const STATUSES = ['Bred_cultivar', 'Bred_cultivar', 'Bred_cultivar', 'Landrace', 'Breeding_research']

/**
 * Climate adaptation by origin: Nordic material skews cold-tolerant,
 * Mediterranean material skews heat-tolerant. Without this, a Greek faba bean
 * could roll extreme cold tolerance — internally consistent, agronomically
 * implausible (caught in loop pass 5 when it won the Nordic scenario).
 */
const COUNTRY_CLIMATE: Record<string, { cold: number, heat: number }> = {
  Finland: { cold: 3, heat: -2 },
  Sweden: { cold: 3, heat: -2 },
  Denmark: { cold: 2, heat: -1 },
  Poland: { cold: 2, heat: -1 },
  Germany: { cold: 1, heat: 0 },
  Netherlands: { cold: 1, heat: 0 },
  Austria: { cold: 1, heat: 0 },
  Czechia: { cold: 1, heat: 0 },
  France: { cold: 0, heat: 1 },
  Hungary: { cold: 0, heat: 1 },
  Romania: { cold: 0, heat: 1 },
  Spain: { cold: -2, heat: 3 },
  Italy: { cold: -2, heat: 3 },
  Greece: { cold: -2, heat: 3 },
  Portugal: { cold: -3, heat: 3 },
}

/** Trait-leader name prefixes, mirroring the original hand-crafted style. */
const NAME_PREFIX_BY_LEADER: Record<string, string[]> = {
  drought: ['DryLand', 'AquaSave', 'SaharaLine'],
  heat: ['HeatGuard', 'SunShield', 'Solstice'],
  cold: ['FrostLine', 'Nordkraft', 'PolarStar'],
  disease: ['ShieldKorn', 'VitaGuard', 'ResistPlus'],
  nitrogen: ['NitroFix', 'GreenNitro', 'LeguStrong'],
  salinity: ['SaltGuard', 'SalTerra', 'BrackLine'],
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function pick<T>(random: () => number, items: T[]): T {
  return items[Math.floor(random() * items.length)]!
}

function buildWeightedPool(): GenusProfile[] {
  const pool: GenusProfile[] = []
  for (const profile of GENERA) {
    for (let i = 0; i < profile.weight; i++) pool.push(profile)
  }
  return pool
}

function generateRecords(count: number, seed: number) {
  const random = mulberry32(seed)
  const pool = buildWeightedPool()
  const records = []
  for (let index = 0; index < count; index++) {
    const profile = pick(random, pool)
    const country = pick(random, COUNTRIES)
    const climate = COUNTRY_CLIMATE[country]!
    // Climate adaptation: cold and heat fight for the same adaptation budget,
    // shifted by the origin's climate (Nordic ↔ Mediterranean).
    const coldTolerance = Math.round(clamp(
      2 + random() * 8 + climate.cold, profile.coldRange[0], profile.coldRange[1]))
    const heatTolerance = Math.round(clamp(
      10.5 - coldTolerance + (random() - 0.5) * 3 + climate.heat, profile.heatRange[0], profile.heatRange[1]))
    const droughtTolerance = Math.round(clamp(2 + random() * 8 + (heatTolerance - 5) * 0.4, 1, 10))
    // Drought adaptation expresses in roots and water demand.
    const rootDepth = Math.round(clamp(
      profile.root[0] + random() * (profile.root[1] - profile.root[0]) + (droughtTolerance - 5) * 8,
      profile.root[0] - 10, profile.root[1] + 25))
    const waterRequirement = Math.round(clamp(
      profile.water[1] - random() * (profile.water[1] - profile.water[0]) - (droughtTolerance - 5) * 18,
      profile.water[0], profile.water[1]))
    const nitrogenEfficiency = profile.group === 'legume'
      ? Math.round(clamp(7 + random() * 3, 5, 10))
      : Math.round(clamp(4 + random() * 5, 3, 9))
    const salinityTolerance = Math.round(clamp(2 + random() * 7 + (profile.group === 'cereal' ? 0.5 : 0), 1, 10))
    const diseaseResistance = Math.round(clamp(4 + random() * 5, 3, 9))
    const soilPhMin = Math.round((4.8 + random() * 1.8) * 10) / 10
    const soilPhMax = Math.round(Math.min(8.5, soilPhMin + 0.8 + random() * 1.8) * 10) / 10
    const growingDays = Math.round(profile.days[0] + random() * (profile.days[1] - profile.days[0]))
    const yieldPotential = Math.round((profile.yieldRange[0] + random() * (profile.yieldRange[1] - profile.yieldRange[0])) * 10) / 10

    const traits = {
      drought_tolerance: droughtTolerance,
      heat_tolerance: heatTolerance,
      cold_tolerance: coldTolerance,
      disease_resistance: diseaseResistance,
      soil_ph_min: soilPhMin,
      soil_ph_max: soilPhMax,
      growing_days: growingDays,
      yield_potential_t_ha: yieldPotential,
      water_requirement_mm: waterRequirement,
      nitrogen_efficiency: nitrogenEfficiency,
      salinity_tolerance: salinityTolerance,
      root_depth_cm: rootDepth,
    }

    const leader = (Object.keys(NAME_PREFIX_BY_LEADER) as (keyof typeof traits)[])
      .reduce((best, key) => (traits[key] as number) > (traits[best] as number) ? key : best)
    const prefix = pick(random, NAME_PREFIX_BY_LEADER[leader]!)
    const serial = String(13 + index).padStart(2, '0')

    records.push({
      accession_id: `EUR-${String(13 + index).padStart(3, '0')}`,
      genus: profile.genus,
      species: profile.species,
      cultivar: `${prefix}-${serial}`,
      origin_country: country,
      biological_status: pick(random, STATUSES),
      traits,
    })
  }
  return records
}

function main(): void {
  const originals = JSON.parse(readFileSync(new URL('./sample_eurisco.json', import.meta.url), 'utf8'))
  const generated = generateRecords(138, 20260827)
  const catalog = [...originals, ...generated]
  const seen = new Set<string>()
  for (const record of catalog) {
    const key = Object.values(record.traits).join(',')
    if (seen.has(key)) throw new Error(`duplicate trait vector: ${record.accession_id}`)
    seen.add(key)
  }
  writeFileSync(new URL('./eurisco_150.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n')
  console.log(`OK: ${catalog.length} Datensätze geschrieben (12 originale + ${generated.length} generierte)`)
}

main()
