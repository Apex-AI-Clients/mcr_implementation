import { latestBalanceSheet } from '@/lib/financials/statementSelection'
import type { StatementLine, StoredStatementSlot } from '@/lib/financials/types'
import { currentPeriodAt } from '@/lib/financials/periodLabels'

/**
 * "Creditors in the SBR": the ATO debt (creditorDebt.ts) plus the other
 * creditors staff list, each with its own label and amount: rows are added
 * and removed freely (up to MAX_CREDITOR_ROWS). The offer
 * is sized on their total (Gabby, 14 Oct: the ATO debt alone leaves out
 * credit cards, bank debt and trade creditors). Pure; shared by the page,
 * the predict-outcome route and the exports.
 *
 * Balance-sheet hints are shown beside the rows and never filled in: staff
 * decide which creditors are in the SBR.
 */

export const MAX_CREDITOR_ROWS = 20
export const CREDITOR_LABEL_MAX = 60

/** The creditors a balance-sheet hint can be shown for. */
export const CREDITOR_KINDS = ['creditCards', 'cashLoans', 'bankOverdraft', 'tradeSuppliers'] as const
export type CreditorKind = (typeof CREDITOR_KINDS)[number]

/**
 * The rows a new prediction starts with, in Gabby's words. Staff rename,
 * remove or add rows as they like. No row for equipment or vehicle finance:
 * secured finance normally sits outside an SBR, and a row of its own would
 * invite including it. It shows only as a caution on the Cash loans hint.
 */
export const DEFAULT_CREDITORS: readonly { kind: CreditorKind; label: string }[] = [
  { kind: 'creditCards', label: 'Credit cards' },
  { kind: 'cashLoans', label: 'Cash loans' },
  { kind: 'bankOverdraft', label: 'Bank overdraft' },
  { kind: 'tradeSuppliers', label: 'Trade suppliers' },
]

export interface CreditorRow {
  label: string
  /** Null when the row is left blank. */
  amount: number | null
  /** Which balance-sheet hint the row shows, if any; kept when the row is renamed. */
  kind?: CreditorKind
}

/** What is saved with the prediction (sbr_outcome_predictions.creditors). */
export interface SavedCreditors {
  /** The ATO debt the total used. */
  atoDebt: number | null
  /** True when staff typed the ATO debt rather than taking the automatic figure. */
  atoDebtEdited: boolean
  rows: CreditorRow[]
}

export function defaultCreditorRows(): CreditorRow[] {
  return DEFAULT_CREDITORS.map(({ kind, label }) => ({ label, amount: null, kind }))
}

const isKind = (v: unknown): v is CreditorKind => (CREDITOR_KINDS as readonly unknown[]).includes(v)

/**
 * The rows as given (none means none; null means the defaults), at most
 * MAX_CREDITOR_ROWS: labels trimmed and capped, amounts finite and not
 * negative (anything else becomes blank), unknown kinds dropped.
 */
export function normaliseCreditorRows(rows: readonly Partial<CreditorRow>[] | null | undefined): CreditorRow[] {
  if (!rows) return defaultCreditorRows()
  return rows.slice(0, MAX_CREDITOR_ROWS).map((row) => {
    const label = typeof row?.label === 'string' ? row.label.trim().slice(0, CREDITOR_LABEL_MAX) : ''
    const amount = typeof row?.amount === 'number' && Number.isFinite(row.amount) && row.amount >= 0 ? row.amount : null
    return isKind(row?.kind) ? { label, amount, kind: row.kind } : { label, amount }
  })
}

/** The rows that count: an amount above zero. */
export function includedCreditorRows(rows: readonly CreditorRow[]): CreditorRow[] {
  return rows.filter((r) => typeof r.amount === 'number' && r.amount > 0)
}

/**
 * The creditor total the offer is sized on: the ATO debt plus every other
 * row with an amount. Null when there is neither.
 */
export function creditorTotal(atoDebt: number | null, rows: readonly CreditorRow[]): number | null {
  const others = includedCreditorRows(rows)
  if (atoDebt === null && others.length === 0) return null
  return (atoDebt ?? 0) + others.reduce((sum, r) => sum + (r.amount as number), 0)
}

/** A saved creditors value, read defensively (it is jsonb). */
export function readSavedCreditors(value: unknown): SavedCreditors | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const atoDebt = typeof v.atoDebt === 'number' && Number.isFinite(v.atoDebt) ? v.atoDebt : null
  return {
    atoDebt,
    atoDebtEdited: v.atoDebtEdited === true,
    rows: fromFixedRows(normaliseCreditorRows(Array.isArray(v.rows) ? (v.rows as Partial<CreditorRow>[]) : null)),
  }
}

const KIND_OF_LABEL = new Map(DEFAULT_CREDITORS.map(({ kind, label }) => [label, kind]))
const OLD_OTHER_ROW = /^Other creditor [12]$/

/**
 * Rows saved by the fixed six-row version (no kinds): a default label gets
 * its kind back, and an empty "Other creditor 1/2" row is dropped.
 */
function fromFixedRows(rows: CreditorRow[]): CreditorRow[] {
  return rows
    .filter((r) => !(r.amount === null && !r.kind && OLD_OTHER_ROW.test(r.label)))
    .map((r) => (r.kind || !KIND_OF_LABEL.has(r.label) ? r : { ...r, kind: KIND_OF_LABEL.get(r.label) }))
}

// ─── Balance-sheet hints ──────────────────────────────────────────────────────

export interface CreditorHint {
  amount: number
  /** "at 30 Sep 2026 (current period)" or "FY2026 balance sheet". */
  source: string
  /** Shown beside the hint: e.g. finance is usually secured. */
  caution: string | null
}

export const SECURED = 'Usually secured — check before including'

const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`

const LIABILITY_SECTIONS = new Set(['currentLiabilities', 'nonCurrentLiabilities'])
const NOT_A_CREDITOR = /\b(ato|tax|taxation|gst|payg|super|superannuation|director|directors|shareholder|related|associate|beneficiar|unitholder)/i

const CREDIT_CARD = /\b(credit cards?|amex|american express|visa|mastercard)\b/i
const CASH_LOAN = /\b((bank|business|term|cash|unsecured|short[- ]term) loans?|loans? (from|with|-|–)? ?(the )?(bank|nab|cba|commonwealth|westpac|anz))\b/i
const TRADE_CREDITORS = /\b(trade creditors|accounts payable|trade payables|sundry creditors|creditors)\b/i
const EQUIPMENT_FINANCE = /\b(chattel|hire purchase|equipment (loan|finance)|vehicle (loan|finance)|car loan|motor vehicle loan|lease liabilit)/i

function sumLines(lines: readonly StatementLine[], pattern: RegExp): number | null {
  const matched = lines.filter(
    (l) =>
      LIABILITY_SECTIONS.has(l.section) &&
      !l.isTotal &&
      typeof l.value === 'number' &&
      pattern.test(l.rawLabel) &&
      !NOT_A_CREDITOR.test(l.rawLabel),
  )
  return matched.length ? matched.reduce((sum, l) => sum + Math.abs(l.value as number), 0) : null
}

export type CreditorHints = Record<CreditorKind, CreditorHint | null>

/**
 * A hint per kind of creditor (credit cards, cash loans, overdraft, trade
 * suppliers), from the current-period balance sheet when there is one, else
 * the latest year's.
 * A $0 overdraft in the current period is shown: it was repaid.
 *
 * Chattel, hire-purchase, vehicle or equipment finance is added to the Cash
 * loans hint with the caution that it is usually secured.
 */
export function creditorHints(slots: StoredStatementSlot[]): CreditorHints {
  const hints: CreditorHints = { creditCards: null, cashLoans: null, bankOverdraft: null, tradeSuppliers: null }
  const statement = latestBalanceSheet(slots, { preferCurrentPeriod: true })
  if (!statement) return hints
  const { slot, balanceSheet } = statement
  const source =
    slot.sourceColumn === 'current_period'
      ? `at ${currentPeriodAt({ financialYear: slot.financialYear, periodStartDate: slot.periodStartDate, periodEndDate: slot.periodEndDate })}`
      : `FY${slot.financialYear} balance sheet`
  const lines = (balanceSheet as { lines?: StatementLine[] }).lines ?? []
  const hint = (amount: number | null, caution: string | null = null): CreditorHint | null =>
    amount === null ? null : { amount, source, caution }

  const overdraft = (balanceSheet.currentLiabilities as Record<string, unknown>)?.bankOverdraft
  const chattel = (balanceSheet.nonCurrentLiabilities as Record<string, unknown>)?.chattelMortgages

  const loans = sumLines(lines, CASH_LOAN)
  const finance = typeof chattel === 'number' ? Math.abs(chattel) : sumLines(lines, EQUIPMENT_FINANCE)
  const withFinance = finance !== null && finance > 0

  hints.creditCards = hint(sumLines(lines, CREDIT_CARD))
  hints.cashLoans = hint(
    loans === null && !withFinance ? null : (loans ?? 0) + (withFinance ? finance : 0),
    withFinance ? `Includes ${dollars(finance)} of chattel, hire-purchase, vehicle or equipment finance. ${SECURED}` : null,
  )
  hints.bankOverdraft = hint(typeof overdraft === 'number' ? Math.abs(overdraft) : null)
  hints.tradeSuppliers = hint(sumLines(lines, TRADE_CREDITORS))
  return hints
}
