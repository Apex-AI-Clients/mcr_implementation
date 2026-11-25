import type { AccountComposition } from './engine'
import { unpaidPhrase, type IncomeTaxSummary } from './incomeTax'
import { SG_EVENT_LABEL, type SuperGuaranteeSummary } from './superGuarantee'

/**
 * An income tax or super guarantee analysis as the page shows it, ready for
 * the page and its CSV (exportCsv below). Serialisable: built on the server
 * from the stored row.
 */
export type AtoAccountPayload = {
  /** The file checked against the ATO's own balance (src/lib/ica/view.ts); the page shows a report only for a verified file. */
  verification?: import('@/lib/ica/view').IcaView | null
  id: string
  clientId: string
  label: string
  entityName: string | null
  /** False: line 2 is not the client's company or trust. */
  entityMatches: boolean | null
  sourceFilename: string | null
  balance: number | null
  balanceDate: string | null
  unexplained: number | null
  needsReview: boolean
  reviewedBy: string | null
  reviewedAt: string | null
  analysedAt: string
  composition: AccountComposition
  /** Claude's summary (atoAccountSummary.ts), when one has been written under the current checks. */
  aiSummary?: string | null
  aiSummaryGeneratedAt?: string | null
} & (
  | { kind: 'income_tax'; summary: IncomeTaxSummary | null }
  | { kind: 'super_guarantee'; summary: SuperGuaranteeSummary | null }
)

/** Above $1,000 unexplained and not reviewed yet: the page's exports are locked. */
export function exportLock(p: Pick<AtoAccountPayload, 'needsReview' | 'reviewedAt'>): string | null {
  return p.needsReview && !p.reviewedAt
    ? 'The unexplained difference is above $1,000. Review the analysis before exporting it.'
    : null
}

const cell = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const row = (...cells: (string | number | null | undefined)[]) => cells.map(cell).join(',')
const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : n.toFixed(2))
const balance = (n: number | null) => (n === null ? '' : `${Math.abs(n).toFixed(2)} ${n >= 0 ? 'DR' : 'CR'}`)

export function atoAccountCsv(p: AtoAccountPayload, clientName: string): string {
  const lines: string[] = []
  lines.push(row(p.label, clientName))
  lines.push(row('Entity on the export', p.entityName))
  lines.push(row('Balance owing', balance(p.balance), p.balanceDate ? `at ${p.balanceDate}` : ''))
  // Verified against the ATO's own balance (src/lib/ica): the badge; nothing is unexplained.
  const v = p.verification?.verified ? p.verification : null
  if (v?.badge) lines.push(row(v.badge))
  else {
    lines.push(row('Unexplained difference', money(p.unexplained)))
    if (p.reviewedAt) lines.push(row('Reviewed', p.reviewedBy, p.reviewedAt))
  }
  lines.push('')

  // The account's own summary, on the ICA engine (verifiedSummary.ts); none when the file is not verified.
  if (p.kind === 'income_tax' && p.summary) {
    const s = p.summary
    lines.push(row('ASSESSMENTS'))
    lines.push(row('Period from', 'Period to', 'Assessed on', 'Payment due', 'Amount', 'Unpaid', 'Status'))
    for (const a of s.assessments) {
      lines.push(row(a.period?.from, a.period?.to, a.assessedOn, a.paymentDue, money(a.amount), money(a.unpaid), unpaidPhrase(a) ?? (a.unpaid > 0 ? 'unpaid, not yet due' : 'paid')))
    }
    lines.push(row('Total assessed', '', '', '', money(s.assessedTotal)))
    lines.push('')
    lines.push(row('Payments', s.payments.count, money(s.payments.total), s.payments.first, s.payments.last))
    lines.push(row('GIC charged', money(s.gic.charged)))
    lines.push(row('GIC remitted or amended', money(s.gic.remitted)))
    lines.push(row('GIC net', money(s.gic.net)))
    lines.push(row('Note', s.note))
  } else if (p.kind === 'super_guarantee' && p.summary) {
    const s = p.summary
    lines.push(row('QUARTERS'))
    lines.push(row('Quarter from', 'Quarter to', 'SG shortfall', 'Nominal interest', 'Administration fee', 'Total', 'Latest', 'Every event (newest first)'))
    for (const q of s.quarters) {
      lines.push(
        row(
          q.period.from,
          q.period.to,
          money(q.shortfall),
          money(q.nominalInterest),
          money(q.adminFee),
          money(q.total),
          q.headline?.label,
          q.events.map((e) => `${SG_EVENT_LABEL[e.kind]} ${e.processed ?? ''}`.trim()).join('; '),
        ),
      )
    }
    lines.push(row('Total', '', money(s.totals.shortfall), money(s.totals.nominalInterest), money(s.totals.adminFee), money(s.totals.total)))
    lines.push('')
    lines.push(row('Part 7 penalty charged', money(s.part7.charged)))
    lines.push(row('Part 7 penalty remitted', money(s.part7.remitted)))
    lines.push(row('Part 7 penalty net', money(s.part7.net)))
    lines.push(row('GIC charged', money(s.gic.charged)))
    lines.push(row('GIC remitted or amended', money(s.gic.remitted)))
    lines.push(row('Payments', s.payments.count, money(s.payments.total), s.payments.first, s.payments.last))
    lines.push(row('Note', s.note))
  }

  lines.push('')
  lines.push(row('DEBT COMPOSITION'))
  if (v?.composition) {
    // As the ATO's own balance proved it: every line in the ATO's words.
    const c = v.composition
    const debt = new Set(['tax', 'interest', 'penalties'])
    lines.push(row('Balance brought forward', money(c.opening)))
    for (const l of c.lines.filter((x) => debt.has(x.section))) lines.push(row(l.label, money(l.net), `${l.rows} rows`, l.search.join(' | ')))
    lines.push(row('= ATO debt', money(c.atoDebt)))
    for (const l of c.lines.filter((x) => !debt.has(x.section))) lines.push(row(l.label, money(l.net), `${l.rows} rows`, l.search.join(' | ')))
    lines.push(row(`= The ATO's balance${v.balanceDate ? ` at ${v.balanceDate}` : ''}`, money(c.total)))
    return lines.join('\n') + '\n'
  }
  for (const l of p.composition.lines) lines.push(row(l.label, money(l.amount), l.explanation))
  if (p.composition.uncounted.length > 0) {
    lines.push('')
    lines.push(row('Rows not counted', 'Rows', 'Debits', 'Credits', 'Why'))
    for (const g of p.composition.uncounted) lines.push(row(g.label, g.count, money(g.debits), money(g.credits), g.reason))
  }
  return lines.join('\n') + '\n'
}
