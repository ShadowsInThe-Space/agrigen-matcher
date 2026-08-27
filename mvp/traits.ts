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
 *   - yield_potential     → min-max per crop group (CROP_GROUPS, Fix P1)
 */

import { TRAIT_DIRECTIONS, type TraitDirection } from './scoring.ts'

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

/**
 * Genus → crop group mapping for group-wise yield normalization (Fix P1).
 * Explicit const map so tests can assert group membership directly. Genera
 * not listed fall back to forming their own (single-member) group.
 */
export const CROP_GROUPS: Readonly<Record<string, string>> = {
  Triticum: 'cereal', Hordeum: 'cereal', Avena: 'cereal', Secale: 'cereal',
  Sorghum: 'cereal', Zea: 'cereal',
  Glycine: 'legume', Phaseolus: 'legume', Vicia: 'legume',
  Solanum: 'root_tuber', Beta: 'root_tuber',
  Helianthus: 'oilseed',
}

const cropGroupOf = (record: AccessionRecord): string => CROP_GROUPS[record.genus] ?? record.genus

function minMaxNormalizer(records: AccessionRecord[], key: string): (value: number) => number {
  const values = records.map(record => record.traits[key])
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return () => 0.5
  return value => (value - min) / (max - min)
}

/**
 * Group-wise min-max normalization (Fix P1): the score expresses the
 * relative position within comparable harvest-product classes, because grain
 * dry-matter yields (cereals, legumes, oilseeds) and fresh-mass yields
 * (root/tuber crops — 75 t/ha sugar beet vs. 9 t/ha wheat) are
 * incommensurable; a global min-max would push every grain crop to the
 * bottom of the yield axis regardless of the query. A single-member group
 * (oilseed/Helianthus in the sample) has no relative position within its
 * class — it gets the neutral 0.5 instead of an artificial 0/1 extreme.
 * Degenerate groups (min === max) are neutral for the same reason.
 */
function cropGroupNormalizer(records: AccessionRecord[], key: string): (record: AccessionRecord) => number {
  const bounds = new Map<string, { min: number, max: number }>()
  for (const record of records) {
    const value = record.traits[key]
    const group = cropGroupOf(record)
    const bound = bounds.get(group)
    if (bound === undefined) bounds.set(group, { min: value, max: value })
    else bounds.set(group, { min: Math.min(bound.min, value), max: Math.max(bound.max, value) })
  }
  return record => {
    const bound = bounds.get(cropGroupOf(record))!
    if (bound.max === bound.min) return 0.5
    return (record.traits[key] - bound.min) / (bound.max - bound.min)
  }
}

/** Build the normalized [0,1] catalog feature matrix (SeedShuffle data contract). */
export function buildCatalog(records: AccessionRecord[]): Catalog {
  const rating = (value: number) => (value - 1) / 9
  const normPhMin = minMaxNormalizer(records, 'soil_ph_min')
  const normPhMax = minMaxNormalizer(records, 'soil_ph_max')
  const normDays = minMaxNormalizer(records, 'growing_days')
  const normYield = cropGroupNormalizer(records, 'yield_potential_t_ha')
  const normWater = minMaxNormalizer(records, 'water_requirement_mm')
  const normRoot = minMaxNormalizer(records, 'root_depth_cm')

  const rows = records.map(record => {
    const t = record.traits
    return [
      rating(t.drought_tolerance), rating(t.heat_tolerance), rating(t.cold_tolerance),
      rating(t.disease_resistance), rating(t.nitrogen_efficiency), rating(t.salinity_tolerance),
      normPhMin(t.soil_ph_min), normPhMax(t.soil_ph_max),
      normDays(t.growing_days), normYield(record),
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
 * The returned `directions` record covers exactly the active dimensions and
 * is derived from the static TRAIT_DIRECTIONS table (scoring.ts) plus the
 * dynamic growing_days rule (seasonLength short → cost, long → benefit,
 * medium → target). Pure function — no data dependencies.
 */
export function extractRequirements(
  requirements: FarmingRequirements,
): { vector: number[], mask: number[], activeCount: number, directions: Record<string, TraitDirection> } {
  const vector = new Array(TRAIT_NAMES.length).fill(0)
  const mask = new Array(TRAIT_NAMES.length).fill(0)
  const directions: Record<string, TraitDirection> = {}
  const set = (name: string, value: number, direction: TraitDirection) => {
    const i = idx(name)
    if (i >= 0) { vector[i] = value; mask[i] = 1; directions[name] = direction }
  }
  const staticDirection = (name: string): TraitDirection => {
    const direction = TRAIT_DIRECTIONS[name]
    if (direction === undefined) throw new Error(`No static trait direction for '${name}'`)
    return direction
  }
  const level = (value: 'low' | 'moderate' | 'high' | 'extreme') => LEVEL[value]

  if (requirements.droughtTolerance) set('drought_tolerance', level(requirements.droughtTolerance), staticDirection('drought_tolerance'))
  if (requirements.heatTolerance) set('heat_tolerance', level(requirements.heatTolerance), staticDirection('heat_tolerance'))
  if (requirements.coldTolerance) set('cold_tolerance', level(requirements.coldTolerance), staticDirection('cold_tolerance'))
  if (requirements.diseaseResistance) set('disease_resistance', level(requirements.diseaseResistance), staticDirection('disease_resistance'))
  if (requirements.nitrogenEfficiency) set('nitrogen_efficiency', level(requirements.nitrogenEfficiency), staticDirection('nitrogen_efficiency'))
  if (requirements.salinityTolerance) set('salinity_tolerance', level(requirements.salinityTolerance), staticDirection('salinity_tolerance'))

  if (requirements.soilPh) {
    const target = requirements.soilPh === 'acidic' ? 0.15 : requirements.soilPh === 'alkaline' ? 0.85 : 0.5
    set('soil_ph_min', target, staticDirection('soil_ph_min'))
    set('soil_ph_max', target, staticDirection('soil_ph_max'))
  }
  if (requirements.seasonLength) {
    // Direction is intent-dependent: 'short' rejects long seasons (cost),
    // 'long' rejects short seasons (benefit), 'medium' is two-sided (target).
    const direction: TraitDirection =
      requirements.seasonLength === 'short' ? 'cost' :
      requirements.seasonLength === 'long' ? 'benefit' : 'target'
    set('growing_days', requirements.seasonLength === 'short' ? 0.15 : requirements.seasonLength === 'long' ? 0.85 : 0.5, direction)
  }
  if (requirements.waterAvailability) set('water_requirement', level(requirements.waterAvailability), staticDirection('water_requirement'))
  if (requirements.yieldPriority) set('yield_potential', requirements.yieldPriority === 'high' ? 0.85 : 0.15, staticDirection('yield_potential'))
  if (requirements.rooting) set('root_depth', requirements.rooting === 'deep' ? 0.85 : 0.2, staticDirection('root_depth'))

  return { vector, mask, activeCount: mask.reduce((sum, flag) => sum + flag, 0), directions }
}
