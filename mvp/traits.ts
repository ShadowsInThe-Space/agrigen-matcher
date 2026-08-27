/**
 * AgriGen feature space: 12 quantitative crop traits normalized to [0,1],
 * plus extraction of farmer requirements into a query feature vector + mask.
 *
 * AgriGen equivalent of SeedShuffle's queryFeatureExtractor: structured
 * requirements make the RBF kernel query-dependent instead of measuring
 * "closeness to the catalog average". Unspecified requirements get mask = 0
 * and are excluded from the kernel distance — never an invented midpoint.
 *
 * Normalization contract (catalog pipeline):
 *   - 1–10 rating scales  → (value - 1) / 9   (absolute scale semantics)
 *   - physical units      → min-max over the loaded catalog
 */

export const TRAIT_NAMES = [
  'drought_tolerance', 'heat_tolerance', 'cold_tolerance', 'disease_resistance',
  'nitrogen_efficiency', 'salinity_tolerance',
  'soil_ph_min', 'soil_ph_max', 'growing_days', 'yield_potential',
  'water_requirement', 'root_depth',
] as const

export interface AccessionRecord {
  accession_id: string
  genus: string
  species: string
  cultivar: string
  origin_country: string
  biological_status: string
  traits: Record<string, number>
}

export interface Catalog {
  ids: string[]
  labels: string[]
  rows: number[][]
}

/** Structured farmer requirements — the AgriGen "Match Wizard" input. */
export interface FarmingRequirements {
  droughtTolerance?: 'low' | 'moderate' | 'high' | 'extreme'
  heatTolerance?: 'low' | 'moderate' | 'high' | 'extreme'
  coldTolerance?: 'low' | 'moderate' | 'high' | 'extreme'
  diseaseResistance?: 'low' | 'moderate' | 'high' | 'extreme'
  nitrogenEfficiency?: 'low' | 'moderate' | 'high' | 'extreme'
  salinityTolerance?: 'low' | 'moderate' | 'high' | 'extreme'
  soilPh?: 'acidic' | 'neutral' | 'alkaline'
  seasonLength?: 'short' | 'medium' | 'long'
  waterAvailability?: 'low' | 'moderate' | 'high'
  yieldPriority?: 'low' | 'high'
  rooting?: 'shallow' | 'deep'
}

/** Level → normalized target. Deliberately not 0/1 extremes: a request is a preference, not a bound. */
const LEVEL: Record<string, number> = { low: 0.15, moderate: 0.45, high: 0.75, extreme: 0.9 }

const idx = (name: string) => TRAIT_NAMES.indexOf(name as (typeof TRAIT_NAMES)[number])

function minMaxNormalizer(records: AccessionRecord[], key: string): (value: number) => number {
  const values = records.map(record => record.traits[key])
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return () => 0.5
  return value => (value - min) / (max - min)
}

/** Build the normalized [0,1] catalog feature matrix (SeedShuffle data contract). */
export function buildCatalog(records: AccessionRecord[]): Catalog {
  const rating = (value: number) => (value - 1) / 9
  const normPhMin = minMaxNormalizer(records, 'soil_ph_min')
  const normPhMax = minMaxNormalizer(records, 'soil_ph_max')
  const normDays = minMaxNormalizer(records, 'growing_days')
  const normYield = minMaxNormalizer(records, 'yield_potential_t_ha')
  const normWater = minMaxNormalizer(records, 'water_requirement_mm')
  const normRoot = minMaxNormalizer(records, 'root_depth_cm')

  const rows = records.map(record => {
    const t = record.traits
    return [
      rating(t.drought_tolerance), rating(t.heat_tolerance), rating(t.cold_tolerance),
      rating(t.disease_resistance), rating(t.nitrogen_efficiency), rating(t.salinity_tolerance),
      normPhMin(t.soil_ph_min), normPhMax(t.soil_ph_max),
      normDays(t.growing_days), normYield(t.yield_potential_t_ha),
      normWater(t.water_requirement_mm), normRoot(t.root_depth_cm),
    ]
  })
  return {
    ids: records.map(record => record.accession_id),
    labels: records.map(record => `${record.genus} ${record.species} '${record.cultivar}' (${record.origin_country})`),
    rows,
  }
}

/**
 * Extract a quantitative query vector from structured farmer requirements.
 * Only specified requirements become active kernel dimensions (mask = 1).
 * Pure function — no data dependencies.
 */
export function extractRequirements(
  requirements: FarmingRequirements,
): { vector: number[], mask: number[], activeCount: number } {
  const vector = new Array(TRAIT_NAMES.length).fill(0)
  const mask = new Array(TRAIT_NAMES.length).fill(0)
  const set = (name: string, value: number) => {
    const i = idx(name)
    if (i >= 0) { vector[i] = value; mask[i] = 1 }
  }
  const level = (value: 'low' | 'moderate' | 'high' | 'extreme') => LEVEL[value]

  if (requirements.droughtTolerance) set('drought_tolerance', level(requirements.droughtTolerance))
  if (requirements.heatTolerance) set('heat_tolerance', level(requirements.heatTolerance))
  if (requirements.coldTolerance) set('cold_tolerance', level(requirements.coldTolerance))
  if (requirements.diseaseResistance) set('disease_resistance', level(requirements.diseaseResistance))
  if (requirements.nitrogenEfficiency) set('nitrogen_efficiency', level(requirements.nitrogenEfficiency))
  if (requirements.salinityTolerance) set('salinity_tolerance', level(requirements.salinityTolerance))

  if (requirements.soilPh) {
    const target = requirements.soilPh === 'acidic' ? 0.15 : requirements.soilPh === 'alkaline' ? 0.85 : 0.5
    set('soil_ph_min', target)
    set('soil_ph_max', target)
  }
  if (requirements.seasonLength) {
    set('growing_days', requirements.seasonLength === 'short' ? 0.15 : requirements.seasonLength === 'long' ? 0.85 : 0.5)
  }
  if (requirements.waterAvailability) set('water_requirement', level(requirements.waterAvailability))
  if (requirements.yieldPriority) set('yield_potential', requirements.yieldPriority === 'high' ? 0.85 : 0.15)
  if (requirements.rooting) set('root_depth', requirements.rooting === 'deep' ? 0.85 : 0.2)

  return { vector, mask, activeCount: mask.reduce((sum, flag) => sum + flag, 0) }
}
