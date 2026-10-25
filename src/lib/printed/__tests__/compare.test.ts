import { describe, it, expect } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import { comparisonCsv, formatPrinted } from '../csv'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'

/** The as-printed comparison. Synthetic reports only. */

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: `${label} ${amounts.join(' ')}` })
const bs = (cols: PrintedColumn[], rows: PrintedRow[]): PrintedStatement => ({ kind: 'balance_sheet', title: 'Balance Sheet', pages: [1], columns: cols, rows, wholeDollars: true })
const doc = (id: string, uploadedAt: string, ...statements: PrintedStatement[]): ComparisonDocument => ({
  documentId: id,
  filename: `${id}.pdf`,
  uploadedAt,
  read: { status: 'read', pageCount: 1, statements, issues: [] },
})

/** FY2024 report, then the FY2025 report restating FY2024 (a loan moved, totals changed). */
function reports() {
  const fy24 = doc(
    'fy24',
    '2026-01-01',
    bs([fy(2024), fy(2023)], [
      r([], 'Assets', 'heading', null, null),
      r(['Assets'], 'Cash', 'line', 100, 90),
      r(['Assets'], 'Old line', 'line', 5, 5),
      r(['Assets'], 'Total Assets', 'subtotal', 105, 95),
    ]),
  )
  const fy25 = doc(
    'fy25',
    '2026-02-01',
    bs([fy(2025), fy(2024)], [
      r([], 'Assets', 'heading', null, null),
      r(['Assets'], 'Cash', 'line', 120, 100),
      r(['Assets'], 'Loan - Director', 'line', 30, 20),
      r(['Assets'], 'Total Assets', 'subtotal', 150, 120),
    ]),
  )
  return [fy25, fy24]
}

/** FY2023 is printed only as the FY2024 report's comparative: shown on request. */
const EARLIER = { comparativeYears: true }

describe('buildPrintedComparison', () => {
  it('shows only years with a report of their own by default, naming the years left out', () => {
    const c = buildPrintedComparison(reports())
    expect(c.columns.map((col) => col.key)).toEqual(['FY2024', 'FY2025'])
    expect(c.hiddenComparativeYears).toEqual([2023])
    expect(buildPrintedComparison(reports(), EARLIER).hiddenComparativeYears).toEqual([])
  })

  it('orders the years, oldest first, and takes each from its own report', () => {
    const c = buildPrintedComparison(reports(), EARLIER)
    expect(c.columns.map((col) => col.key)).toEqual(['FY2023', 'FY2024', 'FY2025'])
    const [table] = c.tables
    const total = table.rows.find((x) => x.label === 'Total Assets')!
    expect(total.cells.map((cl) => cl.value)).toEqual([95, 105, 150])
    expect(total.cells.map((cl) => cl.source?.documentId)).toEqual(['fy24', 'fy24', 'fy25'])
  })

  it('keeps the latest report order, with lines only an earlier year prints after the line they follow, nothing dropped', () => {
    const [table] = buildPrintedComparison(reports(), EARLIER).tables
    expect(table.rows.map((x) => x.label)).toEqual(['Assets', 'Cash', 'Old line', 'Loan - Director', 'Total Assets'])
    const loan = table.rows.find((x) => x.label === 'Loan - Director')!
    // FY2024's own report does not print it: blank, never a number from elsewhere.
    expect(loan.cells.map((cl) => (cl.printed ? cl.value : 'blank'))).toEqual(['blank', 'blank', 30])
  })

  it('shows the own report figure, noting what a later report prints instead', () => {
    const [table] = buildPrintedComparison(reports(), EARLIER).tables
    const total = table.rows.find((x) => x.label === 'Total Assets')!
    expect(total.cells[1].restated).toEqual([expect.objectContaining({ value: 120, report: 'the FY2025 report' })])
    const loan = table.rows.find((x) => x.label === 'Loan - Director')!
    expect(loan.cells[1].restated).toEqual([expect.objectContaining({ value: 20 })])
    // Agreeing comparatives are not notes.
    expect(table.rows.find((x) => x.label === 'Cash')!.cells[1].restated).toEqual([])
  })

  it('reports a printed total that does not add up as a hard check, on its cell', () => {
    const bad = doc('bad', '2026-03-01', bs([fy(2026)], [r([], 'Assets', 'heading', null), r(['Assets'], 'Cash', 'line', 10), r(['Assets'], 'Total Assets', 'subtotal', 15)]))
    const c = buildPrintedComparison([...reports(), bad], EARLIER)
    expect(c.failures).toEqual([expect.objectContaining({ kind: 'totals_reconciliation', column: 'FY2026', documentId: 'bad' })])
    const total = c.tables[0].rows.find((x) => x.label === 'Total Assets')!
    expect(total.cells.at(-1)!.check).toBe('mismatch')
  })

  it('tells staff why a file is not used or not read', () => {
    const scan: ComparisonDocument = { documentId: 'scan', filename: 'scan.pdf', uploadedAt: '', read: { status: 'no_text_layer', pageCount: 3, statements: [], issues: [] } }
    const c = buildPrintedComparison([...reports(), scan], EARLIER)
    expect(c.documents.find((d) => d.documentId === 'scan')?.message).toBe(
      'This PDF has no readable text. Please ask the accountant for the PDF exported from their accounting software.',
    )
  })
})

describe('comparisonCsv', () => {
  it('writes every figure as printed, blanks for lines not printed, notes, and the reviewer', () => {
    const csv = comparisonCsv({ clientName: 'Example Pty Ltd', comparison: buildPrintedComparison(reports(), EARLIER), reviewedBy: null })
    expect(csv).toContain('Line,FY2023 (1 Jul 2022 – 30 Jun 2023),FY2024 (1 Jul 2023 – 30 Jun 2024),FY2025 (1 Jul 2024 – 30 Jun 2025),Notes')
    expect(csv).toContain('  Loan - Director,,,30,FY2024: restated in FY2025 report: 20')
    expect(formatPrinted(-1234.5)).toBe('(1,234.50)')
    expect(formatPrinted(null)).toBe('-')
  })
})
