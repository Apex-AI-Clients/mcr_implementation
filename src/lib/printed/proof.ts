import type { PrintedComparison } from './compare'
import { crossChecks, type CrossCheck } from './crossChecks'

/**
 * Which years of the financial statements are proven (Gabby, 18 Nov 2026; cross-checks 25 Nov 2026).
 * Pure, over the built comparison.
 *
 * Besides every total adding up, two checks across statements (crossChecks.ts), each only where it
 * applies (a check that does not apply is no badge and no failure):
 *   "Profit and loss agrees with balance sheet"  P&L net profit = balance sheet current year earnings
 *   "Carries forward from the previous year"     retained earnings = last period's retained earnings
 *                                                + its current year earnings
 * A failed one: the period is shown as printed with a note naming the check (printed_error), never
 * blocking the prediction (Gabby, 25 Nov 2026).
 *
 *   proven         every printed total in the year adds up (verify.ts), and
 *                  every figure read from a scan has both readings agreeing
 *                  (or a staff choice): its figures are shown and used, with
 *                  the badge "Every total on the statements adds up"
 *   printed_error  a text-layer PDF read exactly whose own printed totals do
 *                  not add up (the accountant's error): shown as printed, with
 *                  a note naming the line; never blocks the prediction
 *                  (Gabby, 10 Nov 2026)
 *   held           an uncertain reading: a scanned figure the two readings
 *                  disagree on, read by one reader only, read by Claude alone
 *                  before the second reader came back, scanned pages still
 *                  unread, or a scanned year whose totals do not add up. Its
 *                  lines are shown as printed; its headline figures and the
 *                  prediction's inputs from it wait ("Being prepared"), and
 *                  the developer is alerted.
 */

export const STATEMENTS_BADGE = 'Every total on the statements adds up'

export interface YearProof {
  /** The comparison column ("FY2024", "current"). */
  column: string
  index: number
  financialYear: number
  currentPeriod: boolean
  status: 'proven' | 'printed_error' | 'held'
  /** The totals badge, when the year is proven (every total adds up and every cross-check that applies passes). */
  badge: string | null
  /**
   * Every badge the year earns, in order: the totals badge when every total adds up (even if a
   * cross-check fails), then each cross-check that applies and passes. None while held.
   */
  badges: string[]
  /** The cross-checks that apply to this period, passed or failed (crossChecks.ts). */
  crossChecks: CrossCheck[]
  /**
   * printed_error: the lines whose printed totals do not add up, as the comparison words them, then
   * each failed cross-check's note.
   */
  notes: string[]
  /** held: why, in plain words (counts and pages; no figures). */
  reasons: string[]
  /** The documents the year's figures come from. */
  documentIds: string[]
  scan: { disagree: number; single: number; claudeOnly: number; scanned: number }
}

export function comparisonProof(comparison: PrintedComparison): YearProof[] {
  const docStatus = new Map(comparison.documents.map((d) => [d.documentId, d]))
  const checks = crossChecks(comparison)
  return comparison.columns.map((col, index) => {
    const cells = comparison.tables.flatMap((t) => t.rows.map((r) => r.cells[index]).filter((c) => c?.printed))
    const documentIds = [...new Set(cells.map((c) => c.source?.documentId).filter((d): d is string => !!d))]
    const scan = { disagree: 0, single: 0, claudeOnly: 0, scanned: 0 }
    for (const c of cells) {
      if (!c.scan) continue
      scan.scanned++
      if (c.scan.status === 'disagree') scan.disagree++
      else if (c.scan.status === 'single') scan.single++
      else if (c.scan.status === 'read') scan.claudeOnly++
    }
    const failures = comparison.failures.filter((f) => f.column === col.key)
    const unread = documentIds.filter((id) => {
      const d = docStatus.get(id)
      return d?.status === 'scan_pending' || d?.scan?.state === 'failed' || (d?.scan?.message ?? null) !== null
    })
    const reasons: string[] = []
    if (scan.disagree) reasons.push(`${scan.disagree} scanned figure${scan.disagree === 1 ? '' : 's'} the two readings disagree on: choose each`)
    if (scan.single) reasons.push(`${scan.single} scanned figure${scan.single === 1 ? '' : 's'} read by one reader only: choose each`)
    if (scan.claudeOnly) reasons.push(`${scan.claudeOnly} scanned figure${scan.claudeOnly === 1 ? '' : 's'} not read a second time yet: refresh the file`)
    if (unread.length) reasons.push('Scanned pages not read yet')
    if (scan.scanned > 0 && failures.length > 0) reasons.push(`${failures.length} printed total${failures.length === 1 ? '' : 's'} on a scanned page do${failures.length === 1 ? 'es' : ''} not add up`)
    const cross = checks[index] ?? []
    const crossFailed = cross.filter((c) => c.status === 'failed')
    const status: YearProof['status'] = reasons.length ? 'held' : failures.length || crossFailed.length ? 'printed_error' : 'proven'
    const badges = status === 'held' ? [] : [...(failures.length ? [] : [STATEMENTS_BADGE]), ...cross.filter((c) => c.status === 'passed').map((c) => c.badge)]
    return {
      column: col.key,
      index,
      financialYear: col.financialYear,
      currentPeriod: col.kind === 'current_period',
      status,
      badge: status === 'proven' ? STATEMENTS_BADGE : null,
      badges,
      crossChecks: cross,
      notes: status === 'printed_error' ? [...failures.map((f) => f.message), ...crossFailed.map((c) => c.note!)] : [],
      reasons,
      documentIds,
      scan,
    }
  })
}

/** "Being prepared" message for an input taken from a held year. */
export const heldMessage = (label: string) =>
  `Being prepared: the ${label} is read from a scan whose figures are not proven yet (both readings must agree and every total add up).`
