import { normalisePhone } from '@/lib/leads/format'

/**
 * A client's own phone number, as stored on `clients.phone`.
 *
 * Normalised the same way as `leads.phone` (spaces and +61 folded away), so a
 * number carried over from a lead is stored exactly as the lead held it.
 * Blank becomes null rather than an empty string, so "not given" has one
 * shape.
 *
 * Not format-checked: a landline or a mistyped digit is still a way to reach
 * the client, and refusing to save it would lose the number entirely.
 */
export function normaliseClientPhone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const phone = normalisePhone(raw.trim())
  return phone || null
}
