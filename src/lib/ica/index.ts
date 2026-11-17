import { compose, type Composition } from './compose'
import { lateLodgements, statementsLodgedLate, type LateLodgements, type LateStatement } from './lateLodgement'
import type { LearnedPattern } from './learned'
import { reconcile, type Reconciliation } from './reconcile'
import type { IcaFile, SpreadsheetFigures } from './types'

/**
 * The ATO account (ICA) analysis: read (read.ts) → structures and the ATO's
 * running balance (reconcile.ts) → composition (compose.ts). Pure; the one
 * step that calls Claude, for a window no known rule matches, is propose.ts.
 *
 * Only a VERIFIED analysis gives calculated figures: every balance window
 * matched, the whole file reconciles to the ATO's balance on its newest row,
 * and, when an RBA ICA spreadsheet is given, its late lodgements (H3/H4) are
 * the same as ours. Otherwise the rows are shown as printed and the totals
 * are held back. Late lodgements depend on dates only and are given whenever
 * every date reads.
 */

export interface SpreadsheetCheck {
  spreadsheet: SpreadsheetFigures
  ours: { lateLodgements: number | null; cumulativeDaysLate: number | null }
  matches: boolean
}

export interface IcaAnalysis {
  file: IcaFile
  reconciliation: Reconciliation
  /** Held back (null) unless verified. */
  composition: Composition | null
  lateLodgements: LateLodgements
  /** Held back (null) unless verified: their amounts are calculated. */
  lodgedOver90DaysLate: LateStatement[] | null
  spreadsheetCheck: SpreadsheetCheck | null
  verified: boolean
  /** Why it is not verified, in plain words, for staff and the developer alert. */
  holdReasons: string[]
}

export interface AnalyseOptions {
  patterns?: readonly LearnedPattern[]
  /** Accepted Claude readings (row id → counted). */
  forced?: ReadonlyMap<number, boolean>
  /** An RBA ICA spreadsheet's H3/H4 for the same account, uploaded beside the CSV. */
  spreadsheet?: SpreadsheetFigures | null
}

export function analyseIca(file: IcaFile, options: AnalyseOptions = {}): IcaAnalysis {
  const reconciliation = reconcile(file, { patterns: options.patterns, forced: options.forced })
  const late = lateLodgements(file)
  const sheet = options.spreadsheet ?? file.spreadsheet
  const spreadsheetCheck: SpreadsheetCheck | null = sheet
    ? {
        spreadsheet: sheet,
        ours: { lateLodgements: late.count, cumulativeDaysLate: late.cumulativeDays },
        matches: late.count === sheet.lateLodgements && late.cumulativeDays === sheet.cumulativeDaysLate,
      }
    : null

  const holdReasons: string[] = []
  if (reconciliation.unreadDateRows > 0) holdReasons.push(`${reconciliation.unreadDateRows} row(s) with a date that cannot be read`)
  if (reconciliation.atoBalance === null) holdReasons.push('The file prints no balance')
  if (reconciliation.unmatched.length > 0) holdReasons.push(`${reconciliation.unmatched.length} window(s) that do not match the ATO's balance change`)
  if (reconciliation.unmatched.length === 0 && reconciliation.atoBalance !== null && reconciliation.composed !== reconciliation.atoBalance) {
    holdReasons.push("The rows do not add up to the ATO's balance on its newest row")
  }
  if (spreadsheetCheck && !spreadsheetCheck.matches) holdReasons.push('The late lodgements differ from the RBA ICA spreadsheet (H3/H4)')

  const verified = reconciliation.verified && (!spreadsheetCheck || spreadsheetCheck.matches)
  return {
    file,
    reconciliation,
    composition: verified ? compose(file, reconciliation) : null,
    lateLodgements: late,
    lodgedOver90DaysLate: verified ? statementsLodgedLate(file, reconciliation, 90) : null,
    spreadsheetCheck,
    verified,
    holdReasons,
  }
}

export { readIcaCsv, readIcaXlsx, readIcaFile, readStoredRows, IcaReadError } from './read'
export type { IcaFile, IcaRow, Cents, SpreadsheetFigures } from './types'
export type { Composition, CompositionLine } from './compose'
export type { Reconciliation, MatchedWindow, UnmatchedWindow } from './reconcile'
