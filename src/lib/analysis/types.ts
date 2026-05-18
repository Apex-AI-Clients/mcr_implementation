export type LodgementType =
  | 'Original'
  | 'ClientAmended'
  | 'ATOAmended'
  | 'SubLine'
  | 'GIC'
  | 'Payment'
  | 'FTLPenalty'
  | 'GeneralPenalty'
  | 'CreditTransfer'
  | 'GovernmentCredit'
  | 'Other'

export interface ParsedRow {
  rowIndex: number
  processedDate: Date | null
  effectiveDate: Date | null
  rawProcessed: string
  rawEffective: string
  description: string
  debit: number | null
  credit: number | null
  balance: number | null
  periodEnding: Date | null
}

export interface ParsedCsv {
  statementLabel: string
  companyName: string
  rows: ParsedRow[]
}

export interface EnrichedRow extends ParsedRow {
  lodgementType: LodgementType
  lateLodgementDays: number
  lateLodgeDaysCleaned: number
}

export interface AnalysisWarning {
  rowIndex: number
  reason: 'unparseable_processed_date' | 'unparseable_effective_date' | 'missing_dates_on_lodgement'
  rawProcessed: string
  rawEffective: string
  description: string
}

/**
 * A single lodgement row that contributes to DPN risk: Original or ClientAmended,
 * filed more than 90 calendar days past its statutory due date, with a positive
 * debit (the lodgement actually added to ATO debt).
 *
 * Credit-only amendments (e.g. ClientAmended with credit > 0 and no debit) are
 * NOT contributing debits — they aren't a personal-liability event.
 */
export interface DpnContributingDebit {
  rowIndex: number
  processedDate: string          // ISO
  effectiveDate: string          // ISO
  periodEnding: string | null    // ISO — display only
  description: string
  daysLate: number
  debit: number                  // gross amount that landed on the ATO ledger
  paymentsSinceLodged: number    // sum of cash payments processed on/after processedDate, CAPPED at debit
  netAtRisk: number              // max(debit - paymentsSinceLodged, 0)
}

export interface DpnRiskBreakdown {
  thresholdDays: 90
  /** Lodgements that added to ATO debt and were filed more than 90 days late. */
  contributingDebits: DpnContributingDebit[]
  /** Sum of `debit` across all contributingDebits. */
  totalGrossLate: number
  /** Sum of `paymentsSinceLodged` across all contributingDebits. */
  totalPaidSince: number
  /** Sum of `netAtRisk` across all contributingDebits. */
  totalNetAtRisk: number
  /** Earliest processedDate across ALL CSV rows (display only). */
  periodStart: string | null
  /** Latest processedDate across ALL CSV rows (display only). */
  periodEnd: string | null
}

export interface DebtBreakdown {
  principalDebits: number
  principalCredits: number
  principalNet: number
  interestDebits: number
  interestCredits: number
  interestNet: number
  penaltyDebits: number
  penaltyCredits: number
  penaltyNet: number
  paymentsReceived: number
  governmentCredits: number
  otherCredits: number
  totalAtoDebt: number
  currentBalance: number
}

export interface LodgementAnalysisResult {
  summary: {
    numberOfLateLodgements: number
    cumulativeDaysLate: number
  }
  dpnRisk: DpnRiskBreakdown
  debtBreakdown: DebtBreakdown
  rows: EnrichedRow[]
  warnings: AnalysisWarning[]
}

/** Shape returned from the API route and stored in initialAnalysis on the page. */
export interface LodgementAnalysisPayload {
  id: string
  clientId: string
  documentId: string
  sourceFilename: string
  statementLabel: string | null
  companyNameInCsv: string | null
  rowCount: number
  summary: {
    numberOfLateLodgements: number
    cumulativeDaysLate: number
  }
  dpnRisk: DpnRiskBreakdown | null
  debtBreakdown: DebtBreakdown | null
  aiSummary: string | null
  aiSummaryGeneratedAt: string | null
  rows: EnrichedRow[]
  warnings: AnalysisWarning[]
  analysedAt: string
}
