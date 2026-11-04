import { describe, expect, it } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import type { PrintedRow, PrintedStatement } from '../types'

/** One printed line across years when a report's section path differs above its own heading. Synthetic. */

const r = (path: string[], label: string, style: PrintedRow['style'], amount: number | null): PrintedRow => ({ page: 1, path, label, style, amounts: [amount], text: label })
const doc = (year: number, rows: PrintedRow[]): ComparisonDocument => {
  const st: PrintedStatement = {
    kind: 'balance_sheet',
    title: 'Balance Sheet',
    pages: [1],
    columns: [{ header: String(year), periodStart: null, periodEnd: `${year}-06-30`, kind: 'annual', financialYear: year }],
    rows,
    wholeDollars: true,
  }
  return { documentId: `fy${year}`, filename: `fy${year}.pdf`, uploadedAt: '', read: { status: 'read', pageCount: 1, issues: [], statements: [st] } }
}

describe('cross-year matching', () => {
  it('matches a line by its label and deepest heading when a parent heading is missing in one year', () => {
    const c = buildPrintedComparison([
      doc(2023, [r([], 'Non-Current Liabilities', 'heading', null), r(['Non-Current Liabilities'], "Beneficiaries' Accounts", 'line', 1001505)]),
      doc(2024, [
        r([], 'Liabilities', 'heading', null),
        r(['Liabilities'], 'Non-Current Liabilities', 'heading', null),
        r(['Liabilities', 'Non-Current Liabilities'], "Beneficiaries' Accounts", 'line', 952623),
      ]),
    ])
    const rows = c.tables[0].rows.filter((x) => x.label === "Beneficiaries' Accounts")
    expect(rows).toHaveLength(1)
    expect(rows[0].cells.map((x) => x.value)).toEqual([1001505, 952623])
    // The newer report's place in the structure.
    expect(rows[0].path).toEqual(['Liabilities', 'Non-Current Liabilities'])
  })

  it('keeps lines under different deepest headings apart', () => {
    const c = buildPrintedComparison([
      doc(2023, [r([], 'Current Liabilities', 'heading', null), r(['Current Liabilities'], 'Unexpired Interest', 'line', -10)]),
      doc(2024, [r([], 'Non-Current Liabilities', 'heading', null), r(['Non-Current Liabilities'], 'Unexpired Interest', 'line', -20)]),
    ])
    expect(c.tables[0].rows.filter((x) => x.label === 'Unexpired Interest')).toHaveLength(2)
  })
})
