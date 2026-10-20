import type { DebtBreakdown, EnrichedRow, LodgementType } from './types'

/**
 * The debt composition, line by line, with the ATO rows behind each line and
 * a sentence saying what the line is — for the lodgement report's expandable
 * breakdown and its PDF and CSV. Pure; the figures are computeDebtBreakdown's.
 *
 * "Unexplained difference" is the ATO's own balance less what the rows
 * account for. It lists every row the composition does not count, grouped by
 * kind, with each group's debits and credits.
 */

export type CompositionKey =
  | 'opening'
  | 'principal'
  | 'interest'
  | 'penalties'
  | 'audit'
  | 'totalDebt'
  | 'refunds'
  | 'payments'
  | 'government'
  | 'otherCredits'
  | 'composed'
  | 'atoBalance'
  | 'unexplained'

export interface CompositionRow {
  rowIndex: number
  /** yyyy-mm-dd */
  processedDate: string | null
  description: string
  debit: number | null
  credit: number | null
}

export interface CompositionLine {
  key: CompositionKey
  label: string
  /** Positive adds to the balance owing; payments and credits are shown as positive amounts that reduce it. */
  amount: number
  explanation: string
  /** The ATO rows behind the line; empty for a line that is a sum of other lines. */
  rows: CompositionRow[]
}

export interface UncountedGroup {
  kind: LodgementType
  label: string
  /** Why the composition leaves these rows out. */
  reason: string
  count: number
  debits: number
  credits: number
}

export interface DebtComposition {
  lines: CompositionLine[]
  /** Rows (or parts of rows) no line counts. */
  uncounted: UncountedGroup[]
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

const round2 = (n: number) => Math.round(n * 100) / 100

function day(d: Date | null): string | null {
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null
}

const asRow = (r: EnrichedRow): CompositionRow => ({
  rowIndex: r.rowIndex,
  processedDate: day(r.processedDate),
  description: r.description,
  debit: r.debit,
  credit: r.credit,
})

/** What each kind of row contributes, and to which line. Credit-only kinds count credits only. */
function counted(r: EnrichedRow): { key: CompositionKey; debit: number; credit: number } | null {
  const debit = r.debit ?? 0
  const credit = r.credit ?? 0
  switch (r.lodgementType) {
    case 'Original':
    case 'ClientAmended':
      return { key: 'principal', debit, credit }
    case 'GIC':
      return { key: 'interest', debit, credit }
    case 'FTLPenalty':
    case 'GeneralPenalty':
      return { key: 'penalties', debit, credit }
    case 'ATOAudit':
      return { key: 'audit', debit, credit }
    case 'Refund':
      return { key: 'refunds', debit, credit }
    case 'Payment':
      return credit > 0 ? { key: 'payments', debit: 0, credit } : null
    case 'GovernmentCredit':
      return credit > 0 ? { key: 'government', debit: 0, credit } : null
    case 'CreditTransfer':
    case 'Other':
      return credit > 0 ? { key: 'otherCredits', debit: 0, credit } : null
    default:
      return null
  }
}

const UNCOUNTED: Partial<Record<LodgementType, { label: string; reason: string }>> = {
  SubLine: { label: 'Lodgement sub-lines ("- GST", "- PAYG Withholding")', reason: 'They split the lodgement row above them, which is counted.' },
  PaymentAllocation: { label: 'Payment allocation rows', reason: 'They show how a payment above them was allocated; the payment is counted.' },
  RefundDetail: { label: 'Refund detail rows', reason: 'They break down a refund above them; the refund is counted.' },
  GICDetail: { label: 'Interest detail rows', reason: 'They break down an interest total above them; the total is counted.' },
  GICSummary: { label: 'Interest summary rows ("General interest charge")', reason: 'Each sums the interest rows under it, which are counted.' },
  ATOAmended: { label: 'ATO-initiated amendments', reason: 'Not counted in the composition yet.' },
  Payment: { label: 'Payment rows with a debit', reason: 'Only payments received (credits) are counted.' },
  GovernmentCredit: { label: 'Government credit rows with a debit', reason: 'Only the credits are counted.' },
  CreditTransfer: { label: 'Transfer rows with a debit', reason: 'Only the credits are counted.' },
  Other: { label: 'Other rows with a debit', reason: 'Only the credits are counted.' },
}

export function debtComposition(rows: readonly EnrichedRow[], b: DebtBreakdown): DebtComposition {
  const rowsOf = new Map<CompositionKey, CompositionRow[]>()
  const uncounted = new Map<LodgementType, UncountedGroup>()

  for (const r of rows) {
    const c = counted(r)
    if (c) {
      const list = rowsOf.get(c.key) ?? []
      list.push(asRow(r))
      rowsOf.set(c.key, list)
    }
    // Whatever of the row no line counts.
    const leftDebit = round2((r.debit ?? 0) - (c?.debit ?? 0))
    const leftCredit = round2((r.credit ?? 0) - (c?.credit ?? 0))
    if (leftDebit === 0 && leftCredit === 0) continue
    const meta = UNCOUNTED[r.lodgementType] ?? { label: r.lodgementType, reason: 'Not counted in the composition.' }
    const group = uncounted.get(r.lodgementType) ?? { kind: r.lodgementType, ...meta, count: 0, debits: 0, credits: 0 }
    group.count += 1
    group.debits = round2(group.debits + leftDebit)
    group.credits = round2(group.credits + leftCredit)
    uncounted.set(r.lodgementType, group)
  }

  const rowsFor = (key: CompositionKey) => rowsOf.get(key) ?? []
  const lines: CompositionLine[] = []
  const push = (line: CompositionLine) => lines.push(line)

  if (b.openingBalance !== 0) {
    push({
      key: 'opening',
      label: 'Balance brought forward',
      amount: b.openingBalance,
      explanation: `Owed before the export's first row: the first balance the ATO printed, less what the rows up to it account for.`,
      rows: [],
    })
  }
  push({
    key: 'principal',
    label: 'Tax lodged (after amendments)',
    amount: b.principalNet,
    explanation: `Activity statements lodged: ${money(b.principalDebits)} charged, less ${money(b.principalCredits)} reduced by amendments or credit statements.`,
    rows: rowsFor('principal'),
  })
  push({
    key: 'interest',
    label: 'Interest (GIC)',
    amount: b.interestNet,
    explanation: `General interest charged: ${money(b.interestDebits)}, less ${money(b.interestCredits)} remitted or amended.`,
    rows: rowsFor('interest'),
  })
  push({
    key: 'penalties',
    label: 'Penalties',
    amount: b.penaltyNet,
    explanation: `Failure-to-lodge and other penalties: ${money(b.penaltyDebits)}${b.penaltyCredits ? `, less ${money(b.penaltyCredits)} remitted` : ''}.`,
    rows: rowsFor('penalties'),
  })
  if (b.auditDebits !== 0 || b.auditCredits !== 0) {
    push({
      key: 'audit',
      label: 'ATO audit amendments',
      amount: b.auditNet,
      explanation: `Activity statements the ATO amended on audit: ${money(b.auditDebits)} raised${b.auditCredits ? `, less ${money(b.auditCredits)}` : ''}. The ATO raised these, not the client, so they are not late lodgements.`,
      rows: rowsFor('audit'),
    })
  }
  push({
    key: 'totalDebt',
    label: 'Total ATO debt accrued',
    amount: b.totalAtoDebt,
    explanation: [
      `Everything the ATO charged: tax lodged (${money(b.principalNet)} after amendments)`,
      `interest (${money(b.interestNet)})`,
      `penalties (${money(b.penaltyNet)})`,
      ...(b.auditNet !== 0 ? [`ATO audit amendments (${money(b.auditNet)})`] : []),
    ].join(' + ') + '.',
    rows: [],
  })
  if (b.refundsPaid !== 0) {
    push({
      key: 'refunds',
      label: 'Refunds paid out',
      amount: b.refundsPaid,
      explanation: 'Money the ATO paid out to the business, which adds back to what is owed.',
      rows: rowsFor('refunds'),
    })
  }
  push({
    key: 'payments',
    label: 'Payments received',
    amount: b.paymentsReceived,
    explanation:
      b.paymentsCount === 0
        ? 'No payments found in the ATO account.'
        : `${b.paymentsCount} payment${b.paymentsCount === 1 ? '' : 's'} the ATO received (allocation rows not counted twice).`,
    rows: rowsFor('payments'),
  })
  if (b.governmentCredits !== 0) {
    push({
      key: 'government',
      label: 'Government credits',
      amount: b.governmentCredits,
      explanation: 'Cash Flow Boost, JobKeeper and similar credits applied to the account.',
      rows: rowsFor('government'),
    })
  }
  if (b.otherCredits !== 0) {
    push({
      key: 'otherCredits',
      label: 'Other credits',
      amount: b.otherCredits,
      explanation: 'Credit transfers and other credits applied to the account.',
      rows: rowsFor('otherCredits'),
    })
  }
  push({
    key: 'composed',
    label: 'What the rows account for',
    amount: b.composedBalance,
    explanation: 'Balance brought forward + total ATO debt + refunds − payments − credits.',
    rows: [],
  })
  if (b.atoBalance !== null) {
    push({
      key: 'atoBalance',
      label: 'ATO balance',
      amount: b.atoBalance,
      explanation: `The ATO's own running balance on its newest row${b.atoBalanceDate ? ` (${b.atoBalanceDate})` : ''}.`,
      rows: [],
    })
  }
  if (b.unexplainedDifference !== null) {
    push({
      key: 'unexplained',
      label: 'Other adjustments / unexplained difference',
      amount: b.unexplainedDifference,
      explanation: `The ATO's own balance (${money(b.atoBalance ?? 0)}) minus what we can account for from the rows (${money(b.composedBalance)}). The rows no line counts are listed below.`,
      rows: [],
    })
  }

  const order: LodgementType[] = ['SubLine', 'PaymentAllocation', 'RefundDetail', 'GICDetail', 'GICSummary', 'ATOAmended']
  return {
    lines,
    uncounted: [...uncounted.values()].sort(
      (a, c) => ((order.indexOf(a.kind) + 1 || 99) - (order.indexOf(c.kind) + 1 || 99)) || a.kind.localeCompare(c.kind),
    ),
  }
}
