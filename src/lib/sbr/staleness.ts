/**
 * When a saved prediction is stale: the historical cases it was computed from
 * have changed since (an upload that added or corrected cases, or the undo of
 * one). Worked out at read time from sbr_case_imports; nothing marks the
 * predictions themselves (migration 0028).
 *
 * An upload that only filled in details (business type, number of creditors)
 * changes nothing the prediction uses, so it does not count.
 */
import type { ImportHistoryCounts } from './import/payload'

export interface ImportChange {
  uploaded_at: string
  undone_at: string | null
  counts: Partial<ImportHistoryCounts> | null
}

/** The latest moment the training data changed, or null if it never has. */
export function trainingDataChangedAt(imports: readonly ImportChange[]): string | null {
  let latest: string | null = null
  for (const i of imports) {
    const changed = (i.counts?.added ?? 0) + (i.counts?.corrected ?? 0) > 0
    if (!changed) continue
    for (const at of [i.uploaded_at, i.undone_at]) {
      if (at && (latest === null || Date.parse(at) > Date.parse(latest))) latest = at
    }
  }
  return latest
}

export function isPredictionStale(computedAt: string, changedAt: string | null): boolean {
  return changedAt !== null && Date.parse(computedAt) < Date.parse(changedAt)
}
