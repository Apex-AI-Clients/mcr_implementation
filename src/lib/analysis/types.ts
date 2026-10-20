export type LodgementType =
  | 'Original'
  | 'ClientAmended'
  | 'ATOAmended'
  | 'SubLine'
  | 'GIC'
  | 'Payment'
  /**
   * A "Payment received" row that only shows how a payment above it was
   * allocated (no balance; same dates; it and its siblings add up to that
   * payment). Not money received: excluded from every payment count and total
   * (paymentAllocations.ts).
   */
  | 'PaymentAllocation'
  /** Money the ATO paid out to the company ("EFT refund for GST…", "Refund"): adds to the balance owing. */
  | 'Refund'
  /** An "EFT refund for…" row that only breaks down a "Refund" total above it (paymentAllocations.ts). */
  | 'RefundDetail'
  /** A GIC row (e.g. a remission) that only breaks down a "General interest charge" total above it. */
  | 'GICDetail'
  /**
   * A plain "General interest charge" row with a balance that only sums the
   * interest rows printed under it (amended GIC, remissions; same dates; the
   * same net to the cent). The rows under it are counted; this one is not.
   */
  | 'GICSummary'
  /** "Tax Office audit amended Activity Statement…": debt the ATO raised on audit, not lodged by the client. */
  | 'ATOAudit'
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
 * A single lodgement row that contributes to the DPN estimate: Original or
 * ClientAmended (as the late-lodgement setting counts them), filed more than
 * 90 calendar days past its statutory due date, with a positive debit.
 *
 * Credit-only amendments are NOT contributing debits; they can only reduce a
 * debit for the SAME period (computeDpnRisk).
 */
export interface DpnContributingDebit {
  rowIndex: number
  processedDate: string          // ISO
  effectiveDate: string          // ISO
  periodEnding: string | null    // ISO — display only
  description: string
  daysLate: number
  debit: number                  // gross amount that landed on the ATO ledger
  /** The same period's net downward amendments applied to this debit, capped at it. Never a payment. */
  reducedByAmendments: number
  netAtRisk: number              // max(debit - reducedByAmendments, 0)
}

export interface DpnRiskBreakdown {
  thresholdDays: 90
  /** Lodgements that added to ATO debt and were filed more than 90 days late. */
  contributingDebits: DpnContributingDebit[]
  /** Sum of `debit` across all contributingDebits. */
  totalGrossLate: number
  /** Sum of `reducedByAmendments` across all contributingDebits. */
  totalReducedByAmendments: number
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
  /** Activity statements the ATO amended on audit ("Tax Office audit amended…"). */
  auditDebits: number
  auditCredits: number
  auditNet: number
  /** Cash payments, allocation rows excluded (paymentAllocations.ts). */
  paymentsReceived: number
  /** How many payments that is. */
  paymentsCount: number
  /** First and last payment, by effective date (ISO yyyy-mm-dd); null without payments. */
  firstPaymentDate: string | null
  lastPaymentDate: string | null
  governmentCredits: number
  otherCredits: number
  /** Refunds the ATO paid to the company (debits less any reversals). They increase the balance owing. */
  refundsPaid: number
  /**
   * What was already owed before the export's first row (an export that starts
   * part-way through the account's history): the first printed balance less
   * what the rows up to it account for. 0 when the export starts from nothing.
   */
  openingBalance: number
  totalAtoDebt: number
  /** What the composition above adds up to: opening balance plus total debt and refunds, less payments and credits. Not floored. */
  composedBalance: number
  /** The ATO's own running balance on the newest row that prints one (icaPosition). Positive = owed. */
  atoBalance: number | null
  /** The date of that row (ISO yyyy-mm-dd). */
  atoBalanceDate: string | null
  /** atoBalance less composedBalance, when there is an ATO balance: what the composition does not explain. */
  unexplainedDifference: number | null
  /**
   * The balance owing the report shows: the ATO's printed balance, never
   * floored at $0 (a credit is negative). The composition is used only when
   * the rows carry no balance at all.
   */
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
