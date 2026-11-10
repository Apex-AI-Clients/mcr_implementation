/**
 * The as-printed read of a financial statements PDF: what the page prints,
 * read by code from the text layer, nothing calculated, renamed or invented.
 * See readStatements.ts for how a page becomes these rows.
 */

export type PrintedStatementKind = 'profit_and_loss' | 'balance_sheet'

/**
 * heading   a line with no figures that opens a section ("Current Assets")
 * line      a figure line inside a section
 * subtotal  the printed total that closes a section ("Total Current Assets")
 * total     a result line that closes no section ("Gross Profit", "Net Assets")
 * ratio     a printed percentage ("Gross Profit Margin 88%"): not an amount
 */
export type PrintedRowStyle = 'heading' | 'line' | 'subtotal' | 'total' | 'ratio'

export interface PrintedColumn {
  /** The column's header as printed ("2024", "30 JUNE 2024", "Total"). */
  header: string
  /** First day of the period; null for a balance sheet (a point in time). */
  periodStart: string | null
  /** ISO date the period ends (or the balance sheet date). */
  periodEnd: string
  /** 12 months ending 30 June: annual; anything shorter: the current period. */
  kind: 'annual' | 'current_period'
  /** The Australian financial year the period ends in (FY2024 = 1 Jul 2023 – 30 Jun 2024). */
  financialYear: number
}

/** One amount cell as printed: null for nil ("-" or blank), a string for a ratio ("88%"). */
export type PrintedAmount = number | string | null

export interface PrintedRow {
  page: number
  /** The open section headings, outermost first, as printed. */
  path: string[]
  /** The label as printed ("" when the line prints figures only). */
  label: string
  style: PrintedRowStyle
  /** One per column, in the document's column order. */
  amounts: PrintedAmount[]
  /** The whole printed line, for "where did this come from". */
  text: string
  /** A line read from a scanned page by Claude, per column (src/lib/scan). Absent on a text-layer page. */
  scan?: ScanRowInfo
}

/**
 * read      read by Claude from the scanned page: accepted as read
 * chosen    corrected by staff (scan_figure_choices): the figure typed in
 */
export type ScanCellStatus = 'read' | 'chosen'

export interface ScanCell {
  status: ScanCellStatus
  /** Claude's figure, as read from the page. */
  claude?: PrintedAmount
  /** Who corrected it, and when (status 'chosen'). */
  chosenBy?: string
  chosenAt?: string
}

export interface ScanRowInfo {
  /** Identifies the line for a staff choice: kind|page|path|label|n. */
  key: string
  /** Where the line sits on the page image, as fractions of its height (top, bottom), for the crop. */
  band: [number, number] | null
  cells: ScanCell[]
}

export interface ScanPageInfo {
  page: number
  /** No text layer and a full-page image. */
  scanned: boolean
  /** Scanned pages only: read as a statement, or skipped and why. */
  role?: 'statement' | 'skipped'
  /** The title the cheap first pass read ("Balance Sheet"), or why it was skipped. */
  note?: string
}

export interface ScanSummary {
  state: 'pending' | 'done' | 'failed'
  pages: ScanPageInfo[]
  /** Unused since Claude reads scans alone (always false); kept for reads stored before. */
  singleReading: boolean
  model: string | null
  message: string | null
}

export interface PrintedStatement {
  kind: PrintedStatementKind
  /** The title as printed ("Income Statement", "BALANCE SHEET"). */
  title: string
  pages: number[]
  /** In the document's order (often the current year first). */
  columns: PrintedColumn[]
  rows: PrintedRow[]
  /** Every figure printed with whole dollars only: totals then verify to rounding. */
  wholeDollars: boolean
}

/**
 * What the reader could not read, exactly where: the line or header that
 * needs support. A new layout is supported by a small change plus an
 * expected file; these say which change.
 */
export interface ReadIssue {
  kind:
    | 'no_text_layer'
    | 'no_statements'
    | 'no_column_header'
    | 'unknown_period'
    | 'unplaced_cell'
    | 'unparsed_amount'
    | 'unreadable_file'
  page: number | null
  /** The printed line or header, verbatim. */
  text: string | null
  message: string
}

export interface PrintedRead {
  /**
   * 'failed': the file could not be downloaded or opened (store.ts).
   * 'scan_pending': it has scanned pages being read in the background (src/lib/scan).
   */
  status: 'read' | 'no_text_layer' | 'no_statements' | 'failed' | 'scan_pending'
  pageCount: number
  statements: PrintedStatement[]
  issues: ReadIssue[]
  /** Set when the PDF has scanned pages. */
  scan?: ScanSummary
}

export const NO_TEXT_LAYER_MESSAGE =
  'This PDF has no readable text. Please ask the accountant for the PDF exported from their accounting software.'
