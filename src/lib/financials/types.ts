/** A statement half: the profit and loss (income statement) or the balance sheet. */
export type StatementHalfKey = 'income_statement' | 'balance_sheet'

/** A check over the comparison (printed/review.ts), shown on the comparison page. */
export type FinancialCheckKind =
  | 'totals_reconciliation'
  | 'balance_sheet_equation'
  | 'retained_earnings_rollforward'
  | 'restatement'
  | 'entity_mismatch'
  | 'not_statements'
  | 'extraction_note'
  | 'mapping_consistency'

export interface FinancialCheck {
  kind: FinancialCheckKind
  /** 'warning' needs a look; 'info' explains something that is probably fine. */
  severity: 'warning' | 'info'
  /** Null for a check about a document as a whole. */
  financialYear: number | null
  /** The statement it concerns, when it concerns one. */
  statement: StatementHalfKey | null
  /** It concerns the current-period statement rather than an annual one. */
  currentPeriod?: boolean
  message: string
  /** The documents involved, for linking to the file. */
  documentIds: string[]
  /** Notes of one sort collapse into one line. */
  group?: string
  /** The items behind a summary, shown collapsed. */
  details?: string[]
}
