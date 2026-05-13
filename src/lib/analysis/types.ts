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
 * A single row that qualifies for DPN risk: Original or ClientAmended,
 * filed more than 90 calendar days past the effective date.
 * Both debit rows (gross liability) and credit rows (reversals) are included.
 */
export interface DpnContributingRow {
  rowIndex: number
  processedDate: string
  effectiveDate: string
  periodEnding: string | null
  description: string
  daysLate: number
  debit: number
  credit: number
}

export interface DpnRiskBreakdown {
  thresholdDays: 90
  contributingRows: DpnContributingRow[]
  totalGrossLate: number
  totalReversed: number
  totalNetAtRisk: number
  /** Earliest processedDate across ALL CSV rows (not just contributing rows) */
  periodStart: string | null
  /** Latest processedDate across ALL CSV rows (not just contributing rows) */
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
