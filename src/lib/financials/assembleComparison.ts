import {
  applyYearWindow,
  runChecks,
  type CompanyDetailsForCheck,
  type DocumentRecordForCheck,
} from './checks'
import { computeFinancialsComparison } from './computeComparison'
import { correctProfit } from './lineCorrections'
import { harmoniseMappings } from './mappingConsistency'
import { mergeAnnualYears, mergeCurrentPeriod, type MergedStatement } from './statementSelection'
import type { ExtractedFinancialStatement, FinancialCheck, FinancialsComparison, StoredStatementSlot } from './types'

/**
 * Stored statements -> the comparison, with every correction applied BEFORE
 * any figure is computed — so the comparison, its checks and the AI summary
 * built from it only ever see corrected figures. Pure; the caller loads the
 * inputs and persists the result.
 *
 *   1. One mapping across all of the client's files (mappingConsistency.ts).
 *   2. Each year's halves merged (the year's own file first).
 *   3. The profit rule on every statement: a trust, or a statement with no
 *      income tax line, has net profit after tax = profit before tax. This
 *      also corrects statements extracted before the rule existed.
 *   4. The latest four annual years compared; older ones reported as extra.
 */

export type AssembledComparison =
  | { ok: true; comparison: FinancialsComparison; statementCount: number }
  | { ok: false; statementCount: number }

const TRUSTEE = /\b(atf|a\.t\.f\.?|as trustee for)\b/i

export function entityIsTrust(company: CompanyDetailsForCheck | null, records: DocumentRecordForCheck[]): boolean {
  return company?.entityType === 'trust' || records.some((r) => TRUSTEE.test(r.headingEntity?.name ?? ''))
}

function profitChecks(merged: MergedStatement[], isTrust: boolean, currentPeriod = false): FinancialCheck[] {
  const out: FinancialCheck[] = []
  for (const m of merged) {
    const s = m.statement
    const notes = correctProfit(s, s.incomeStatement.lines ?? [], { isTrust })
    for (const note of notes) {
      out.push({
        kind: 'extraction_note',
        severity: 'info',
        financialYear: s.financialYear,
        statement: 'income_statement',
        ...(currentPeriod ? { currentPeriod: true } : {}),
        message: note.message,
        documentIds: m.sources.income_statement?.documentId ? [m.sources.income_statement.documentId] : [],
      })
    }
  }
  return out
}

export function assembleComparison(input: {
  slots: StoredStatementSlot[]
  records: DocumentRecordForCheck[]
  company: CompanyDetailsForCheck | null
}): AssembledComparison {
  const { slots, records, company } = input
  const isTrust = entityIsTrust(company, records)

  const mappingChecks = harmoniseMappings(slots, { isTrust, directors: company?.directors ?? [] })
  const annual = mergeAnnualYears(slots)
  const current = mergeCurrentPeriod(slots)
  const corrections = [
    ...profitChecks(annual, isTrust),
    ...(current ? profitChecks([current], isTrust, true) : []),
  ]

  const { used, extraYears } = applyYearWindow(annual)
  const statements: ExtractedFinancialStatement[] = [
    ...used.map((m) => m.statement),
    ...(current ? [current.statement] : []),
  ]
  if (statements.length < 2) return { ok: false, statementCount: statements.length }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const equityByYear: NonNullable<FinancialsComparison['equityByYear']> = {}
  for (const m of used) {
    const s = m.statement
    equityByYear[s.financialYear] = {
      retainedEarnings: m.sources.balance_sheet ? num(s.balanceSheet.equity?.retainedEarnings) : null,
      distributions: num(s.incomeStatement.appropriations?.distributions),
      dividends: num(s.incomeStatement.appropriations?.dividends),
    }
  }

  const comparison: FinancialsComparison = {
    ...computeFinancialsComparison(statements),
    extraYears,
    equityByYear,
    checks: runChecks({
      slots,
      allAnnual: annual,
      used,
      current,
      records,
      company,
      extra: [...mappingChecks, ...corrections],
    }),
  }
  return { ok: true, comparison, statementCount: statements.length }
}
