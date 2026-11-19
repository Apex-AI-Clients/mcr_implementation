import { describe, expect, it } from 'vitest'
import type { ComparisonDocument, PrintedComparison } from '@/lib/printed/compare'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '@/lib/printed/types'
import { bankDifferences, documentYearFigures, noticeBankFigures, provenYearsByDocument } from '../figures'
import { maskLine } from '../../../../scripts/proof/bank'

/** The test bank's figures. Synthetic files only. */

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })
const pl = (sales: number, wages: number): PrintedStatement => ({
  kind: 'profit_and_loss',
  title: 'Profit and Loss',
  pages: [1],
  columns: [fy(2025), fy(2024)],
  rows: [r(['Income'], 'Sales', 'line', sales, 400), r(['Expenses'], 'Wages', 'line', wages, 350), r([], 'Net Profit', 'total', sales - wages, 50)],
  wholeDollars: true,
})
const doc = (statement: PrintedStatement): ComparisonDocument => ({
  documentId: 'fs25',
  filename: 'fs25.pdf',
  uploadedAt: '2026-11-01',
  read: { status: 'read', pageCount: 1, issues: [], statements: [statement] },
})

describe('the test bank', () => {
  it("a notice's figures: type, date and rows in cents, nothing that names anyone", () => {
    const f = noticeBankFigures({
      type: 'gst',
      issuedOn: '2026-09-30',
      rows: [{ periodFrom: '2025-07-01', periodTo: '2025-09-30', column2: 100_00, column3: 100_00, column4: 60_00, column5: 40_00 }],
      totals: null,
    })
    expect(f).toEqual({ type: 'gst', issuedOn: '2026-09-30', rows: [{ periodFrom: '2025-07-01', periodTo: '2025-09-30', column2: 10000, column3: 10000, column4: 6000, column5: 4000 }], totals: null })
  })

  it("a statement's figures for the year it proved, from that file alone", () => {
    const f = documentYearFigures(doc(pl(500, 300)), ['FY2025'])
    expect(Object.keys(f.years)).toEqual(['FY2025'])
    expect(Object.values(f.years.FY2025)).toEqual([500, 300, 200])
  })

  it('the same file read the same way: no difference; a changed figure is named with both values', () => {
    const banked = documentYearFigures(doc(pl(500, 300)), ['FY2025'])
    expect(bankDifferences(banked, documentYearFigures(doc(pl(500, 300)), ['FY2025']))).toEqual([])
    const changed = bankDifferences(banked, documentYearFigures(doc(pl(500, 310)), ['FY2025']))
    expect(changed).toHaveLength(2) // Wages and Net Profit
    expect(changed.join('\n')).toMatch(/banked 300, now 310/)
  })

  it('a line missing now, or new now, is a difference too; so is a notice row', () => {
    expect(bankDifferences({ a: 1 }, {})).toEqual(['a: banked 1, now missing'])
    expect(bankDifferences({}, { a: 1 })).toEqual(['a: not banked, now 1'])
    expect(bankDifferences({ rows: [{ column2: 1 }] }, { rows: [] })).toEqual(['rows: 1 banked, 0 now'])
  })

  it('only proven years from a single file are banked', () => {
    const cell = (documentId: string) => ({ printed: true, value: 1, source: { documentId, filename: 'x', page: 1, text: 'x', header: 'x' }, restated: [], check: null })
    const comparison = {
      columns: [
        { key: 'FY2024', kind: 'annual', financialYear: 2024, periodStart: '2023-07-01', periodEnd: '2024-06-30' },
        { key: 'FY2025', kind: 'annual', financialYear: 2025, periodStart: '2024-07-01', periodEnd: '2025-06-30' },
      ],
      tables: [{ kind: 'profit_and_loss', title: 'P&L', rows: [{ key: 'k', path: [], label: 'x', style: 'line', cells: [cell('a'), { ...cell('b'), scan: { status: 'disagree', claude: 1, ocr: 2, key: 'k', documentId: 'b', page: 1, band: null, column: 0 } }] }] }],
      failures: [],
      documents: [],
      annualYears: 2,
      hiddenComparativeYears: [],
    } as unknown as PrintedComparison
    expect([...provenYearsByDocument(comparison)]).toEqual([['a', ['FY2024']]])
  })

  it('the check prints a line as a hash, never its label', () => {
    expect(maskLine('years.FY2025.profit_and_loss|Expenses/Wages to J Smith: banked 300, now 310')).toMatch(/^years\.FY2025\.profit_and_loss\|line#[0-9a-f]{8}: banked 300, now 310$/)
  })
})
