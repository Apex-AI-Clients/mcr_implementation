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
 *   'label'     -> the option's own label text, as Facebook delivers it
 *
 * Per-form, because no two of these agree. The website's select-based forms
 * post positions ("3"); its results form posts whatever was typed; and Meta
 * returns the label a lead actually saw ("$100,000 - $124,999"). Reading any
 * one through another's table quietly invents a figure: "3" through the code
 * table becomes $100k-$125k, and a label through the free-text parser is two
 * numbers and so ambiguous.
 */
export type DebtFieldFormat = 'code' | 'free_text' | 'label'

export const DEBT_FIELD_FORMAT: Record<string, DebtFieldFormat> = {
  website: 'code',
  website_home: 'code',
  website_inner: 'code',
  website_ads: 'code',
  // The odd one out — free text, and its debt_label is always empty.
  website_results: 'free_text',
  google_form: 'code',
  // Meta lead forms return the option's label text, never a positional value.
  facebook: 'label',
}

/**
 * Normalise a debt label for lookup.
 *
 * Meta's form editor rewrites a typed hyphen as an en dash, and the label that
 * comes back will not match a hardcoded hyphen — so every separator is folded
 * to a single one. Currency symbols, thousands commas and case are dropped for
 * the same reason: the label is display text, and display text drifts.
 */
export function normaliseDebtLabel(raw: string): string {
  return raw
    .toLowerCase()
    // en dash, em dash, non-breaking hyphen and "to" all mean the same thing.
    // "to" is folded first, because the word boundaries it relies on stop
    // existing once the spaces around it are gone.
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\bto\b/g, '-')
    .replace(/[$,]/g, '')
    // Every space, not just runs of them. The live Facebook form writes its
    // open-ended option as "$500k +" and the website writes "$500k+"; those are
    // one bracket, not two.
    .replace(/\s+/g, '')
}

/**
 * Debt option labels to ranges, covering both bracket sets in play: the
 * website's six consumer brackets and the larger business brackets the client
 * described (CRM_ADDENDUM.md §2). Keys are already normalised.
 *
 * Open-ended labels — "or +", "+", "over", "more than" — must keep a null max.
 * A lead who only said "$150,000 or +" must never be shown as a closed
 * bracket it never claimed.
 */
export const DEBT_LABELS: Record<string, DebtRange> = {}

function registerDebtLabel(range: DebtRange, ...labels: string[]): void {
  for (const label of labels) DEBT_LABELS[normaliseDebtLabel(label)] = range
}

// --- the website's six consumer brackets --------------------------------
registerDebtLabel({ min: 30_000, max: 49_999 }, '$30,000 - $49,999', '$30k - $50k', 'under $50,000', 'less than $50,000')
registerDebtLabel({ min: 50_000, max: 74_999 }, '$50,000 - $74,999', '$50k - $75k')
registerDebtLabel({ min: 75_000, max: 99_999 }, '$75,000 - $99,999', '$75k - $100k')
registerDebtLabel({ min: 100_000, max: 124_999 }, '$100,000 - $124,999', '$100k - $125k')
registerDebtLabel({ min: 125_000, max: 149_999 }, '$125,000 - $149,999', '$125k - $150k')
registerDebtLabel(
  { min: 150_000, max: null },
  '$150,000 or +',
  '$150,000+',
  '$150k+',
  'over $150,000',
  'more than $150,000',
  '$150,000 or more',
)

// --- the larger business brackets ---------------------------------------
// The entries marked MCR26_MAIN are transcribed character-for-character off
// form 1681820256160730 (MCR26_MAIN_LeadForm_SBR-Verifed). They are the option
// values Meta actually sends, so they are copied verbatim — including the
// missing "k" in "$250-$500k" and the space in "$500k +". Tidying either one up
// here would simply stop it matching. Both bracket sets have to coexist: the
// website's six consumer brackets are narrower and still in use.
registerDebtLabel(
  { min: 100_000, max: 250_000 },
  '$100k-$250k', // MCR26_MAIN
  '$100,000 - $250,000',
  '$100k - $250k',
)
registerDebtLabel({ min: 150_000, max: 250_000 }, '$150,000 - $250,000', '$150k - $250k')
registerDebtLabel(
  { min: 250_000, max: 500_000 },
  '$250-$500k', // MCR26_MAIN — the "k" after 250 really is missing on the form
  '$250,000 - $500,000',
  '$250k - $500k',
)
registerDebtLabel(
  { min: 500_000, max: null },
  '$500k +', // MCR26_MAIN — the space before the "+" really is on the form
  '$500,000 or +',
  '$500,000+',
  '$500k+',
  'over $500,000',
  'more than $500,000',
  '$500,000 or more',
)

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

/**
 * Normalise an entity answer for lookup.
 *
 * Meta sends the option's KEY, not the label a lead saw: the answer to
 * MCR26_MAIN's "Do you run a company (Pty Ltd) or Trust?" arrives as
 * `pty_ltd`, never as "Pty Ltd". The website posts the display value
 * ("Company", "Trust"), and older Meta forms posted labels too. Folding
 * underscores and hyphens to spaces, collapsing runs of whitespace and
 * lowercasing makes one table serve all three, so a form author switching a
 * label from "Pty Ltd" to "Pty. Ltd" is the only thing that can break it.
 */
export function normaliseEntityValue(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Entity answers to the two paths that matter. Keys are already normalised, so
 * a value is only ever looked up through `normaliseEntityValue`.
 *
 * Nothing here guesses. An answer that is not in this table maps to null and
 * the lead shows an empty Business type. Defaulting would be worse than an
 * empty cell in one direction in particular: a lead wrongly marked Trust reads
 * as ineligible for SBR and gets worked as a dead end.
 */
export const ENTITY_TYPE_ALIASES: Record<string, 'company' | 'trust'> = {}

function registerEntityAlias(type: 'company' | 'trust', ...values: string[]): void {
  for (const value of values) ENTITY_TYPE_ALIASES[normaliseEntityValue(value)] = type
}

// Both spellings of each answer are listed rather than left to the normaliser,
// so this table records what the live forms actually send. `pty_ltd` is the
// MCR26_MAIN option key; "Pty Ltd" and "Company" are display values from the
// website form and the older Meta forms.
registerEntityAlias('company', 'Company', 'pty_ltd', 'Pty Ltd', 'company_pty_ltd', 'Company (Pty Ltd)')
registerEntityAlias('trust', 'Trust', 'trust', 'family_trust', 'Family Trust')

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
  // Read off the live form MCR26_MAIN_LeadForm_SBR-Verifed, id
  // 1681820256160730. Meta derives a custom question's key from the question
  // text, so the trailing "?" and the parentheses ARE the key — rewriting them
  // into something tidier matches nothing at all.
  //
  // The page runs 19 active forms and the older ones were written with
  // different wording, so the previous keys stay on behind the live ones as
  // fallbacks. `pick` takes the first non-blank key it finds, so MCR26_MAIN
  // wins wherever both are present.
  //
  // `inbox_url` is deliberately absent: Meta attaches it to every lead as an
  // internal link back to the Page inbox. It is not an answer to a question.
  facebook: {
    name: ['full_name'],
    email: ['email'],
    phone: ['phone_number'],
    debt: [
      'what_is_the_amount_of_ato_debt_you_are_dealing_with?',
      'debt_range',
      'how_much_debt',
      'what_is_your_approximate_debt',
    ],
    state: ['which_state_are_you_from?', 'state', 'which_state_are_you_in'],
    entityType: [
      'do_you_run_a_company_(pty_ltd)_or_trust?',
      'business_type',
      'company_or_trust',
    ],
    message: [
      'anything_else_you_want_us_to_know_before_we_call_you?',
      'message',
      'tell_us_about_your_situation',
    ],
    // MCR26_MAIN does not ask for a call time, so it contributes no key here.
    // The older forms' keys stay so the other 18 keep filling the column.
    callTime: ['preferred_call_time', 'best_time_to_call'],
  },
}

/** The honeypot input name. Any value in it means a bot filled the form. */
export const HONEYPOT_FIELD = 'website_url'

/** Per-IP rate limit for the public endpoint. */
export const RATE_LIMIT = { max: 10, windowMs: 60_000 }
