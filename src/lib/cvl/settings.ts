import type { getSupabaseServerClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database'

/**
 * The CVL settings page (cvl_settings, migration 0039): every item still to
 * be confirmed, listed as "To be confirmed" until it is.
 *
 * Two: Form 509's lodgement details (with starting values, LODGEMENT_DEFAULTS)
 * and Part A's External Administrator (none). An item not set leaves its
 * boxes on the forms blank and says so beside them; staff can fill them on
 * the form instead.
 *
 * Not a setting: every director has their own Part B (settled 3 Nov 2026).
 */

/**
 * Form 507 Part A's "External Administrator" box, one setting per box on the
 * form, in the form's order and words. (Replaces the earlier "MCR company"
 * and "Liquidator" settings, nothing saved under either: 4 Nov 2026.)
 */
export const EA_FIELDS = [
  ['organisation', 'Organisation'],
  ['liquidatorNumber', 'ASIC Registered Liquidator number (if applicable)'],
  ['name', 'Name of External Administrator'],
  ['contact', 'Contact person'],
  ['phone', 'Phone number during business hours'],
  ['address', 'Address (office, building or level)'],
  ['street', 'Street/Unit number and name'],
  ['suburb', 'Suburb/City'],
  ['state', 'State/Territory'],
  ['postcode', 'Postcode'],
] as const
export type EaField = (typeof EA_FIELDS)[number][0]
export type EaDetails = Partial<Record<EaField, string>>
/** Boxes Part A can go without: the extra address line, and the number "if applicable". */
const EA_OPTIONAL: EaField[] = ['address', 'liquidatorNumber']

/** Form 509's "Lodgement details": who lodges the form and who ASIC should contact. */
export const LODGEMENT_FIELDS = [
  ['firm', 'Firm/organisation'],
  ['entityNumber', 'ACN/ABN'],
  ['agentNumber', 'ASIC registered agent number'],
  ['contactName', 'Contact name/position'],
  ['phone', 'Telephone number'],
  ['email', 'Email address'],
  ['postal1', 'Postal address (line 1)'],
  ['postal2', 'Postal address (line 2)'],
] as const
export type LodgementField = (typeof LODGEMENT_FIELDS)[number][0]
export type LodgementDetails = Partial<Record<LodgementField, string>>

/**
 * The lodgement details every Form 509 carries until changed on the settings
 * page: as on the Form 509 MCR lodges with (given 4 Nov 2026). The one
 * setting with a default; saving it replaces these, clearing it brings them back.
 */
export const LODGEMENT_DEFAULTS: LodgementDetails = {
  firm: 'BCR ADVISORY',
  contactName: 'Tom Vandermeer',
  phone: '02 9128 3838',
  email: 'Tom.Vandermeer@bcradvisory.com.au',
  postal1: 'Level 2, 60 Castlereagh Street',
  postal2: 'Sydney NSW 2000',
}

/** Where an amount listed beside Form 509 goes, once Gabby says. `none`: left off the form. */
export const PLACEMENTS = {
  director_loan: {
    label: 'Director loan (owed to the company)',
    options: { b_val: '1(b) Sundry debtors', h_val: '1(h) Other assets', none: 'Leave off the form' },
  },
  financed_vehicles: {
    label: 'Financed vehicles and equipment (chattel mortgage, hire purchase)',
    options: { s2_val: '2 Assets subject to specific charges less amounts owing', r7_claims: '7 Balances owing to partly secured creditors', none: 'Leave off the form' },
  },
  super_payable: {
    label: 'Superannuation payable',
    options: { r3: '3 Preferential creditors', r6: '6 Creditors (unsecured)', none: 'Leave off the form' },
  },
  unsecured_creditors: {
    label: 'Unsecured creditors (ATO, suppliers, cards, director)',
    options: { r6: '6 Creditors (unsecured) amount claimed', none: 'Leave off the form' },
  },
} as const
export type PlacementKey = keyof typeof PLACEMENTS
export const PLACEMENT_KEYS = Object.keys(PLACEMENTS) as PlacementKey[]
/** The Form 509 field a placement fills, or 'none'. */
export type PlacementTarget = 'b_val' | 'h_val' | 's2_val' | 'r7_claims' | 'r3' | 'r6' | 'none'

export type SettingKey = 'external_administrator' | 'lodgement' | `f509_place.${PlacementKey}`

export const SETTING_KEYS: SettingKey[] = [
  'external_administrator',
  'lodgement',
  ...PLACEMENT_KEYS.map((k) => `f509_place.${k}` as const),
]

export interface CvlSettings {
  /** Part A's External Administrator box. */
  externalAdministrator: EaDetails
  /** Form 509's lodgement details: as saved, or LODGEMENT_DEFAULTS until then. */
  lodgement: LodgementDetails
  placements: Partial<Record<PlacementKey, PlacementTarget>>
  /** Per setting: marked confirmed (kept for later; not shown on the settings page). */
  confirmed: Record<SettingKey, boolean>
  /** Who last changed each, and when. */
  updated: Partial<Record<SettingKey, { by: string | null; at: string }>>
}

const strings = <K extends string>(value: unknown, keys: readonly (readonly [K, string])[]): Partial<Record<K, string>> => {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const out: Partial<Record<K, string>> = {}
  for (const [k] of keys) {
    const s = v[k]
    if (typeof s === 'string' && s.trim()) out[k] = s.trim()
  }
  return out
}

/** Stored rows → settings. Anything unreadable reads as not set. Pure. */
export function readCvlSettings(
  rows: readonly { key: string; value: Json | null; confirmed: boolean; updated_by: string | null; updated_at: string }[],
): CvlSettings {
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const value = (k: SettingKey) => byKey.get(k)?.value ?? null
  const placements: CvlSettings['placements'] = {}
  for (const k of PLACEMENT_KEYS) {
    const v = value(`f509_place.${k}`)
    if (typeof v === 'string' && v in PLACEMENTS[k].options) placements[k] = v as PlacementTarget
  }
  return {
    externalAdministrator: strings(value('external_administrator'), EA_FIELDS),
    lodgement: value('lodgement') === null ? { ...LODGEMENT_DEFAULTS } : strings(value('lodgement'), LODGEMENT_FIELDS),
    placements,
    confirmed: Object.fromEntries(SETTING_KEYS.map((k) => [k, byKey.get(k)?.confirmed === true])) as Record<SettingKey, boolean>,
    updated: Object.fromEntries(
      SETTING_KEYS.filter((k) => byKey.has(k)).map((k) => [k, { by: byKey.get(k)!.updated_by, at: byKey.get(k)!.updated_at }]),
    ),
  }
}

/** A value sent to be saved, checked against its setting. null clears it. Throws on anything else. */
export function settingValue(key: SettingKey, value: unknown): Json | null {
  if (value === null) return null
  if (key === 'external_administrator') return strings(value, EA_FIELDS) as Json
  if (key === 'lodgement') return strings(value, LODGEMENT_FIELDS) as Json
  const placement = key.slice('f509_place.'.length) as PlacementKey
  if (typeof value === 'string' && value in PLACEMENTS[placement].options) return value
  throw new Error('Unknown placement')
}

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as string[]).includes(key)
}

/** The details the forms need that are still blank, by label, for the warnings beside them. */
export function missingSettings(s: CvlSettings): string[] {
  return EA_FIELDS.filter(([k]) => !EA_OPTIONAL.includes(k) && !s.externalAdministrator[k]).map(([, label]) => `External Administrator: ${label}`)
}

export async function loadCvlSettings(supabase: ReturnType<typeof getSupabaseServerClient>): Promise<CvlSettings> {
  const { data } = await supabase.from('cvl_settings').select('key, value, confirmed, updated_by, updated_at')
  return readCvlSettings(data ?? [])
}
