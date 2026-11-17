import { LATE_LODGEMENT_PHRASE } from '@/lib/analysis/config'
import { lineOf, subLineOf } from './wording'
import type { Reconciliation } from './reconcile'
import type { Cents, IcaFile, IcaRow } from './types'

/**
 * Late lodgements, the RBA ICA spreadsheet's rule exactly (unchanged): every
 * row whose description contains "Activity Statement"; days late = processed
 * date − effective date, a negative number counting as 0; a row is a late
 * lodgement when that is above 0. Dates only: it does not depend on amounts,
 * so it can be shown as soon as every date reads.
 */

const daysLate = (r: IcaRow): number | null =>
  r.processed && r.effective
    ? Math.max(0, Math.round((Date.parse(`${r.processed}T00:00:00Z`) - Date.parse(`${r.effective}T00:00:00Z`)) / 86_400_000))
    : null

export interface LateLodgements {
  /** Null when any date in the file cannot be read: never a figure from part of the dates. */
  count: number | null
  cumulativeDays: number | null
  rows: { rowId: number; days: number }[]
}

export function lateLodgements(file: IcaFile): LateLodgements {
  if (file.rows.some((r) => !r.processed || !r.effective)) return { count: null, cumulativeDays: null, rows: [] }
  const rows = file.rows
    .filter((r) => LATE_LODGEMENT_PHRASE.test(r.description))
    .map((r) => ({ rowId: r.id, days: daysLate(r) ?? 0 }))
    .filter((r) => r.days > 0)
  return { count: rows.length, cumulativeDays: rows.reduce((s, r) => s + r.days, 0), rows }
}

/** A penalty or remission row mentions "Activity Statement" but lodges nothing. */
const isStatement = (d: string) => LATE_LODGEMENT_PHRASE.test(d) && !/^(remission of )?penalty\b/i.test(d.trim())

export interface LateStatement {
  rowId: number
  days: number
  /** By tax line, from the counted reading (the statement row's amount split by its sub-lines, or the sub-lines). */
  amounts: { key: string; label: string; debit: Cents; credit: Cents }[]
  debit: Cents
}

/**
 * Statements lodged more than `overDays` late, with their amounts read by the
 * same rule as the composition: the statement row's amount if it has one,
 * otherwise its sub-lines — whichever the ATO's balance proved.
 */
export function statementsLodgedLate(file: IcaFile, rec: Reconciliation, overDays = 90): LateStatement[] {
  const out: LateStatement[] = []
  for (const g of rec.groups) {
    const head = file.rows[g.head]
    if (!isStatement(head.description)) continue
    const days = daysLate(head)
    if (days === null || days <= overDays) continue
    const byLine = new Map<string, { key: string; label: string; debit: Cents; credit: Cents }>()
    const put = (r: IcaRow) => {
      const line = r.id === g.head ? lineOf(r.description) : subLineOf(head.description, r.description)
      const e = byLine.get(line.key) ?? { key: line.key, label: line.label, debit: 0, credit: 0 }
      e.debit += r.debit
      e.credit += r.credit
      byLine.set(line.key, e)
    }
    const headCounted = rec.counted.has(g.head)
    // The sub-lines carry the split either way; a counted statement row with no sub-lines is its own line.
    if (g.parts.length && (headCounted || g.parts.some((p) => rec.counted.has(p)))) {
      g.parts.forEach((p) => put(file.rows[p]))
      // A counted statement row its sub-lines do not add up to: the rest stays on its own line.
      const rest = headCounted ? head.debit - head.credit - g.parts.reduce((s, p) => s + file.rows[p].debit - file.rows[p].credit, 0) : 0
      if (rest !== 0) put({ ...head, debit: Math.max(rest, 0), credit: Math.max(-rest, 0) })
    } else if (headCounted) put(head)
    // Lodged amounts: the debit lines (a credit line, such as a fuel tax credit, lodges nothing late).
    const amounts = [...byLine.values()].filter((a) => a.debit !== 0)
    out.push({ rowId: g.head, days, amounts, debit: amounts.reduce((s, a) => s + a.debit, 0) })
  }
  return out
}
