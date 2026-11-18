import { describe, expect, it } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import { suggestMapping } from '../dictionary'
import { headlineCsv, headlineRows, HEADLINE_ROWS } from '../headline'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'

/** The comparison page's headline figures and their CSV. Synthetic reports only. */

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })
const bs = (rows: PrintedRow[]): PrintedStatement => ({ kind: 'balance_sheet', title: 'Balance Sheet', pages: [1], columns: [fy(2025), fy(2024)], rows, wholeDollars: true })
const doc: ComparisonDocument = {
  documentId: 'fy25',
  filename: 'fy25.pdf',
  uploadedAt: '',
  read: {
    status: 'read',
    pageCount: 1,
    issues: [],
    statements: [
      bs([
        r([], 'Assets', 'heading', null, null),
        r(['Assets', 'Current Assets'], 'Cash', 'line', 100, 80),
        r(['Assets', 'Current Assets'], 'Total Current Assets', 'subtotal', 100, 80),
        r(['Assets'], 'Total Assets', 'subtotal', 100, 80),
      ]),
    ],
  },
}

describe('headline figures', () => {
  it('are the eight rows, in order, and the CSV writes only them, as shown', () => {
    const c = buildPrintedComparison([doc], { comparativeYears: true })
    const rows = headlineRows(c, [], suggestMapping(c), { status: 'held', cells: [] })
    expect(rows.map((x) => x.label)).toEqual(HEADLINE_ROWS.map((x) => x.label))
    const csv = headlineCsv({ clientName: 'Example', comparison: c, rows }).split('\r\n')
    expect(csv[3]).toBe('Figure,FY2024 (1 Jul 2023 – 30 Jun 2024),FY2025 (1 Jul 2024 – 30 Jun 2025),Note')
    expect(csv).toContain('Total assets,80,100,"Suggested line, not confirmed yet"')
    expect(csv).toContain('ATO related debt – ICA,Being prepared,Being prepared,')
    expect(csv).toContain('Net profit,,,No printed line matched')
    expect(csv.join('\n')).not.toMatch(/Cash/)
  })
})
