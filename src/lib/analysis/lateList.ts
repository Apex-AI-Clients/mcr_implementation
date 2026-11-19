import type { DpnContributingDebit, DpnRiskBreakdown } from './types'

/**
 * The statements lodged more than 90 days late, one row per statement, from
 * the DPN estimate's items (computeDpnRisk). Each tax line is counted on its
 * own (Gabby, 17 Nov 2026): a statement's GST and PAYG withholding are its
 * sub-lines, so a GST credit never offsets PAYG. Shared by the lodgement
 * page's director penalty section and its CSV export.
 */

export interface LateStatementRow {
  key: string
  periodEnding: string | null
  /** Processed date (lodged) and effective date (due), ISO. */
  lodged: string
  due: string
  daysLate: number
  /** The statement's description as printed (without the tax line). */
  description: string
  gst: number
  paygw: number
  /** Any other tax line of the statement (PAYG instalments, a statement with no sub-lines). */
  other: number
  total: number
  /** The rows of the ATO account it comes from (positions), for its ⓘ. */
  rowIndexes: number[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function lateStatements(debits: readonly DpnContributingDebit[]): LateStatementRow[] {
  const byKey = new Map<string, LateStatementRow>()
  for (const d of debits) {
    const description = d.taxLine ? d.description.slice(0, d.description.length - ` — ${d.taxLine}`.length) : d.description
    const key = `${d.processedDate}|${d.effectiveDate}|${description}`
    const row = byKey.get(key) ?? {
      key,
      periodEnding: d.periodEnding,
      lodged: d.processedDate,
      due: d.effectiveDate,
      daysLate: d.daysLate,
      description,
      gst: 0,
      paygw: 0,
      other: 0,
      total: 0,
      rowIndexes: [],
    }
    const line = (d.taxLine ?? '').toLowerCase()
    if (line === 'gst') row.gst = round2(row.gst + d.debit)
    else if (line === 'payg withholding') row.paygw = round2(row.paygw + d.debit)
    else row.other = round2(row.other + d.debit)
    row.total = round2(row.total + d.debit)
    row.rowIndexes.push(d.rowIndex)
    byKey.set(key, row)
  }
  return [...byKey.values()]
}

/** The second card: lodged more than 90 days late since the balance was last nil, by tax line. */
export function lateSinceNil(dpn: DpnRiskBreakdown): { total: number; gst: number; paygw: number; other: number; since: string | null; statements: number } {
  const rows = lateStatements(dpn.contributingDebits)
  const sum = (f: (r: LateStatementRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0))
  return { total: dpn.totalGrossLate, gst: sum((r) => r.gst), paygw: sum((r) => r.paygw), other: sum((r) => r.other), since: dpn.window?.start ?? null, statements: rows.length }
}
