import { differenceInCalendarDays } from 'date-fns'
import type { ExtractedBalanceSheet } from '@/lib/financials/types'

/**
 * The creditor debt an SBR offer is sized against, and the dates the
 * prediction measures from. Pure. Shared by the predict-outcome route and the
 * outcome-prediction page, so the two can never disagree.
 *
 * DEFINITION PENDING (Gabby to confirm): the historical cases record a
 * "creditor debt". Whether that means ALL unsecured creditors or the ATO only
 * is not settled. Until it is, creditor debt = the ATO debt, worked out here
 * and nowhere else — change this one function when the answer comes.
 */

/** One row of an analysed ATO integrated client account (stored in lodgement_analyses.rows). */
export interface IcaRow {
  rowIndex?: number
  processedDate?: string | Date | null
  balance?: number | null
  lodgementType?: string
}

function dateOf(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  // A Date straight from the CSV parser is local midnight: keep its calendar
  // day, whatever the server's time zone. Stored rows are ISO strings.
  const d =
    value instanceof Date ? new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())) : new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * The account's position as the ATO printed it. The balance is the ATO's own
 * running balance on the newest row that shows one (positive = owed to the
 * ATO) — not a sum of categories. The statement date is the latest date in
 * the file: the day the export was taken, near enough.
 */
export function icaPosition(rows: readonly IcaRow[] | null | undefined): {
  balance: number | null
  balanceDate: string | null
  statementDate: string | null
} {
  if (!rows || rows.length === 0) return { balance: null, balanceDate: null, statementDate: null }
  let statement: Date | null = null
  let best: { d: Date; index: number; balance: number } | null = null
  rows.forEach((row, i) => {
    const d = dateOf(row.processedDate)
    if (!d) return
    if (!statement || d > statement) statement = d
    if (typeof row.balance !== 'number') return
    const index = row.rowIndex ?? i
    // Newest date wins; on the same day, the row printed first (the ATO lists newest first).
    if (!best || d > best.d || (d.getTime() === best.d.getTime() && index < best.index)) {
      best = { d, index, balance: row.balance }
    }
  })
  const b = best as { d: Date; index: number; balance: number } | null
  const s = statement as Date | null
  return {
    balance: b ? b.balance : null,
    balanceDate: b ? isoDate(b.d) : null,
    statementDate: s ? isoDate(s) : null,
  }
}

/**
 * Days from the last payment to the account's statement date — not to today,
 * so the figure does not change from one day to the next while the statement
 * stays the same. 9999 when no payment is on the account.
 */
export function daysSinceLastPayment(rows: readonly IcaRow[] | null | undefined): number {
  if (!rows || rows.length === 0) return 9999
  const { statementDate } = icaPosition(rows)
  let last: Date | null = null
  for (const row of rows) {
    if (row.lodgementType !== 'Payment') continue
    const d = dateOf(row.processedDate)
    if (d && (!last || d > last)) last = d
  }
  if (!last || !statementDate) return 9999
  return Math.max(0, differenceInCalendarDays(new Date(`${statementDate}T00:00:00Z`), last))
}

export type CreditorDebtSource = 'ica' | 'balance_sheet' | 'staff'

export interface CreditorDebt {
  amount: number | null
  source: CreditorDebtSource | null
  /** The date the amount is as at (ISO). */
  asOf: string | null
  /** Where it came from, as shown after "Source:": "ATO account statement, 26 Sep 2026". */
  description: string
  /** What to provide when there is no amount. */
  missing: string | null
  /** Why the ATO account statement was not used, when it was not. */
  icaNotUsed: string | null
}

/** One log line for the decision: source, amount, date, and why the ATO account was not used. */
export function describeDecision(debt: CreditorDebt): string {
  return [
    `source=${debt.source ?? 'none'}`,
    `amount=${debt.amount ?? 'none'}`,
    `asOf=${debt.asOf ?? 'none'}`,
    debt.icaNotUsed ? `icaNotUsed="${debt.icaNotUsed}"` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

function whyNotIca(icaRows: readonly IcaRow[] | null | undefined): string {
  if (!icaRows || icaRows.length === 0) return 'no lodgement analysis (upload and analyse the Activity Statement CSV)'
  return 'the lodgement analysis rows carry no balance owing (re-run the lodgement analysis)'
}

/**
 * What a balance sheet says is owed to the ATO: ATO liability, GST and PAYG
 * withholding. NOT superannuation payable — that is owed to super funds, not
 * the ATO. Null when the balance sheet shows none of them.
 */
export const BALANCE_SHEET_ATO_KEYS = ['atoLiability', 'gstPayable', 'paygWithholdingPayable'] as const

export function balanceSheetAtoTotal(bs: ExtractedBalanceSheet | null | undefined): number | null {
  if (!bs) return null
  const cl = (bs.currentLiabilities ?? {}) as Record<string, unknown>
  const values = BALANCE_SHEET_ATO_KEYS.map((k) => cl[k]).filter((v): v is number => typeof v === 'number')
  return values.length ? values.reduce((a, b) => a + b, 0) : null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "26 Sep 2026" — fixed three-letter months (the en-AU locale gives "Sept", "June"). */
const longDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * The creditor debt, from the best source available — never from two added
 * together (the integrated client account already holds the GST and PAYG
 * that a balance sheet lists separately):
 *   1. an amount staff entered;
 *   2. the ATO account statement's balance owing, as at the statement date;
 *   3. the balance sheet's ATO liability, GST and PAYG (not super).
 */
export function creditorDebt(input: {
  icaRows?: readonly IcaRow[] | null
  balanceSheet?: ExtractedBalanceSheet | null
  balanceSheetDate?: string | null
  balanceSheetLabel?: string | null
  staffAmount?: number | null
}): CreditorDebt {
  const { icaRows, balanceSheet, balanceSheetDate, balanceSheetLabel, staffAmount } = input

  if (typeof staffAmount === 'number' && Number.isFinite(staffAmount) && staffAmount >= 0) {
    return { amount: staffAmount, source: 'staff', asOf: null, description: 'Entered by staff', missing: null, icaNotUsed: 'staff entered the amount' }
  }

  const ica = icaPosition(icaRows)
  if (ica.balance !== null) {
    // A credit balance means the ATO owes the client: no ATO debt.
    const asOf = ica.statementDate ?? ica.balanceDate
    return {
      amount: Math.max(0, ica.balance),
      source: 'ica',
      asOf,
      description: `ATO account statement${asOf ? `, ${longDate(asOf)}` : ''}`,
      missing: null,
      icaNotUsed: null,
    }
  }

  const fromBalanceSheet = balanceSheetAtoTotal(balanceSheet)
  if (fromBalanceSheet !== null) {
    // An analysis whose rows carry no balance was read before the CSV
    // line-ending fix: re-running it gives the account balance.
    const stale = Array.isArray(icaRows) && icaRows.length > 0
    return {
      amount: fromBalanceSheet,
      source: 'balance_sheet',
      asOf: balanceSheetDate ?? null,
      description: [
        `Balance sheet${balanceSheetLabel ? ` (${balanceSheetLabel})` : ''}${balanceSheetDate ? `, as at ${longDate(balanceSheetDate)}` : ''}: ATO, GST and PAYG`,
        stale ? '. Re-run the lodgement analysis to use the ATO account balance' : '',
      ].join(''),
      missing: null,
      icaNotUsed: whyNotIca(icaRows),
    }
  }

  return {
    amount: null,
    source: null,
    asOf: null,
    description: 'No ATO debt figure yet',
    missing:
      'The ATO debt: upload and analyse the ATO integrated client account CSV, or enter the amount here.',
    icaNotUsed: whyNotIca(icaRows),
  }
}
