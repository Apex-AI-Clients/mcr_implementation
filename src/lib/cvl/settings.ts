import type { getSupabaseServerClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database'

/**
 * The CVL settings page (cvl_settings, migration 0039): every item still to
 * be confirmed, listed as "To be confirmed" until it is.
 *
 * None has a default. An item not set leaves its boxes on the forms blank
 * and says so beside them; staff can fill them on the form instead.
 *
 * Not a setting: every director has their own Part B (settled 3 Nov 2026).
 */

export const LIQUIDATOR_FIELDS = [
  ['name', 'Liquidator name'],
  ['number', 'ASIC registered liquidator number'],
  ['contactName', 'Contact person'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['postal1', 'Postal address (line 1)'],
  ['postal2', 'Postal address (line 2)'],
  ['agentNumber', 'ASIC registered agent number'],
] as const
export type LiquidatorField = (typeof LIQUIDATOR_FIELDS)[number][0]
export type LiquidatorDetails = Partial<Record<LiquidatorField, string>>

export const MCR_COMPANY_FIELDS = [
  ['companyName', 'Company name'],
  ['acn', 'ACN'],
  ['address', 'Address'],
] as const
export type McrCompanyField = (typeof MCR_COMPANY_FIELDS)[number][0]
export type McrCompanyDetails = Partial<Record<McrCompanyField, string>>

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

export type SettingKey = 'mcr_company' | 'liquidator' | `f509_place.${PlacementKey}`

export const SETTING_KEYS: SettingKey[] = [
  'mcr_company',
  'liquidator',
  ...PLACEMENT_KEYS.map((k) => `f509_place.${k}` as const),
]

export interface CvlSettings {
  mcrCompany: McrCompanyDetails
  liquidator: LiquidatorDetails
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
    mcrCompany: strings(value('mcr_company'), MCR_COMPANY_FIELDS),
    liquidator: strings(value('liquidator'), LIQUIDATOR_FIELDS),
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
  if (key === 'mcr_company') return strings(value, MCR_COMPANY_FIELDS) as Json
  if (key === 'liquidator') return strings(value, LIQUIDATOR_FIELDS) as Json
  const placement = key.slice('f509_place.'.length) as PlacementKey
  if (typeof value === 'string' && value in PLACEMENTS[placement].options) return value
  throw new Error('Unknown placement')
}

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as string[]).includes(key)
}

/** The details the forms need that are still blank, by label, for the warnings beside them. */
export function missingSettings(s: CvlSettings): string[] {
  return [
    ...MCR_COMPANY_FIELDS.filter(([k]) => !s.mcrCompany[k]).map(([, label]) => `MCR ${label.toLowerCase()}`),
    ...LIQUIDATOR_FIELDS.filter(([k]) => k !== 'agentNumber' && !s.liquidator[k]).map(([, label]) => label),
  ]
}

export async function loadCvlSettings(supabase: ReturnType<typeof getSupabaseServerClient>): Promise<CvlSettings> {
  const { data } = await supabase.from('cvl_settings').select('key, value, confirmed, updated_by, updated_at')
  return readCvlSettings(data ?? [])
}
