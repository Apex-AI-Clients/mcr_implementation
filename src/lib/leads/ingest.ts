import type { AuState, EntityType, LeadSource } from '@/types/leads'
import { normalisePhone, isValidEmail } from './format'
import {
  DEBT_FIELD_FORMAT,
  DEBT_LABELS,
  ENTITY_TYPE_ALIASES,
  FIELD_MAPS,
  HONEYPOT_FIELD,
  MIN_PLAUSIBLE_DEBT,
  STATE_ALIASES,
  UNSELECTED_STATE_SENTINELS,
  WEBSITE_DEBT_CODES,
  normaliseDebtLabel,
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
 */

/** The subset of a Lead that arrives from outside. */
export interface IngestedLead {
  name: string
  email: string
  phone: string
  debtMin: number | null
  debtMax: number | null
  state: AuState | null
  entityType: EntityType | null
  message: string | null
  preferredCallTime: string | null
  source: LeadSource
  externalId: string | null
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

/**
 * The form's select defaults to value="state", so an unselected state arrives
 * as the literal word. That is "not answered", not a value.
 *
 *   null    -> not answered
 *   AuState -> mapped
 *   'bad'   -> answered with something unmappable; the caller rejects
 */
function mapState(raw: string | null): AuState | null | 'bad' {
  if (raw === null) return null
  const key = raw.trim().toLowerCase()
  if (UNSELECTED_STATE_SENTINELS.has(key)) return null
  return STATE_ALIASES[key] ?? 'bad'
}

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

function mapEntityType(raw: string | null): EntityType | null {
  if (raw === null) return null
  return ENTITY_TYPE_ALIASES[raw.trim().toLowerCase()] ?? null
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
 */
export function flattenFacebookFields(fieldData: unknown): Payload {
  if (!Array.isArray(fieldData)) return {}
  const out: Payload = {}
  for (const entry of fieldData) {
    if (!entry || typeof entry !== 'object') continue
    const { name, values } = entry as { name?: unknown; values?: unknown }
    if (typeof name !== 'string') continue
    const first = Array.isArray(values) ? values[0] : values
    if (typeof first === 'string' || typeof first === 'number') out[name] = first
  }
  return out
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
  options: { formKey?: string } = {},
): IngestResult {
  const fieldMap: FieldMap = FIELD_MAPS[source as keyof typeof FIELD_MAPS] ?? FIELD_MAPS.website

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

  const state = mapState(pick(payload, fieldMap.state))
  if (state === 'bad') {
    return {
      ok: false,
      error: `Unrecognised state: ${pick(payload, fieldMap.state)}`,
    }
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
      entityType: mapEntityType(pick(payload, fieldMap.entityType)),
      message: message ?? null,
      preferredCallTime: callTime ?? null,
      source,
      externalId,
    },
  }
}
