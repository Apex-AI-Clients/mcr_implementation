import { describe, expect, it } from 'vitest'
import { filesNotInCoverage } from '../UnusedFilesList'
import type { FinancialFileRow } from '@/lib/financials/financialFiles'
import type { StatementCoverage } from '@/lib/financials/coverage'

/** Which files the coverage table cannot reach. Synthetic filenames only. */

const row = (documentId: string, usage: FinancialFileRow['usage']): FinancialFileRow => ({
  documentId,
  filename: `SYNTH_${documentId}.pdf`,
  annualYears: [],
  comparativeYears: [],
  currentPeriodYear: null,
  currentPeriodLabel: null,
  usage,
  note: '',
  override: null,
  overridePending: false,
})

const coverage: StatementCoverage = {
  columns: [{ key: 'fy2025', label: 'FY2025', financialYear: 2025, kind: 'annual', extra: false }],
  rows: {
    income_statement: [{ status: 'own', filename: 'SYNTH_a.pdf', documentId: 'a' }],
    balance_sheet: [{ status: 'comparative', filename: 'SYNTH_b.pdf', documentId: 'b' }],
  },
}

describe('filesNotInCoverage', () => {
  it('keeps only files no cell names, in their order', () => {
    const files = [row('a', 'used'), row('s', 'superseded'), row('b', 'used'), row('n', 'nothing_read'), row('t', 'not_financial')]
    expect(filesNotInCoverage(files, coverage).map((f) => f.documentId)).toEqual(['s', 'n', 't'])
  })

  it('lists every file when the table is empty', () => {
    const empty: StatementCoverage = { columns: [], rows: { income_statement: [], balance_sheet: [] } }
    expect(filesNotInCoverage([row('x', 'not_read')], empty)).toHaveLength(1)
  })
})
