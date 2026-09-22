import { asRecord, unwrapJsonp } from './jsonp'
import { normaliseAbnStatus } from './types'
import type { AbrEntityDetails, AbrNameMatch, AbrSearchResponse } from './types'

/**
 * ABR responses -> typed values.
 *
 * Every field is read defensively. The register is an external system with no
 * contract with us: fields come and go, numbers arrive as strings, and the
 * name-match rows carry one key with a space in it ("Is Current"). A missing
 * field becomes an empty string rather than an exception, because a result row
 * short a postcode is still a useful result row.
 */

function str(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

function bool(source: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  }
  return false
}

function num(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/** Digits only — the register is inconsistent about spacing its own numbers. */
function digits(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * How far below the best match is still worth showing.
 *
 * ABR name matching is fuzzy and generous. A search for "mcr partner" comes
 * back with "MCR PARTNERS PTY LTD" at 99 and, in the same list, "MY CURRY
 * RULES" at 87 — the tail is phonetic noise, and twenty rows of it buries the
 * one row somebody was looking for.
 *
 * Relative to the top score rather than a fixed floor, so a genuinely obscure
 * company whose best match only scores 80 still shows its neighbours. It only
 * ever trims the tail of a list that already has a better answer in it.
 */
const RELEVANCE_BAND = 10

/**
 * MatchingNames.aspx.
 *
 * An empty `Names` array and a missing one mean the same thing to the caller:
 * no matches. ABR's own `Message` is passed through — it is how the register
 * explains a rejected search term, and it reads better than anything we would
 * write over the top of it.
 */
export function parseMatchingNames(body: string): AbrSearchResponse {
  const payload = asRecord(unwrapJsonp(body))
  const message = str(payload, 'Message')

  const raw = payload.Names
  if (!Array.isArray(raw)) return { message, matches: [] }

  const matches: AbrNameMatch[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    const abn = digits(str(row, 'Abn', 'ABN'))
    const entityName = str(row, 'Name', 'EntityName')
    // A row with neither is not a result, whatever else it carries.
    if (!abn && !entityName) continue

    const abnStatus = str(row, 'AbnStatus')

    matches.push({
      abn,
      entityName,
      abnStatus,
      status: normaliseAbnStatus(abnStatus),
      nameType: str(row, 'NameType'),
      state: str(row, 'State'),
      postcode: str(row, 'Postcode'),
      score: num(row, 'Score'),
      isCurrent: bool(row, 'IsCurrent', 'Is Current'),
    })
  }

  // Best match first. ABR usually sorts already; this makes it ours.
  matches.sort((a, b) => b.score - a.score)

  const best = matches[0]?.score ?? 0
  return { message, matches: matches.filter((m) => m.score >= best - RELEVANCE_BAND) }
}

/**
 * AbnDetails.aspx.
 *
 * Returns null when the register answered cleanly but has nothing against the
 * ABN — a deregistered number, or a typo that still passed the digit check.
 * That is a 404 to the caller, not an error.
 */
export function parseAbnDetails(body: string): AbrEntityDetails | null {
  const payload = asRecord(unwrapJsonp(body))

  const abn = digits(str(payload, 'Abn', 'ABN'))
  if (!abn) return null

  const abnStatus = str(payload, 'AbnStatus')

  return {
    abn,
    abnStatus,
    status: normaliseAbnStatus(abnStatus),
    abnStatusEffectiveFrom: str(payload, 'AbnStatusEffectiveFrom'),
    acn: digits(str(payload, 'Acn', 'ACN')),
    entityName: str(payload, 'EntityName'),
    entityTypeCode: str(payload, 'EntityTypeCode'),
    entityTypeName: str(payload, 'EntityTypeName'),
    state: str(payload, 'AddressState', 'State'),
    postcode: str(payload, 'AddressPostcode', 'Postcode'),
  }
}
