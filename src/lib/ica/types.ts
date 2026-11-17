import type { DetectedAtoAccountKind } from '@/lib/analysis/atoAccountKind'

/**
 * The ATO account (ICA) engine, rebuilt 17 Nov 2026: the ATO's own running
 * balance is the answer key. Every amount is in whole cents, so a check "to
 * the cent" is an integer comparison.
 */
export type Cents = number

/** One row exactly as printed, with the values read from it. */
export interface IcaRow {
  /** Position in the file, 0 = the first row under the header. */
  id: number
  rawProcessed: string
  rawEffective: string
  /** As printed, without the leading apostrophe the ATO adds for spreadsheets. */
  description: string
  rawDebit: string
  rawCredit: string
  rawBalance: string
  /** Calendar days, yyyy-mm-dd; null when the cell is blank or unreadable. */
  processed: string | null
  effective: string | null
  /** 0 when the cell is blank. */
  debit: Cents
  credit: Cents
  /** Owed to the ATO (DR) positive, a credit (CR) negative; null when the row prints no balance. */
  balance: Cents | null
}

/** An RBA ICA spreadsheet's own figures (H3, H4), when the file is one. */
export interface SpreadsheetFigures {
  lateLodgements: number
  cumulativeDaysLate: number
}

export interface IcaFile {
  source: 'csv' | 'xlsx'
  /** Line 1 as printed, e.g. "Activity statement 002". */
  label: string
  /** Line 2 (CSV) or row 3 (spreadsheet) as printed. */
  entityName: string
  kind: DetectedAtoAccountKind
  rows: IcaRow[]
  /** The ATO lists newest first; a re-sorted export is oldest first. */
  printOrder: 'newest_first' | 'oldest_first'
  spreadsheet: SpreadsheetFigures | null
}

export const effectOf = (r: Pick<IcaRow, 'debit' | 'credit'>): Cents => r.debit - r.credit

export const aud = (c: Cents): string => {
  const abs = Math.abs(c)
  const s = `$${Math.floor(abs / 100).toLocaleString('en-AU')}.${String(abs % 100).padStart(2, '0')}`
  return c < 0 ? `-${s}` : s
}

/** A balance as the ATO prints it: "$1,234.56 DR" / "$1,234.56 CR". */
export const audBalance = (c: Cents): string => (c === 0 ? '$0.00' : `${aud(Math.abs(c))} ${c > 0 ? 'DR' : 'CR'}`)
