import type { AuState, EntityType, LeadSource } from '@/types/leads'
import { normalisePhone, isValidEmail } from './format'
import type { AdAttribution } from './metaAds'
import {
  DEBT_FIELD_FORMAT,
  DEBT_LABELS,
  ENTITY_TYPE_ALIASES,
  FACEBOOK_IGNORED_QUESTION_KEYS,
  FIELD_MAPS,
  HONEYPOT_FIELD,
  MIN_PLAUSIBLE_DEBT,
  STATE_ALIASES,
  UNSELECTED_STATE_SENTINELS,
  WEBSITE_DEBT_CODES,
  normaliseDebtLabel,
  normaliseEntityValue,
  normaliseStateValue,
  type DebtFieldFormat,
  type DebtRange,
  type FieldMap,
} from './ingestConfig'

/**
 * Inbound lead mapping and validation. Pure — no database, no fetch — so the
 * awkward parts can be tested against committed fixtures.
 *
 * The distinction that matters throughout: a field the form did not ask, or
 * whose default was left alone, becomes null. A field answered with something
 * we cannot map is a rejection, so the payload lands in lead_intake_log and
 * somebody can look at it, rather than junk being stored.
 *
 * State is the exception. An unreadable state answer is kept verbatim in
 * metaStateRaw and the lead still lands, because forms group and word their
 * state options freely and losing a real enquiry over that would be worse
 * than a blank State column. See `mapState`.
 */

/** The subset of a Lead that arrives from outside. */
export interface IngestedLead {
  name: string
  email: string
  phone: string
  debtMin: number | null
  debtMax: number | null
  state: AuState | null
  /**
   * Only set when state is null. For a resolved grouping, its display labels
   * ("NSW, VIC, ACT, TAS"); for an answer that did not resolve, the value
   * exactly as it arrived.
   */
  metaStateRaw: string | null
  /** The states a grouped answer resolved to. Null unless there were several. */
  metaStateOptions: AuState[] | null
  entityType: EntityType | null
  message: string | null
  preferredCallTime: string | null
  source: LeadSource
  externalId: string | null
  /**
   * Meta ad attribution. Like externalId, none of it is an answer to a
   * question — it comes from the webhook envelope and the Graph response — so
   * it is handed in rather than picked out of the payload. Null on every other
   * source, and null on Meta's test leads, which no ad delivered.
   */
  metaFormId: string | null
  metaAdId: string | null
  metaAdgroupId: string | null
  metaPageId: string | null
  /**
   * Resolved from the ad id in the same request, so the dashboard never has to
   * call Meta. Null as a group when there was no ad or the lookup failed.
   */
  metaCampaignId: string | null
  metaCampaignName: string | null
  metaAdName: string | null
  metaAccountId: string | null
}

export type IngestResult =
  | { ok: true; lead: IngestedLead }
  | { ok: false; error: string }

type Payload = Record<string, unknown>

/** First non-blank string among the configured keys for a field. */
function pick(payload: Payload, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return null
}

export type StateMapping =
  /** Not answered, or left on the select's default. */
  | { kind: 'absent' }
  /** Exactly one state — including a "group" whose tokens all name it. */
  | { kind: 'state'; state: AuState }
  /**
   * Several states: the lead is in one of them and the answer does not say
   * which, so none of them is stored as the state.
   */
  | { kind: 'group'; states: AuState[]; label: string }
  /** At least one token did not resolve. Nothing is inferred from the rest. */
  | { kind: 'unresolved'; raw: string }

/**
 * Separators a form might group states with. Matched on the normalised value,
 * so Meta's underscored keys ("nsw,_vic") have already become spaces.
 */
const STATE_SEPARATORS = /[,/|]|\band\b/

/**
 * A state answer, split into tokens and each resolved through STATE_ALIASES.
 *
 * Nothing here knows about any particular form's groupings: "NSW, VIC, ACT,
 * TAS", "qld/wa", "NT | SA" and "Victoria and Tasmania" all go through the same
 * path, in whatever order and size a form author chose.
 *
 * All or nothing. If any token fails, the whole answer is `unresolved` — a
 * partial group would be claiming the lead picked a set of states they did
 * not pick.
 *
 * The form's select defaults to value="state", so an unselected state arrives
 * as the literal word. That is "not answered", not a value.
 */
export function mapState(raw: string | null): StateMapping {
  if (raw === null) return { kind: 'absent' }
  const key = normaliseStateValue(raw)
  if (UNSELECTED_STATE_SENTINELS.has(key)) return { kind: 'absent' }

  const tokens = key
    .split(STATE_SEPARATORS)
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length === 0) return { kind: 'unresolved', raw: raw.trim() }

  const states: AuState[] = []
  for (const token of tokens) {
    const state = STATE_ALIASES[token]
    if (!state) return { kind: 'unresolved', raw: raw.trim() }
    if (!states.includes(state)) states.push(state)
  }

  // A group of one is just a state.
  if (states.length === 1) return { kind: 'state', state: states[0] }
  return { kind: 'group', states, label: states.join(', ') }
}

/** Long enough to show any real option key, short enough not to flood a log. */
const MAX_LOGGED_STATE_LENGTH = 80

/** Unmapped or absent debt is null. Never a guess. */
function mapDebt(raw: string | null): DebtRange {
  if (raw === null) return { min: null, max: null }
  return WEBSITE_DEBT_CODES[raw.trim().toLowerCase()] ?? { min: null, max: null }
}

/** Why a typed debt value could not be used. Drives the message staff see. */
/**
 * A debt option's label text to a range — how Meta lead forms deliver the
 * answer. Returns null when the label is not one we know, so the caller can
 * preserve the raw text instead of guessing a bracket from it.
 */
export function mapDebtLabel(raw: string | null): DebtRange | null {
  if (raw === null) return null
  const key = normaliseDebtLabel(raw)
  if (!key) return null
  return DEBT_LABELS[key] ?? null
}

export type LooseDebtFailure = 'not_a_number' | 'ambiguous' | 'too_small'

export type LooseDebtResult =
  | { kind: 'parsed'; min: number; max: number }
  /** Nothing was typed — there is nothing to preserve. */
  | { kind: 'absent' }
  /** Something was typed that is not a usable figure; keep the raw text. */
  | { kind: 'unparseable'; raw: string; reason: LooseDebtFailure }

/**
 * A free-text debt field, parsed loosely.
 *
 * Handles the shapes people actually type: "120k", "$45,000", "45000",
 * "45,000.00", "approx 120k". A single figure becomes a point range (min ===
 * max) rather than an open-ended one, because "120k" is an estimate of an
 * amount, not a floor.
 *
 * It never infers a range from words. "not sure" is not $0-$50k, and a bare
 * "3" is not the $100k-$125k bracket — that is what the code table would have
 * made of it, which is exactly the bug this exists to avoid.
 */
export function parseLooseDebt(raw: string | null): LooseDebtResult {
  if (raw === null) return { kind: 'absent' }
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'absent' }

  // One number, optionally with $ , . spaces and a k/m suffix. Any other
  // wording around it is fine; more than one number is ambiguous, so it isn't.
  const matches = trimmed.match(/\d[\d,\s.]*\s*[kKmM]?/g)
  if (!matches) return { kind: 'unparseable', raw: trimmed, reason: 'not_a_number' }
  // More than one number is a range or a typo; either way, guessing which is
  // meant would be inventing data.
  if (matches.length !== 1) return { kind: 'unparseable', raw: trimmed, reason: 'ambiguous' }

  const token = matches[0].trim()
  const suffix = /[kK]$/.test(token) ? 1_000 : /[mM]$/.test(token) ? 1_000_000 : 1
  const digits = token.replace(/[kKmM]$/, '').replace(/[,\s]/g, '')

  // A thousands separator and a decimal point are the same character to a
  // visitor: "45,000" and "45.000" both mean forty-five thousand. Only treat a
  // dot as a decimal when it is followed by one or two digits at the end.
  const normalised = /\.\d{1,2}$/.test(digits) ? digits : digits.replace(/\./g, '')

  const value = Number.parseFloat(normalised)
  if (!Number.isFinite(value) || value <= 0) {
    return { kind: 'unparseable', raw: trimmed, reason: 'not_a_number' }
  }

  const dollars = Math.round(value * suffix)
  if (dollars < MIN_PLAUSIBLE_DEBT) {
    return { kind: 'unparseable', raw: trimmed, reason: 'too_small' }
  }

  return { kind: 'parsed', min: dollars, max: dollars }
}

/** Prefix used when a typed debt value has to be preserved in the message. */
export const RAW_DEBT_NOTE_PREFIX = 'Debt (as entered):'

function appendRawDebt(message: string | null, raw: string): string {
  const note = `${RAW_DEBT_NOTE_PREFIX} ${raw}`
  return message ? `${message}\n\n${note}` : note
}

/**
 * An entity answer to the SBR-qualifying path, or null.
 *
 * Null means "we were not told", and it has to stay null: the two values are
 * not interchangeable to whoever works the lead, and a Trust cannot take the
 * SBR path. Normalised on lookup so the option key Meta sends (`pty_ltd`) and
 * the display value the website posts ("Company") read through one table.
 */
export function mapEntityType(raw: string | null): EntityType | null {
  if (raw === null) return null
  const key = normaliseEntityValue(raw)
  if (!key) return null
  return ENTITY_TYPE_ALIASES[key] ?? null
}

/**
 * Bots fill every input they find. The upstream form has no captcha, so this
 * is the only spam signal available at the endpoint.
 */
export function isHoneypotTripped(payload: Payload): boolean {
  const value = payload[HONEYPOT_FIELD]
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Facebook delivers answers as `field_data: [{ name, values: [...] }]`.
 * Flattened to a plain object so one mapper serves every source.
 *
 * `values` is an array even for a single-select question. Should one ever
 * carry more than one entry, taking the first would silently drop the rest, so
 * they are joined with ", " instead — for a state question that reads as a
 * grouping and lands in metaStateRaw. It is logged at warn level, key and count
 * only, never the answers.
 */
export function flattenFacebookFields(fieldData: unknown, formId?: string | null): Payload {
  if (!Array.isArray(fieldData)) return {}
  const out: Payload = {}
  for (const entry of fieldData) {
    if (!entry || typeof entry !== 'object') continue
    const { name, values } = entry as { name?: unknown; values?: unknown }
    if (typeof name !== 'string') continue
    const answers = (Array.isArray(values) ? values : [values]).filter(
      (value): value is string | number =>
        (typeof value === 'string' && value.trim() !== '') || typeof value === 'number',
    )
    if (answers.length === 0) continue
    if (answers.length > 1) {
      console.warn(
        `[webhooks/leads] facebook field key=${name} had ${answers.length} values, joined form_id=${formId ?? 'unknown'}`,
      )
      out[name] = answers.map(String).join(', ')
    } else {
      out[name] = answers[0]
    }
  }
  return out
}

/**
 * Keys Meta attaches to a lead that are not answers to a question, so their
 * absence from the field map is correct rather than a gap. `inbox_url` is the
 * link back to the Page inbox; add to this set rather than to a field map when
 * Meta starts sending another.
 */
const FACEBOOK_NON_QUESTION_KEYS = new Set(['inbox_url'])

/**
 * Warn about answer keys no field map claims.
 *
 * The Page runs 19 forms and old ones get relaunched across campaigns. Meta
 * derives a question's key from its text, so an editor rewording "Which state
 * are you from?" mints a new key, `pick` finds nothing, and the lead lands with
 * a blank State, Debt and Business type while everything reports success. There
 * is no error to notice — which is the problem this exists to fix.
 *
 * KEYS ONLY, never values: an answer is the lead's name, phone number or
 * financial position, and log lines are not a place for any of it. The key is
 * the question's wording, which is ours and is the only part that identifies
 * what needs remapping.
 */
function warnUnmappedFacebookFields(
  payload: Payload,
  fieldMap: FieldMap,
  formId: string,
): void {
  const mapped = new Set(Object.values(fieldMap).flat())
  for (const key of Object.keys(payload)) {
    if (
      mapped.has(key) ||
      FACEBOOK_NON_QUESTION_KEYS.has(key) ||
      FACEBOOK_IGNORED_QUESTION_KEYS.has(key)
    ) {
      continue
    }
    console.warn(`[webhooks/leads] unmapped facebook field key=${key} form_id=${formId}`)
  }
}

export interface MapLeadOptions {
  /** Which form's debt field format to apply. Defaults to the source. */
  formKey?: string
  /** From the Graph response. Also names the form in unmapped-key warnings. */
  formId?: string | null
  /** From the webhook change value — all three are null on Meta's test leads. */
  adId?: string | null
  adgroupId?: string | null
  pageId?: string | null
  /** The ad resolved to its campaign. Absent when there was no ad to resolve. */
  ad?: AdAttribution
}

/**
 * Map a payload to a lead.
 *
 * `source` comes from the caller — which reads it from the route param, never
 * from the body. Anyone who finds the URL must not be able to post leads
 * claiming to be Facebook ads.
 */
export function mapLead(
  payload: Payload,
  source: LeadSource,
  externalId: string | null,
  options: MapLeadOptions = {},
): IngestResult {
  const fieldMap: FieldMap = FIELD_MAPS[source as keyof typeof FIELD_MAPS] ?? FIELD_MAPS.website

  // Before the validation returns below, so a reworded question that costs us
  // the name key is reported as a mapping gap and not only as "Missing name".
  if (source === 'facebook') {
    warnUnmappedFacebookFields(payload, fieldMap, options.formId ?? 'unknown')
  }

  // Which form this came from decides how its debt field is read. Defaults to
  // the code table, so a form nobody has configured cannot accidentally get
  // free-text treatment.
  const formKey = options.formKey ?? source
  const debtFormat: DebtFieldFormat = DEBT_FIELD_FORMAT[formKey] ?? 'code'

  const name = pick(payload, fieldMap.name)
  if (!name) return { ok: false, error: 'Missing name' }

  const email = pick(payload, fieldMap.email)
  if (!email) return { ok: false, error: 'Missing email' }
  if (!isValidEmail(email)) return { ok: false, error: `Invalid email: ${email}` }

  const rawPhone = pick(payload, fieldMap.phone)
  if (!rawPhone) return { ok: false, error: 'Missing phone' }
  const phone = normalisePhone(rawPhone)
  // Deliberately not format-checked: a landline or a mistyped digit is still a
  // real enquiry, and dropping it would lose a lead to a validation rule.
  if (!phone) return { ok: false, error: 'Missing phone' }

  const mappedState = mapState(pick(payload, fieldMap.state))
  if (mappedState.kind === 'unresolved') {
    // The value is logged, unlike other answers: a state option is the form's
    // wording rather than anything about the lead, and without it there is no
    // way to see which alias or separator is missing.
    console.warn(
      `[webhooks/leads] unresolved state value=${JSON.stringify(
        mappedState.raw.slice(0, MAX_LOGGED_STATE_LENGTH),
      )} source=${source} form_id=${options.formId ?? 'unknown'}`,
    )
  }

  const rawDebt = pick(payload, fieldMap.debt)
  let message = pick(payload, fieldMap.message)
  let debt: DebtRange

  if (debtFormat === 'free_text') {
    const parsed = parseLooseDebt(rawDebt)
    if (parsed.kind === 'parsed') {
      debt = { min: parsed.min, max: parsed.max }
    } else {
      debt = { min: null, max: null }
      // What they typed is the only record of what they owe. Losing it to a
      // failed parse would be worse than not having a number at all.
      if (parsed.kind === 'unparseable') message = appendRawDebt(message, parsed.raw)
    }
  } else if (debtFormat === 'label') {
    const matched = mapDebtLabel(rawDebt)
    if (matched) {
      debt = matched
    } else {
      debt = { min: null, max: null }
      // An unknown label means the form's options changed. Keep the words so
      // the bracket can be recovered, and so the mapping gap is visible.
      if (rawDebt) message = appendRawDebt(message, rawDebt)
    }
  } else {
    debt = mapDebt(rawDebt)
  }

  // A grouping is never resolved to one of its states.
  const state = mappedState.kind === 'state' ? mappedState.state : null
  const metaStateOptions = mappedState.kind === 'group' ? mappedState.states : null
  const metaStateRaw =
    mappedState.kind === 'group'
      ? mappedState.label
      : mappedState.kind === 'unresolved'
        ? mappedState.raw
        : null

  const callTime = pick(payload, fieldMap.callTime)

  return {
    ok: true,
    lead: {
      name,
      email: email.toLowerCase(),
      phone,
      debtMin: debt.min,
      debtMax: debt.max,
      state,
      metaStateRaw,
      metaStateOptions,
      entityType: mapEntityType(pick(payload, fieldMap.entityType)),
      message: message ?? null,
      preferredCallTime: callTime ?? null,
      source,
      externalId,
      metaFormId: options.formId ?? null,
      metaAdId: options.adId ?? null,
      metaAdgroupId: options.adgroupId ?? null,
      metaPageId: options.pageId ?? null,
      metaCampaignId: options.ad?.campaignId ?? null,
      metaCampaignName: options.ad?.campaignName ?? null,
      metaAdName: options.ad?.adName ?? null,
      metaAccountId: options.ad?.accountId ?? null,
    },
  }
}
