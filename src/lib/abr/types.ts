import type { EntityType } from '@/types/leads'

/**
 * The Australian Business Register, as this app reads it.
 *
 * ABR (run by the ATO) is the only free live register of Australian entities.
 * ASIC — which is what an insolvency practice actually wants, because it holds
 * the company officers and the charges — has no free API, so ACN here arrives
 * as whatever ABR happens to carry against the ABN.
 *
 * Everything on these types is a starting point for a human, never an answer.
 * ABR is frequently stale for exactly the distressed companies this practice
 * deals with, and the legal entity name is routinely not the trading name the
 * client uses on the phone.
 */

/**
 * ABN status, normalised.
 *
 * The two endpoints do not agree on how to say this. AbnDetails answers in
 * words ("Active", "Cancelled"); MatchingNames answers with a padded code
 * ("0000000001", "0000000002"). Shipping the raw value straight to a badge put
 * "0000000001" on screen and, worse, read every row as not-active.
 *
 * 'unknown' is a real answer and is treated as one: nothing is claimed about a
 * status the register expressed in a way this code does not recognise. Silence
 * is right there — a wrong "Cancelled" on an insolvency file is worse than no
 * badge at all.
 */
export type AbnStatus = 'active' | 'cancelled' | 'unknown'

/** One row from MatchingNames.aspx. */
export interface AbrNameMatch {
  abn: string
  /**
   * Exactly as the register holds it — ALL CAPS, "THE TRUSTEE FOR …" and all.
   * Never tidied: the result row shows this so staff can see the source text
   * before they pick. Tidying happens only on the value that gets filled in.
   */
  entityName: string
  /** Exactly what the register said — a code here, e.g. "0000000001". */
  abnStatus: string
  /** The above, read. This is what the UI renders from. */
  status: AbnStatus
  /** "Entity Name", "Business Name", "Trading Name" — which name matched. */
  nameType: string
  state: string
  postcode: string
  /** ABR's own relevance figure. Used only for ordering. */
  score: number
  isCurrent: boolean
}

/** The useful half of an AbnDetails.aspx response. */
export interface AbrEntityDetails {
  abn: string
  /** Exactly what the register said — a word here, e.g. "Cancelled". */
  abnStatus: string
  /** The above, read. This is what the UI renders from. */
  status: AbnStatus
  /** ISO date the current status took effect. Empty when ABR omits it. */
  abnStatusEffectiveFrom: string
  /** 9 digits, unspaced, or '' — ABR has no ACN for a trust or a sole trader. */
  acn: string
  /** Raw register text, untidied. See AbrNameMatch.entityName. */
  entityName: string
  /** e.g. "PRV", "DTT". The primary signal for the entity type. */
  entityTypeCode: string
  /** e.g. "Australian Private Company". The fallback signal. */
  entityTypeName: string
  state: string
  postcode: string
}

/** What GET /api/abr/search answers with. */
export interface AbrSearchResponse {
  /** ABR's own message, e.g. when a search term is rejected. Often ''. */
  message: string
  matches: AbrNameMatch[]
}

/** Resolved entity type, or null when neither the code nor the name settles it. */
export type ResolvedEntityType = EntityType | null

/**
 * What a picked register entity can fill in, on any form that asks for it.
 *
 * Deliberately named after the fields rather than after any one form: the same
 * four questions are asked at lead conversion, at client creation and on the
 * intake wizard's company step, and all three now fill from here. Tying this
 * to one form's interface is what would stop the next one reusing it.
 *
 * Every key but the ABN is optional, and absent means "the register did not
 * answer this" — never "blank it". A form spreading this over its own state
 * must not lose a value somebody typed.
 *
 * phoneNumber and emailAddress are not here and will not be: neither is on the
 * public register, so there is nothing to fill them from.
 */
export interface AbrPrefill {
  /** Absent when the register does not settle it — leave the form's answer. */
  entityType?: EntityType
  /** Set for a company, or an entity the register does not classify. */
  companyName?: string
  /** Set for a trust, with "The Trustee for" already off the front. */
  trustName?: string
  abnNumber: string
  /** Absent when ABR carries no ACN — a trust or a sole trader has none. */
  acnNumber?: string
}

/**
 * Whatever the register said -> what it means.
 *
 * Handles both spellings, because a caller should not have to know which
 * endpoint a value came off. Anything unrecognised is 'unknown' rather than a
 * guess in either direction.
 *
 * NOTE: the numeric codes are read off live responses — 1 against entities
 * that are trading, 2 against ones that are not. Worth confirming against the
 * ABR documentation when the registration is finalised; if they turn out to be
 * the other way round, this function is the only place that changes.
 */
export function normaliseAbnStatus(raw: string): AbnStatus {
  const value = raw.trim()
  if (!value) return 'unknown'

  const word = value.toLowerCase()
  if (word === 'active') return 'active'
  if (word === 'cancelled' || word === 'canceled') return 'cancelled'

  if (/^\d+$/.test(value)) {
    const code = Number(value)
    if (code === 1) return 'active'
    if (code === 2) return 'cancelled'
  }

  return 'unknown'
}

/** For a badge. Empty when there is nothing worth asserting. */
export function abnStatusLabel(status: AbnStatus): string {
  if (status === 'active') return 'Active'
  if (status === 'cancelled') return 'Cancelled'
  return ''
}
