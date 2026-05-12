export type LodgementType =
  | 'Original'
  | 'ClientAmended'
  | 'ATOAmended'
  | 'SubLine'
  | 'GIC'
  | 'Payment'
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

export interface LodgementAnalysisResult {
  summary: {
    numberOfLateLodgements: number
    cumulativeDaysLate: number
  }
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
  rows: EnrichedRow[]
  warnings: AnalysisWarning[]
  analysedAt: string
}
