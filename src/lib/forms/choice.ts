import type { FieldValue } from './types'

/**
 * A choice field's ticked boxes (Part A's "Please tick appropriate box"):
 * stored as one option key, or several separated by commas
 * ("cvl_liquidator,court_liquidator"), so a draft stays plain text. Pure:
 * the entry screen and the PDF filler read it the same way.
 */

/** The boxes ticked, in the order stored, each once. Blank: none. */
export function choiceValues(v: FieldValue): string[] {
  if (typeof v !== 'string') return []
  return [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))]
}

/** The stored value for these boxes, in the form's order; none ticked: null. */
export function choiceValue(ticked: readonly string[], order: readonly string[]): string | null {
  const set = new Set(ticked)
  const kept = order.filter((k) => set.has(k))
  return kept.length ? kept.join(',') : null
}
