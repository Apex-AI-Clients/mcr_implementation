import { describe, it, expect } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument, type SourceChoice } from '../compare'
import type { PrintedColumn, PrintedRead, PrintedStatement, PrintedStatementKind } from '../types'
import { checkSourceChoice, SourceChoiceError } from '../sourceChoices'

/**
 * Which file each period comes from (Gabby, 25 Nov 2026): own annual statements, then an export's
 * column, then later annual statements' prior-year column; the latest upload within a rank; the
 * newest current period; staff choices. Synthetic reads only.
 */

const annual = (fy: number, header = String(fy)): PrintedColumn => ({ header, periodStart: `${fy - 1}-07-01`, periodEnd: `${fy}-06-30`, kind: 'annual', financialYear: fy })
const current = (end: string, header = end): PrintedColumn => ({ header, periodStart: '2026-07-01', periodEnd: end, kind: 'current_period', financialYear: 2027 })

/** A statement printing `profit` (P&L "Net Profit") or `assets` (BS "Total Assets") per column. */
function statement(kind: PrintedStatementKind, columns: PrintedColumn[], figures: number[]): PrintedStatement {
  const label = kind === 'profit_and_loss' ? 'Net Profit' : 'Total Assets'
  return {
    kind,
    title: kind === 'profit_and_loss' ? 'Profit and Loss' : 'Balance Sheet',
    pages: [1],
    columns,
    rows: [{ page: 1, path: [], label, style: 'total', amounts: figures, text: `${label} ${figures.join(' ')}` }],
    wholeDollars: false,
  }
}

function doc(id: string, uploadedAt: string, kind: 'export' | 'annual_statements', ...statements: PrintedStatement[]): ComparisonDocument {
  const read: PrintedRead = { status: 'read', pageCount: 1, statements, issues: [], report: { kind, markers: kind === 'export' ? [] : ['Contents page (page 1)'] } }
  return { documentId: id, filename: `${id}.pdf`, uploadedAt, read }
}

const FIVE = [2026, 2025, 2024, 2023, 2022].map((y) => annual(y))
const plFive = () => statement('profit_and_loss', FIVE, [-53586.4, 172799.9, 88331.14, 85194.01, 131797.62])
const bsFive = () => statement('balance_sheet', FIVE.map((c) => ({ ...c, periodStart: null, header: `30 JUNE ${c.financialYear}` })), [116971.75, 238246.94, 148328.33, 65433.7, 56150.16])
const plCurrent = (end = '2026-11-16') => statement('profit_and_loss', [current(end)], [31276.54])
const bsCurrent = (end = '2026-11-16') => statement('balance_sheet', [{ ...current(end), periodStart: null }], [116544.65])

const figure = (c: ReturnType<typeof buildPrintedComparison>, kind: PrintedStatementKind, key: string) => {
  const i = c.columns.findIndex((col) => col.key === key)
  return c.tables.find((t) => t.kind === kind)!.rows[0].cells[i]
}
const sourceOf = (c: ReturnType<typeof buildPrintedComparison>, key: string, kind: PrintedStatementKind) =>
  c.periodSources.find((p) => p.column === key)!.statements.find((s) => s.statement === kind)!

describe('sources: which file each period comes from', () => {
  it('all four exports: five years from the multi-year exports, then the current period', () => {
    const c = buildPrintedComparison([
      doc('pl5', '2026-11-20', 'export', plFive()),
      doc('bs5', '2026-11-20', 'export', bsFive()),
      doc('plc', '2026-11-20', 'export', plCurrent()),
      doc('bsc', '2026-11-20', 'export', bsCurrent()),
    ])
    expect(c.columns.map((col) => col.key)).toEqual(['FY2022', 'FY2023', 'FY2024', 'FY2025', 'FY2026', 'current'])
    expect(figure(c, 'profit_and_loss', 'FY2025').value).toBe(172799.9)
    expect(figure(c, 'balance_sheet', 'current').value).toBe(116544.65)
    expect(sourceOf(c, 'FY2023', 'profit_and_loss').source).toMatchObject({ documentId: 'pl5', kind: 'export', label: 'Multi-year export (2026–2022)', header: '2023' })
    expect(sourceOf(c, 'current', 'balance_sheet').source).toMatchObject({ documentId: 'bsc', kind: 'current_period', label: 'Current-period report (export)' })
    expect(c.periodSources.every((p) => p.endsDiffer === null && p.statements.every((s) => s.alsoIn.length === 0))).toBe(true)
  })

  it('only the two comparatives: five years, no current period', () => {
    const c = buildPrintedComparison([doc('pl5', '2026-11-20', 'export', plFive()), doc('bs5', '2026-11-20', 'export', bsFive())])
    expect(c.columns.map((col) => col.key)).toEqual(['FY2022', 'FY2023', 'FY2024', 'FY2025', 'FY2026'])
    expect(c.hiddenComparativeYears).toEqual([])
  })

  it('profit and loss and balance sheet in one PDF: both statements from it', () => {
    const c = buildPrintedComparison([doc('both', '2026-11-20', 'export', plFive(), bsFive())])
    expect(sourceOf(c, 'FY2024', 'profit_and_loss').source?.documentId).toBe('both')
    expect(sourceOf(c, 'FY2024', 'balance_sheet').source?.documentId).toBe('both')
  })

  it("the year's own annual statements before an export's column: same figures", () => {
    const fy26 = doc('fs26', '2026-10-01', 'annual_statements', statement('profit_and_loss', [annual(2026), annual(2025)], [-53586.4, 172799.9]))
    const c = buildPrintedComparison([doc('pl5', '2026-11-20', 'export', plFive()), fy26])
    const s = sourceOf(c, 'FY2026', 'profit_and_loss')
    expect(s.source).toMatchObject({ documentId: 'fs26', kind: 'annual_statements', label: 'Annual financial statements' })
    expect(s.alsoIn).toHaveLength(1)
    expect(s.alsoIn[0]).toMatchObject({ documentId: 'pl5', kind: 'export', differs: [] })
    // FY2025: the export's column (rank 2) before the annual statements' prior-year column (rank 3).
    expect(sourceOf(c, 'FY2025', 'profit_and_loss').source?.documentId).toBe('pl5')
    expect(sourceOf(c, 'FY2025', 'profit_and_loss').alsoIn[0]).toMatchObject({ documentId: 'fs26', kind: 'comparative', label: 'Prior-year column of the FY2026 financial statements' })
  })

  it("the year's own annual statements before an export's column: a differing line is counted and noted", () => {
    const fy26 = doc('fs26', '2026-10-01', 'annual_statements', statement('profit_and_loss', [annual(2026)], [-50000]))
    const c = buildPrintedComparison([doc('pl5', '2026-11-20', 'export', plFive()), fy26])
    const s = sourceOf(c, 'FY2026', 'profit_and_loss')
    expect(s.source?.documentId).toBe('fs26')
    expect(s.alsoIn[0].differs).toEqual([{ key: expect.any(String), label: 'Net Profit', path: [], source: -50000, other: -53586.4 }])
    expect(figure(c, 'profit_and_loss', 'FY2026')).toMatchObject({ value: -50000, restated: [{ value: -53586.4, report: 'the export "pl5.pdf"' }] })
  })

  it('two current-period reports: the later period end wins, then the latest upload', () => {
    const c = buildPrintedComparison([
      doc('oct', '2026-11-20', 'export', plCurrent('2026-10-31')),
      doc('nov', '2026-11-18', 'export', plCurrent('2026-11-16')),
    ])
    expect(c.columns.at(-1)).toMatchObject({ key: 'current', periodEnd: '2026-11-16' })
    expect(sourceOf(c, 'current', 'profit_and_loss').source?.documentId).toBe('nov')
    const same = buildPrintedComparison([doc('first', '2026-11-18', 'export', plCurrent()), doc('second', '2026-11-20', 'export', plCurrent())])
    expect(sourceOf(same, 'current', 'profit_and_loss').source?.documentId).toBe('second')
    expect(sourceOf(same, 'current', 'profit_and_loss').alsoIn.map((a) => a.documentId)).toEqual(['first'])
  })

  it('current-period profit and loss and balance sheet ending on different dates: flagged, each from its own report', () => {
    const c = buildPrintedComparison([doc('plc', '2026-11-20', 'export', plCurrent('2026-11-16')), doc('bsc', '2026-11-20', 'export', bsCurrent('2026-10-31'))])
    const col = c.columns.at(-1)!
    expect(col).toMatchObject({ key: 'current', periodEnd: '2026-11-16', ends: { profit_and_loss: '2026-11-16', balance_sheet: '2026-10-31' } })
    expect(c.periodSources.at(-1)!.endsDiffer).toBe('The current-period profit and loss runs to 16 Nov 2026 but the balance sheet is as at 31 Oct 2026: they do not cover the same period.')
    expect(figure(c, 'balance_sheet', 'current').value).toBe(116544.65)
  })

  it("an export's own year before another export's earlier column, whatever the upload order", () => {
    const fy25 = doc('x25', '2026-01-01', 'export', statement('balance_sheet', [annual(2025), annual(2024)], [200, 140]))
    const fy24 = doc('x24', '2025-01-01', 'export', statement('balance_sheet', [annual(2024), annual(2023)], [150, 90]))
    const c = buildPrintedComparison([fy25, fy24])
    expect(c.columns.map((col) => col.key)).toEqual(['FY2023', 'FY2024', 'FY2025'])
    expect(sourceOf(c, 'FY2024', 'balance_sheet').source?.documentId).toBe('x24')
    expect(figure(c, 'balance_sheet', 'FY2024').value).toBe(150)
  })

  it('a year printed only as the prior-year column of annual statements stays on request', () => {
    const c = buildPrintedComparison([doc('fs26', '2026-10-01', 'annual_statements', statement('profit_and_loss', [annual(2026), annual(2025)], [1, 2]))])
    expect(c.columns.map((col) => col.key)).toEqual(['FY2026'])
    expect(c.hiddenComparativeYears).toEqual([2025])
  })

  it('a read stored before 25 Nov 2026 (no report kind) counts as annual statements', () => {
    const old = doc('old', '2026-01-01', 'annual_statements', statement('profit_and_loss', [annual(2026), annual(2025)], [1, 2]))
    delete old.read!.report
    expect(buildPrintedComparison([old]).hiddenComparativeYears).toEqual([2025])
  })
})

describe('sources: staff choices', () => {
  const docs = () => [doc('pl5', '2026-11-20', 'export', plFive()), doc('fs26', '2026-10-01', 'annual_statements', statement('profit_and_loss', [annual(2026)], [-50000]))]
  const choice = (documentId: string | null, chosenAt: string): SourceChoice => ({ column: 'FY2026', statement: 'profit_and_loss', documentId, chosenBy: 'Jane Example', chosenAt })

  it('"Use this source instead" takes that file, says who and when, and lists the rule\'s choice under Also in', () => {
    const c = buildPrintedComparison(docs(), { sourceChoices: [choice('pl5', '2026-11-25T01:00:00Z')] })
    const s = sourceOf(c, 'FY2026', 'profit_and_loss')
    expect(s.source?.documentId).toBe('pl5')
    expect(s.chosen).toEqual({ by: 'Jane Example', at: '2026-11-25T01:00:00Z' })
    expect(s.alsoIn.map((a) => a.documentId)).toEqual(['fs26'])
    expect(figure(c, 'profit_and_loss', 'FY2026').value).toBe(-53586.4)
    // Only that period and statement.
    expect(sourceOf(c, 'FY2025', 'profit_and_loss').chosen).toBeNull()
  })

  it('the latest choice counts; null goes back to the rules', () => {
    const c = buildPrintedComparison(docs(), { sourceChoices: [choice(null, '2026-11-25T02:00:00Z'), choice('pl5', '2026-11-25T01:00:00Z')] })
    expect(sourceOf(c, 'FY2026', 'profit_and_loss')).toMatchObject({ source: { documentId: 'fs26' }, chosen: null })
  })

  it('a choice of a file that no longer prints the period is ignored', () => {
    const c = buildPrintedComparison(docs(), { sourceChoices: [{ ...choice('gone', '2026-11-25T01:00:00Z') }] })
    expect(sourceOf(c, 'FY2026', 'profit_and_loss').source?.documentId).toBe('fs26')
  })
})

describe('checkSourceChoice', () => {
  const c = () =>
    buildPrintedComparison([doc('pl5', '2026-11-20', 'export', plFive()), doc('fs26', '2026-10-01', 'annual_statements', statement('profit_and_loss', [annual(2026)], [-50000]))])

  it('accepts the source or an "Also in" file, and going back to the rules', () => {
    expect(() => checkSourceChoice(c(), 'FY2026', ['profit_and_loss'], 'pl5')).not.toThrow()
    expect(() => checkSourceChoice(c(), 'FY2026', ['profit_and_loss'], 'fs26')).not.toThrow()
    expect(() => checkSourceChoice(c(), 'FY2026', ['profit_and_loss', 'balance_sheet'], null)).not.toThrow()
  })

  it('refuses a period not shown, or a file that does not print that statement for it', () => {
    expect(() => checkSourceChoice(c(), 'FY2019', ['profit_and_loss'], 'pl5')).toThrow(SourceChoiceError)
    expect(() => checkSourceChoice(c(), 'FY2025', ['profit_and_loss'], 'fs26x')).toThrow('does not print')
    expect(() => checkSourceChoice(c(), 'FY2026', ['balance_sheet'], 'pl5')).toThrow('does not print')
  })
})
