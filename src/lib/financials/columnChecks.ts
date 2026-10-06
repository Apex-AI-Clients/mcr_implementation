import { hasRealBalanceSheet, hasRealIncomeStatement } from './halves'
import type { ResolvedYears } from './resolveYear'
import type {
  ExtractionWarning,
  FinancialDocumentKind,
  FinancialStatementSourceColumn,
  StatementHalfKey,
} from './types'

/**
 * Cross-checks between what the model returned for one column and what our
 * own text pre-pass found. Pure.
 */

/** What the pre-pass says a document of this kind must, or must not, hold. */
function expected(kind: FinancialDocumentKind, half: StatementHalfKey): boolean | null {
  switch (kind) {
    case 'combined':
      return true
    case 'pnl_only':
      return half === 'income_statement'
    case 'bs_only':
      return half === 'balance_sheet'
    default:
      return null
  }
}

const LABEL: Record<StatementHalfKey, string> = {
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
}

/**
 * Is this half really in this column?
 *
 *   - The pre-pass says the document has no such statement: never, even if
 *     the model returned figures (they came from somewhere else — a tax
 *     return or a note).
 *   - The pre-pass says it has one: whenever real figures came back. A model
 *     flag of false is overruled by real figures; real-less is a warning.
 *   - The pre-pass could not tell: the model's flag, and only with real figures.
 */
export function decidePresence(input: {
  half: StatementHalfKey
  modelSaysPresent: boolean | undefined
  data: unknown
  kind: FinancialDocumentKind
  financialYear: number
  sourceColumn: FinancialStatementSourceColumn
}): { present: boolean; warning: ExtractionWarning | null } {
  const { half, modelSaysPresent, data, kind, financialYear, sourceColumn } = input
  const real = half === 'income_statement' ? hasRealIncomeStatement(data) : hasRealBalanceSheet(data)
  const want = expected(kind, half)
  const where = `FY${financialYear} ${sourceColumn}`
  const section = half === 'income_statement' ? 'incomeStatement' : 'balanceSheet'

  if (want === false) {
    return {
      present: false,
      warning: real
        ? {
            kind: 'presence_mismatch',
            section,
            message: `${LABEL[half]} figures were returned for ${where}, but this document has no ${LABEL[half]}. They were ignored.`,
          }
        : null,
    }
  }
  if (want === true) {
    return {
      present: real,
      warning: real
        ? null
        : {
            kind: 'presence_mismatch',
            section,
            message: `The ${LABEL[half]} for ${where} was expected in this document but no figures were read.`,
          },
    }
  }
  return { present: real && modelSaysPresent !== false, warning: null }
}

/**
 * The financial year to store for a column. Headings decide: when they name
 * exactly one annual year, a primary column must be that year, and a
 * comparative the year before. A disagreement is corrected and reported.
 */
export function correctYear(input: {
  modelYear: number
  sourceColumn: FinancialStatementSourceColumn
  years: ResolvedYears
}): { financialYear: number; warning: ExtractionWarning | null } {
  const { modelYear, sourceColumn, years } = input
  if (years.source !== 'heading') return { financialYear: modelYear, warning: null }

  let want: number | null = null
  if (sourceColumn === 'current_period') want = years.currentPeriodYear
  else if (years.annualYears.length === 1) {
    want = sourceColumn === 'primary' ? years.annualYears[0] : years.annualYears[0] - 1
  }
  if (want === null || want === modelYear) return { financialYear: modelYear, warning: null }

  return {
    financialYear: want,
    warning: {
      kind: 'year_mismatch',
      message: `The model read the ${sourceColumn} column as FY${modelYear}, but the statement headings say FY${want}. Stored as FY${want}.`,
    },
  }
}
