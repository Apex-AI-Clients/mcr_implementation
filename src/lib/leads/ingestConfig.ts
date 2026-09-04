import type { AuState } from '@/types/leads'

/**
 * Ingestion mapping, kept as config rather than inline logic.
 *
 * The website's debt select posts positional codes, and Facebook's custom
 * question keys depend on how the form was built — they will differ between the
 * test form and Gabby's real one. Both have to be changeable without touching
 * the mapper.
 */

export interface DebtRange {
  min: number | null
  max: number | null
}

/**
 * The live website form's debt codes (CRM_ADDENDUM.md §2), keyed on the value
 * the select posts.
 *
 * FRAGILE BY CONSTRUCTION: these are positions, not meanings. Reordering the
 * options on the form silently changes what every historical code meant. When
 * the PHP handler is edited, change the option values to explicit slugs and add
 * them below — keep these numeric entries for anything already captured.
 */
export const WEBSITE_DEBT_CODES: Record<string, DebtRange> = {
  '-1': { min: 30_000, max: 49_999 }, // $30,000 – $49,999
  '1': { min: 50_000, max: 74_999 }, // $50,000 – $74,999
  '2': { min: 75_000, max: 99_999 }, // $75,000 – $99,999
  '3': { min: 100_000, max: 124_999 }, // $100,000 – $124,999
  '4': { min: 125_000, max: 149_999 }, // $125,000 – $149,999
  '5': { min: 150_000, max: null }, // $150,000 or +

  // Forward-looking slugs, for once the handler stops posting positions.
  '30k_50k': { min: 30_000, max: 49_999 },
  '50k_75k': { min: 50_000, max: 74_999 },
  '75k_100k': { min: 75_000, max: 99_999 },
  '100k_125k': { min: 100_000, max: 124_999 },
  '125k_150k': { min: 125_000, max: 149_999 },
  '150k_plus': { min: 150_000, max: null },
}

/**
 * How a form asks for debt.
 *
 *   'code'      -> a select posting the positional codes in WEBSITE_DEBT_CODES
 *   'free_text' -> an open input; whatever the visitor typed
 *
 * Per-form, because the same site does both: the select-based forms post codes,
 * while the results form's debt field is an open input whose value is only ever
 * whatever was typed into it. Reading a typed "3" through the code table would
 * silently turn it into $100k-$125k.
 */
export type DebtFieldFormat = 'code' | 'free_text'

export const DEBT_FIELD_FORMAT: Record<string, DebtFieldFormat> = {
  website: 'code',
  website_home: 'code',
  website_inner: 'code',
  website_ads: 'code',
  // The odd one out — free text, and its debt_label is always empty.
  website_results: 'free_text',
  google_form: 'code',
  facebook: 'code',
}

/**
 * Below this, a figure typed into a free-text debt field is not a dollar
 * amount — it is a bracket number, a typo, or a stray keystroke. Treating "3"
 * as three dollars would put "$0k" in the Debt column and sort the lead as the
 * smallest on the list.
 */
export const MIN_PLAUSIBLE_DEBT = 1_000

/**
 * The value the form's state select posts when nothing has been chosen. It is
 * the literal string "state", not an empty value, so it has to be named
 * explicitly or it ends up in the State column.
 */
export const UNSELECTED_STATE_SENTINELS = new Set(['', 'state', 'select', 'select state'])

/** Free-text state to the AuState union. The website form has no NT option. */
export const STATE_ALIASES: Record<string, AuState> = {
  nsw: 'NSW',
  'new south wales': 'NSW',
  vic: 'VIC',
  victoria: 'VIC',
  qld: 'QLD',
  queensland: 'QLD',
  wa: 'WA',
  'western australia': 'WA',
  sa: 'SA',
  'south australia': 'SA',
  tas: 'TAS',
  tasmania: 'TAS',
  act: 'ACT',
  'australian capital territory': 'ACT',
  nt: 'NT',
  'northern territory': 'NT',
}

/** biz_type posts "Company" or "Trust". */
export const ENTITY_TYPE_ALIASES: Record<string, 'company' | 'trust'> = {
  company: 'company',
  'pty ltd': 'company',
  'company (pty ltd)': 'company',
  trust: 'trust',
  'family trust': 'trust',
}

/**
 * Which payload key carries which of our fields, per source.
 *
 * Facebook's standard fields are `full_name`, `email` and `phone_number`; debt,
 * state, message and call time are custom questions whose keys are whatever the
 * form author typed. That is why this is config: the test form and the real one
 * will not agree.
 */
export interface FieldMap {
  name: string[]
  email: string[]
  phone: string[]
  debt: string[]
  state: string[]
  entityType: string[]
  message: string[]
  callTime: string[]
}

export const FIELD_MAPS: Record<'website' | 'google_form' | 'facebook', FieldMap> = {
  website: {
    name: ['name'],
    email: ['email'],
    phone: ['phone'],
    debt: ['debt_code', 'debt'],
    state: ['state'],
    entityType: ['biz_type'],
    message: ['message'],
    callTime: ['call_time'],
  },
  google_form: {
    name: ['name', 'full_name'],
    email: ['email', 'email_address'],
    phone: ['phone', 'phone_number'],
    debt: ['debt', 'debt_range', 'how_much_do_you_owe'],
    state: ['state'],
    entityType: ['biz_type', 'business_type', 'entity_type'],
    message: ['message', 'comments'],
    callTime: ['call_time', 'preferred_call_time'],
  },
  facebook: {
    name: ['full_name'],
    email: ['email'],
    phone: ['phone_number'],
    // Placeholders until Gabby's live form's question labels are known.
    debt: ['debt_range', 'how_much_debt', 'what_is_your_approximate_debt'],
    state: ['state', 'which_state_are_you_in'],
    entityType: ['business_type', 'company_or_trust'],
    message: ['message', 'tell_us_about_your_situation'],
    callTime: ['preferred_call_time', 'best_time_to_call'],
  },
}

/** The honeypot input name. Any value in it means a bot filled the form. */
export const HONEYPOT_FIELD = 'website_url'

/** Per-IP rate limit for the public endpoint. */
export const RATE_LIMIT = { max: 10, windowMs: 60_000 }
