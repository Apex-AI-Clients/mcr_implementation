
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

import type { MappedFigure, PredictionFinancials } from '@/lib/printed/mapping'

export interface CreditorHint {
  amount: number
  /** "at 30 Sep 2026 (current period)" or "FY2026 balance sheet". */
  source: string
  /** Shown beside the hint: e.g. finance is usually secured. */
  caution: string | null
}

export const SECURED = 'Usually secured — check before including'

const EQUIPMENT_FINANCE = /(chattel|hire purchase|equipment (loan|finance)|vehicle (loan|finance)|car loan|motor vehicle loan|lease liabilit)/i

export type CreditorHints = Record<CreditorKind, CreditorHint | null>

/**
 * A hint per kind of creditor, from the printed lines staff confirmed (printed/mapping.ts):
 * credit cards, bank loans and finance, overdraft and trade suppliers, each
 * the mapped lines added up as printed. A meaning with no confirmed line gives
 * no hint. Finance lines (chattel, hire purchase…) keep the caution.
 */
export function mappedCreditorHints(financials: PredictionFinancials): CreditorHints {
  const hint = (f: MappedFigure | null, caution: string | null = null): CreditorHint | null => (f ? { amount: f.amount, source: f.source, caution } : null)
  const secured = financials.cashLoans?.lines.some((l) => EQUIPMENT_FINANCE.test(l.label) || /\b(chattel|hire purchase|finance|unexpired interest|hp loan)\b/i.test(l.label))
  return {
    creditCards: hint(financials.creditCards),
    cashLoans: hint(financials.cashLoans, secured ? `Includes chattel, hire-purchase, vehicle or equipment finance. ${SECURED}` : null),
    bankOverdraft: hint(financials.bankOverdraft),
    tradeSuppliers: hint(financials.tradeSuppliers),
  }
}
