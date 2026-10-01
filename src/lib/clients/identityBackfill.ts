import { abnMatchesAcn, digitsOnly } from '@/lib/asic/identifiers'

/**
 * Sorting out records saved before migration 0023, when the company's ABN and
 * the trust's ABN shared abn_number.
 *
 * A company's own ABN is its ACN with two check digits in front, so a stored
 * ABN that ends with the stored ACN is the company's. Anything else on a record
 * that also names a trust can only be the trust's — including when there is no
 * ACN to compare with, because a trust is the only thing on the record that has
 * an ABN without one.
 *
 * Records with no trust name are never moved: with nothing else on the record
 * to own the ABN, it stays the company's, and validation flags it if it does
 * not match the ACN.
 *
 * Pure, so the rule is tested on its own. At the time of writing no stored
 * record needed moving, so nothing runs this against the database.
 */

export interface StoredIdentity {
  acnNumber: string | null
  abnNumber: string | null
  trustName: string | null
}

export type BackfillAction =
  /** Nothing to decide: no ABN, or no trust to own it. */
  | 'skip'
  /** The ABN ends with the ACN — it is the company's, and stays. */
  | 'keep'
  /** The ABN belongs to the trust: copy it to trust_abn_number, clear abn_number. */
  | 'move_to_trust'

function hasText(value: string | null): boolean {
  return Boolean(value && value.trim())
}

export function classifyAbnForBackfill(record: StoredIdentity): BackfillAction {
  if (!hasText(record.trustName) || !digitsOnly(record.abnNumber ?? '')) return 'skip'
  const acn = digitsOnly(record.acnNumber ?? '')
  if (acn && abnMatchesAcn(record.abnNumber ?? '', acn)) return 'keep'
  return 'move_to_trust'
}
