import { latestBalanceSheet } from '@/lib/financials/statementSelection'
import type { StatementLine, StoredStatementSlot } from '@/lib/financials/types'
import { longDate } from './creditorDebt'

/**
 * "Creditors in the SBR": the ATO debt (creditorDebt.ts) plus up to six
 * other creditors staff enter, each with its own label and amount. The offer
 * is sized on their total (Gabby, 14 Oct: the ATO debt alone leaves out
 * credit cards, bank debt and trade creditors). Pure; shared by the page,
 * the predict-outcome route and the exports.
 *
 * Balance-sheet hints are shown beside the rows and never filled in: staff
 * decide which creditors are in the SBR.
 */

export const CREDITOR_ROW_COUNT = 6
export const CREDITOR_LABEL_MAX = 60

/**
 * Gabby's words. No default row for equipment or vehicle finance: secured
 * finance normally sits outside an SBR, and a row of its own would invite
 * including it. It shows only as a caution on the Cash loans hint.
 */
export const DEFAULT_CREDITOR_LABELS = [
  'Credit cards',
  'Cash loans',
  'Bank overdraft',
  'Trade suppliers',
  'Other creditor 1',
  'Other creditor 2',
] as const

export interface CreditorRow {
  label: string
  /** Null when the row is left blank. */
  amount: number | null
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
  return DEFAULT_CREDITOR_LABELS.map((label) => ({ label, amount: null }))
}

/**
 * Six rows, labels trimmed and capped, amounts finite and not negative.
 * Anything else becomes a blank amount; missing rows take the default labels.
 */
export function normaliseCreditorRows(rows: readonly Partial<CreditorRow>[] | null | undefined): CreditorRow[] {
  const defaults = defaultCreditorRows()
  return defaults.map((fallback, i) => {
    const row = rows?.[i]
    if (!row) return fallback
    const label = typeof row.label === 'string' ? row.label.trim().slice(0, CREDITOR_LABEL_MAX) : fallback.label
    const amount = typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount >= 0 ? row.amount : null
    return { label, amount }
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
    rows: normaliseCreditorRows(Array.isArray(v.rows) ? (v.rows as Partial<CreditorRow>[]) : null),
  }
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

/**
 * A hint per default row (the row's position: credit cards, cash loans,
 * overdraft, trade suppliers; none for the two "other" rows), from the
 * current-period balance sheet when there is one, else the latest year's.
 * A $0 overdraft in the current period is shown: it was repaid.
 *
 * Chattel, hire-purchase, vehicle or equipment finance is added to the Cash
 * loans hint with the caution that it is usually secured.
 */
export function creditorHints(slots: StoredStatementSlot[]): (CreditorHint | null)[] {
  const hints: (CreditorHint | null)[] = Array.from({ length: CREDITOR_ROW_COUNT }, () => null)
  const statement = latestBalanceSheet(slots, { preferCurrentPeriod: true })
  if (!statement) return hints
  const { slot, balanceSheet } = statement
  const source =
    slot.sourceColumn === 'current_period'
      ? `at ${longDate(slot.periodEndDate)} (current period)`
      : `FY${slot.financialYear} balance sheet`
  const lines = (balanceSheet as { lines?: StatementLine[] }).lines ?? []
  const hint = (amount: number | null, caution: string | null = null): CreditorHint | null =>
    amount === null ? null : { amount, source, caution }

  const overdraft = (balanceSheet.currentLiabilities as Record<string, unknown>)?.bankOverdraft
  const chattel = (balanceSheet.nonCurrentLiabilities as Record<string, unknown>)?.chattelMortgages

  const loans = sumLines(lines, CASH_LOAN)
  const finance = typeof chattel === 'number' ? Math.abs(chattel) : sumLines(lines, EQUIPMENT_FINANCE)
  const withFinance = finance !== null && finance > 0

  hints[0] = hint(sumLines(lines, CREDIT_CARD))
  hints[1] = hint(
    loans === null && !withFinance ? null : (loans ?? 0) + (withFinance ? finance : 0),
    withFinance ? `Includes ${dollars(finance)} of chattel, hire-purchase, vehicle or equipment finance. ${SECURED}` : null,
  )
  hints[2] = hint(typeof overdraft === 'number' ? Math.abs(overdraft) : null)
  hints[3] = hint(sumLines(lines, TRADE_CREDITORS))
  return hints
}
