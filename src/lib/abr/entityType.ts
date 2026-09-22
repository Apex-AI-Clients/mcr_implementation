import type { ResolvedEntityType } from './types'

/**
 * ABR entity type -> the two options this form has.
 *
 * The form asks company or trust, because that is the question that decides
 * whether Small Business Restructuring is even available. The register has
 * dozens of codes, most of which are neither.
 *
 * Deliberately conservative. The code map holds only codes whose meaning is
 * not in doubt; anything else falls through to the entity type *name*, and
 * anything still unresolved returns null so the form keeps whatever the staff
 * member already chose. A wrong entity type silently changes which fields the
 * conversion demands, so guessing is worse here than not answering.
 */

/** Australian companies. */
const COMPANY_CODES = new Set([
  'PRV', // Australian Private Company
  'PUB', // Australian Public Company
  'CGC', // Commonwealth Government Company
  'SGC', // State Government Company
])

/** Trusts. Superannuation funds are left out on purpose — see below. */
const TRUST_CODES = new Set([
  'DTT', // Discretionary Trust — Trading
  'DIT', // Discretionary Trust — Investment
  'DST', // Discretionary Trust — Services Management
  'FXT', // Fixed Trust
  'FUT', // Fixed Unit Trust
  'HYT', // Hybrid Trust
  'PUT', // Public Unit Trust (unlisted)
  'PQT', // Public Unit Trust (listed)
  'CUT', // Cash Management Unit Trust
])

/**
 * A superannuation fund (SMF, ARF, NRF) is a trust in law, but it is not the
 * kind of trust this intake means and SBR does not reach it. Left unresolved
 * rather than mapped, so it lands in front of a person.
 */

export function entityTypeFromCode(code: string): ResolvedEntityType {
  const normalised = code.trim().toUpperCase()
  if (COMPANY_CODES.has(normalised)) return 'company'
  if (TRUST_CODES.has(normalised)) return 'trust'
  return null
}

/**
 * Fallback for codes the map does not carry. ABR's EntityTypeName spells the
 * kind out in English ("Discretionary Investment Trust", "Australian Private
 * Company"), which covers the long tail without pretending to know a code.
 *
 * Trust is checked first: a name carrying both words is a trust with a
 * corporate flavour, not a company.
 */
export function entityTypeFromName(typeName: string): ResolvedEntityType {
  const lower = typeName.toLowerCase()
  if (lower.includes('trust')) return 'trust'
  if (lower.includes('company')) return 'company'
  return null
}

/** Code first, then the spelled-out name. Null when neither settles it. */
export function entityTypeFromAbr(code: string, typeName: string): ResolvedEntityType {
  return entityTypeFromCode(code) ?? entityTypeFromName(typeName)
}
