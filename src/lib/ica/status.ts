/** Pure: the stored check's status, and the stored readings (ica_forced) back in the engine's form. */

export type IcaStatus = 'verified' | 'unverified' | 'empty'

export function forcedFrom(stored: unknown): Map<number, boolean> {
  const out = new Map<number, boolean>()
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) if (typeof v === 'boolean' && /^\d+$/.test(k)) out.set(Number(k), v)
  }
  return out
}

/** The neutral note shown instead of any calculated figure from a file that is not verified. */
export const TOTALS_HELD_BACK = 'Totals being prepared'
