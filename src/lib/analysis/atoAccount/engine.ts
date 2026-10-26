import { parseActivityStatementCsv } from '../parseActivityStatement'
import { markBreakdownRows } from '../paymentAllocations'
import { RECONCILIATION_LABEL } from '../debtReconciliation'
import { readAtoAccountHeader, type AtoAccountKind } from '../atoAccountKind'
import { icaPosition, type IcaRow } from '@/lib/sbr/creditorDebt'
import type { CompositionRow, UncountedGroup } from '../debtComposition'
import type { EnrichedRow, LodgementType } from '../types'
import { classifyAccountRow, LINE_META, type AccountLineKey } from './classify'

/**
 * The ATO account analysis shared by the income tax and superannuation
 * guarantee accounts (migration 0038). Pure; no AI.
 *
 * Built from the activity statement analysis's parts, which it uses as they
 * are and never changes (the SBR prediction depends on them):
 *   - the CSV reader (parseActivityStatement.ts: it checks the layout, not the account);
 *   - the breakdown rows: a payment printed with its allocations below it, a
 *     refund with its details, a "General interest charge" total over the
 *     interest rows it sums (paymentAllocations.ts), counted once;
 *   - the newest printed balance as the balance owing (icaPosition, as the
 *     prediction's ATO debt).
 *
 * What is the account's own is which line each row counts in (classify.ts)
 * and the summary of its assessments or quarters (incomeTax.ts,
 * superGuarantee.ts).
 *
 * The composition: balance brought forward + each kind of debt (net) +
 * refunds − payments − other credits = what the rows account for. The ATO's
 * own balance less that is the unexplained difference, never hidden; above
 * $1,000 the analysis needs review before it is used.
 */

/** Above this, the analysis is locked until staff review it. */
export const NEEDS_REVIEW_THRESHOLD = 1000

export interface AccountRow extends EnrichedRow {
  /** The composition line the row counts in; null when it does not count (a breakdown row, or an unknown debit). */
  line: AccountLineKey | null
}

export interface AccountCompositionLine {
  key: AccountLineKey | 'opening' | 'totalDebt' | 'composed' | 'atoBalance' | 'unexplained'
  label: string
  /** Debt lines: net added to the balance. Payments and credits: shown positive, they reduce it. */
  amount: number
  /** What was charged and what was taken off, for the debt lines. */
  debits?: number
  credits?: number
  explanation: string
  rows: CompositionRow[]
}

export interface AccountComposition {
  lines: AccountCompositionLine[]
  uncounted: UncountedGroup[]
}

export interface AtoAccountCore {
  kind: AtoAccountKind
  /** Line 1 as printed, e.g. "Income tax 001". */
  label: string
  /** Line 2 as printed. */
  entityName: string
  rows: AccountRow[]
  /** The newest printed balance: positive owed to the ATO (DR), negative a credit (CR). */
  balance: number | null
  balanceDate: string | null
  /** The latest processed date in the file. */
  statementDate: string | null
  openingBalance: number
  /** Net per line, by key. */
  totals: Partial<Record<AccountLineKey, { debits: number; credits: number; net: number }>>
  composedBalance: number
  unexplainedDifference: number | null
  needsReview: boolean
  composition: AccountComposition
  payments: { count: number; total: number; first: string | null; last: string | null }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A parser date (local midnight) as its calendar day, yyyy-mm-dd. */
export function calendarDay(d: Date | null): string | null {
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null
}

export const asCompositionRow = (r: EnrichedRow): CompositionRow => ({
  rowIndex: r.rowIndex,
  processedDate: calendarDay(r.processedDate),
  description: r.description,
  debit: r.debit,
  credit: r.credit,
})

/** What a counted row does to the balance. Credit-only lines (payments, other credits) count credits only. */
function effect(r: AccountRow): number {
  if (!r.line) return 0
  if (LINE_META[r.line].side === 'credit') return -(r.credit ?? 0)
  return (r.debit ?? 0) - (r.credit ?? 0)
}

/** The part of a row a line counts: credit-only lines leave a debit uncounted. */
function countedParts(r: AccountRow): { debit: number; credit: number } {
  if (!r.line) return { debit: 0, credit: 0 }
  if (LINE_META[r.line].side === 'credit') return { debit: 0, credit: r.credit ?? 0 }
  return { debit: r.debit ?? 0, credit: r.credit ?? 0 }
}

/**
 * The balance owed before the export's first row: the oldest printed balance,
 * less what the rows up to and including it account for.
 *
 * Within a processed day the ATO does not always print in time order: on one
 * real account a payment effective the day before sat above an interest charge
 * of the day, carrying the balance from before that charge. So the first day
 * with a balance is put in effective-date order (oldest first; on the same
 * effective date, the row printed lower is the older), and the first balance
 * in that order is the one used.
 *
 * (The activity statement analysis keeps its own rule — the first balance
 * printed on the day — unchanged, as the SBR prediction depends on it.)
 */
function openingBalanceOf(rows: AccountRow[]): number {
  const days = new Map<number, AccountRow[]>()
  for (const row of rows) {
    if (!row.processedDate) continue
    const key = row.processedDate.getTime()
    days.set(key, [...(days.get(key) ?? []), row])
  }
  let counted = 0
  for (const key of [...days.keys()].sort((a, b) => a - b)) {
    const day = days.get(key)!
    if (!day.some((r) => r.balance !== null)) {
      counted += day.reduce((s, r) => s + effect(r), 0)
      continue
    }
    const inTimeOrder = [...day].sort(
      (a, b) => ((a.effectiveDate ?? a.processedDate)!.getTime() - (b.effectiveDate ?? b.processedDate)!.getTime()) || b.rowIndex - a.rowIndex,
    )
    for (const r of inTimeOrder) {
      counted += effect(r)
      if (r.balance !== null) {
        const opening = round2(r.balance - counted)
        return Math.abs(opening) < 0.005 ? 0 : opening
      }
    }
  }
  return 0
}

const UNCOUNTED: Partial<Record<LodgementType, { label: string; reason: string }>> = {
  PaymentAllocation: { label: 'Payment allocation rows', reason: 'They show how a payment above them was allocated; the payment is counted.' },
  RefundDetail: { label: 'Refund detail rows', reason: 'They break down a refund above them; the refund is counted.' },
  GICDetail: { label: 'Interest detail rows', reason: 'They break down an interest total above them; the total is counted.' },
  GICSummary: { label: 'Interest summary rows ("General interest charge")', reason: 'Each sums the interest rows under it, which are counted.' },
  Payment: { label: 'Payment rows with a debit', reason: 'Only payments received (credits) are counted.' },
  Other: { label: 'Rows of a kind not recognised yet', reason: 'Not counted in the composition: a debit here is part of the unexplained difference.' },
  SubLine: { label: 'SGC statement rows with an amount', reason: "A quarter's statement row is normally $0, its amounts on the rows above it; an amount on the row itself is not counted." },
}

/** Read an ATO account CSV of any kind into the shared core. Throws when the file is not an ATO account export. */
export function analyseAccountCore(csvText: string): AtoAccountCore {
  const header = readAtoAccountHeader(csvText)
  if (header.kind === 'unrecognised') throw new Error('Account type not recognised yet')
  const kind = header.kind
  const parsed = parseActivityStatementCsv(csvText)

  const classified = parsed.rows.map((r) => {
    const c = classifyAccountRow(kind, r.description)
    return { ...r, lodgementType: c.lodgementType, lateLodgementDays: 0, lateLodgeDaysCleaned: 0, line: c.line } as AccountRow
  })
  // Breakdown rows re-typed (and so no longer counted); everything else as classified.
  const marked = markBreakdownRows(classified) as AccountRow[]
  const rows = marked.map((r, i) => (r.lodgementType === classified[i].lodgementType ? r : { ...r, line: null }))

  const totals: AtoAccountCore['totals'] = {}
  const rowsOf = new Map<AccountLineKey, CompositionRow[]>()
  const uncounted = new Map<LodgementType, UncountedGroup>()
  const payments = { count: 0, total: 0, first: null as string | null, last: null as string | null }

  for (const r of rows) {
    const parts = countedParts(r)
    if (r.line) {
      const t = totals[r.line] ?? { debits: 0, credits: 0, net: 0 }
      t.debits = round2(t.debits + parts.debit)
      t.credits = round2(t.credits + parts.credit)
      t.net = round2(t.debits - t.credits)
      totals[r.line] = t
      rowsOf.set(r.line, [...(rowsOf.get(r.line) ?? []), asCompositionRow(r)])
      if (r.line === 'payments' && parts.credit > 0) {
        payments.count += 1
        payments.total = round2(payments.total + parts.credit)
        const d = calendarDay(r.effectiveDate ?? r.processedDate)
        if (d && (!payments.first || d < payments.first)) payments.first = d
        if (d && (!payments.last || d > payments.last)) payments.last = d
      }
    }
    const leftDebit = round2((r.debit ?? 0) - parts.debit)
    const leftCredit = round2((r.credit ?? 0) - parts.credit)
    if (leftDebit === 0 && leftCredit === 0) continue
    const meta = UNCOUNTED[r.lodgementType] ?? { label: r.lodgementType, reason: 'Not counted in the composition.' }
    const group = uncounted.get(r.lodgementType) ?? { kind: r.lodgementType, ...meta, count: 0, debits: 0, credits: 0 }
    group.count += 1
    group.debits = round2(group.debits + leftDebit)
    group.credits = round2(group.credits + leftCredit)
    uncounted.set(r.lodgementType, group)
  }

  const openingBalance = openingBalanceOf(rows)
  const debtKeys = (Object.keys(LINE_META) as AccountLineKey[]).filter((k) => LINE_META[k].side === 'debt' && k !== 'refunds')
  const totalDebt = round2(debtKeys.reduce((s, k) => s + (totals[k]?.net ?? 0), 0))
  const refunds = totals.refunds?.net ?? 0
  const credited = round2((totals.payments?.credits ?? 0) + (totals.otherCredits?.credits ?? 0))
  const composedBalance = round2(openingBalance + totalDebt + refunds - credited)
  const position = icaPosition(rows as unknown as IcaRow[])
  const unexplainedDifference = position.balance === null ? null : round2(position.balance - composedBalance)

  const lines: AccountCompositionLine[] = []
  if (openingBalance !== 0) {
    lines.push({
      key: 'opening',
      label: 'Balance brought forward',
      amount: openingBalance,
      explanation: "Owed before the export's first row: the first balance the ATO printed, less what the rows up to it account for.",
      rows: [],
    })
  }
  for (const key of debtKeys) {
    const t = totals[key]
    if (!t && !LINE_META[key].always?.includes(kind)) continue
    lines.push({
      key,
      label: LINE_META[key].label,
      amount: t?.net ?? 0,
      debits: t?.debits ?? 0,
      credits: t?.credits ?? 0,
      explanation: LINE_META[key].explain(t?.debits ?? 0, t?.credits ?? 0),
      rows: rowsOf.get(key) ?? [],
    })
  }
  lines.push({
    key: 'totalDebt',
    label: 'Total ATO debt accrued',
    amount: totalDebt,
    explanation: `Everything charged on this account, net of reductions: ${lines
      .filter((l) => l.key !== 'opening')
      .map((l) => `${l.label.toLowerCase()} (${money(l.amount)})`)
      .join(' + ')}.`,
    rows: [],
  })
  if (refunds !== 0) {
    lines.push({ key: 'refunds', label: LINE_META.refunds.label, amount: refunds, explanation: LINE_META.refunds.explain(0, 0), rows: rowsOf.get('refunds') ?? [] })
  }
  lines.push({
    key: 'payments',
    label: LINE_META.payments.label,
    amount: totals.payments?.credits ?? 0,
    explanation:
      payments.count === 0
        ? 'No payments found in the account.'
        : `${payments.count} payment${payments.count === 1 ? '' : 's'} the ATO received (allocation rows not counted twice).`,
    rows: rowsOf.get('payments') ?? [],
  })
  if (totals.otherCredits) {
    lines.push({
      key: 'otherCredits',
      label: LINE_META.otherCredits.label,
      amount: totals.otherCredits.credits,
      explanation: LINE_META.otherCredits.explain(0, totals.otherCredits.credits),
      rows: rowsOf.get('otherCredits') ?? [],
    })
  }
  lines.push({
    key: 'composed',
    label: 'What the rows account for',
    amount: composedBalance,
    explanation: 'Balance brought forward + total ATO debt + refunds − payments − credits.',
    rows: [],
  })
  if (position.balance !== null) {
    lines.push({
      key: 'atoBalance',
      label: 'ATO balance',
      amount: position.balance,
      explanation: `The ATO's own running balance on its newest row${position.balanceDate ? ` (${position.balanceDate})` : ''}.`,
      rows: [],
    })
  }
  if (unexplainedDifference !== null) {
    lines.push({
      key: 'unexplained',
      label: RECONCILIATION_LABEL,
      amount: unexplainedDifference,
      explanation: `The ATO's own balance (${money(position.balance ?? 0)}) minus what the rows account for (${money(composedBalance)}). The rows no line counts are listed below.`,
      rows: [],
    })
  }

  return {
    kind,
    label: parsed.statementLabel,
    entityName: parsed.companyName,
    rows,
    balance: position.balance,
    balanceDate: position.balanceDate,
    statementDate: position.statementDate,
    openingBalance,
    totals,
    composedBalance,
    unexplainedDifference,
    needsReview: unexplainedDifference !== null && Math.abs(unexplainedDifference) > NEEDS_REVIEW_THRESHOLD,
    composition: { lines, uncounted: [...uncounted.values()] },
    payments,
  }
}

/** "for the period from 01 Jul 21 to 30 Sep 21" as ISO dates, or null. */
export function periodOf(description: string): { from: string; to: string } | null {
  const m = description.match(/period from (\d{1,2} \w{3} \d{2,4}) to (\d{1,2} \w{3} \d{2,4})/i)
  if (!m) return null
  const iso = (raw: string) => {
    const [d, mon, y] = raw.split(' ')
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mon.toLowerCase())
    if (month < 0) return null
    const year = y.length === 2 ? 2000 + Number(y) : Number(y)
    return `${year}-${String(month + 1).padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const from = iso(m[1])
  const to = iso(m[2])
  return from && to ? { from, to } : null
}
