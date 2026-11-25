import { describe, it, expect } from 'vitest'
import type { PdfLine } from '@/lib/pdf/pageLines'
import { readStatements } from '../readStatements'
import { entityOf } from '../reportKind'
import { verifyStatements } from '../verify'

/**
 * Multi-year and current-period exports (Xero, MYOB) beside annual financial statements
 * (25 Nov 2026). Synthetic statements only: the real files are in `npm run printed:check`.
 */

type Cell = [x: number, right: number, text: string]
const line = (...cells: Cell[]): PdfLine => ({ text: cells.map((c) => c[2]).join(' '), cells: cells.map(([x, right, text]) => ({ x, right, text })) })
const row = (x: number, label: string, rights: number[], ...figures: string[]): PdfLine =>
  line(...([[x, x + label.length * 5, label]] as Cell[]).filter((c) => c[2] !== ''), ...figures.map((f, i): Cell => [rights[i] - f.length * 5, rights[i], f]))
const title = (text: string): PdfLine => line([57, 57 + text.length * 5, text])

const FIVE = [300, 360, 420, 480, 540]

/** A five-year Xero balance sheet, as Example Roasters Pty Ltd would export it. */
function fiveYearBalanceSheet(): PdfLine[] {
  const r = (x: number, label: string, ...f: string[]) => row(x, label, FIVE, ...f)
  return [
    title('Balance Sheet'),
    title('Example Roasters Pty Ltd'),
    title('As at 30 June 2026'),
    line(...FIVE.map((right, i): Cell => [right - 40, right, `30 JUNE ${2026 - i}`])),
    title('Assets'),
    r(64, 'Bank'),
    r(71, 'Cheque Account', '100.00', '200.00', '300.00', '400.00', '500.00'),
    r(71, 'Total Bank', '100.00', '200.00', '300.00', '400.00', '500.00'),
    r(64, 'Fixed Assets'),
    // Wrapped label, figures on the middle line.
    r(71, 'Less Accumulated Depreciation on Office'),
    r(0, '', '(10.00)', '(10.00)', '(10.00)', '(10.00)', '(5.00)'),
    r(71, 'Equipment'),
    r(71, 'Office Equipment', '50.00', '50.00', '50.00', '50.00', '25.00'),
    r(71, 'Total Fixed Assets', '40.00', '40.00', '40.00', '40.00', '20.00'),
    r(64, 'Total Assets', '140.00', '240.00', '340.00', '440.00', '520.00'),
    title('Liabilities'),
    r(64, 'Current Liabilities'),
    r(71, 'GST', '60.00', '60.00', '60.00', '60.00', '60.00'),
    r(71, 'Jane Example - Drawings', '(160.00)', '-', '-', '-', '-'),
    r(71, 'Total Current Liabilities', '(100.00)', '60.00', '60.00', '60.00', '60.00'),
    r(64, 'Total Liabilities', '(100.00)', '60.00', '60.00', '60.00', '60.00'),
    r(57, 'Net Assets', '240.00', '180.00', '280.00', '380.00', '460.00'),
    title('Equity'),
    r(64, 'Retained Earnings', '240.00', '180.00', '280.00', '380.00', '460.00'),
    r(64, 'Total Equity', '240.00', '180.00', '280.00', '380.00', '460.00'),
  ]
}

describe('reading a multi-year export', () => {
  it('reads every column as the year ended 30 June of its year, and the entity from the title block', () => {
    const read = readStatements([fiveYearBalanceSheet()])
    expect(read.issues).toEqual([])
    const [bs] = read.statements
    expect(bs.columns.map((c) => [c.periodEnd, c.kind])).toEqual([2026, 2025, 2024, 2023, 2022].map((y) => [`${y}-06-30`, 'annual']))
    expect(bs.entity).toBe('Example Roasters Pty Ltd')
    expect(read.report).toEqual({ kind: 'export', markers: [] })
  })

  it('joins a label wrapped around its figures into one line', () => {
    const [bs] = readStatements([fiveYearBalanceSheet()]).statements
    const dep = bs.rows.find((r) => r.label.startsWith('Less Accumulated'))!
    expect(dep).toMatchObject({ label: 'Less Accumulated Depreciation on Office Equipment', style: 'line', path: ['Assets', 'Fixed Assets'], amounts: [-10, -10, -10, -10, -5] })
    expect(bs.rows.some((r) => r.label === 'Equipment')).toBe(false)
  })

  it('verifies net assets when the liabilities total is printed negative (a negative liability)', () => {
    const read = readStatements([fiveYearBalanceSheet()])
    const failing = verifyStatements(read.statements).filter((c) => c.status === 'mismatch' || c.status === 'wrong_column')
    expect(failing).toEqual([])
  })

  it('keeps a real heading followed by indented lines a heading', () => {
    const r = (x: number, label: string, ...f: string[]) => row(x, label, [540], ...f)
    const [bs] = readStatements([
      [
        title('Balance Sheet'),
        title('As at 30 June 2026'),
        line([500, 540, '2026']),
        title('Assets'),
        r(64, 'Bank'),
        r(71, 'Cheque Account', '100'),
        r(71, 'Total Bank', '100'),
        r(64, 'Total Assets', '100'),
      ],
    ]).statements
    expect(bs.rows.find((x) => x.label === 'Bank')?.style).toBe('heading')
  })
})

describe('reading a current-period export', () => {
  it('joins a header printed above its year ("1 JULY-16 NOV" over "2026") to that column', () => {
    const [pl] = readStatements([
      [
        title('Profit and Loss'),
        title('Example Roasters Pty Ltd'),
        title('For the period 1 July 2026 to 16 November 2026'),
        line([495, 539, '1 JULY-16 NOV']),
        line([524, 539, '2026']),
        title('Trading Income'),
        row(64, 'Sales', [539], '1,000.00'),
        row(64, 'Total Trading Income', [539], '1,000.00'),
        row(57, 'Net Profit', [539], '1,000.00'),
      ],
    ]).statements
    expect(pl.columns).toEqual([{ header: '1 JULY-16 NOV 2026', periodStart: '2026-07-01', periodEnd: '2026-11-16', kind: 'current_period', financialYear: 2027 }])
  })

  it('reads the header alone as that period even without a title line', () => {
    const [pl] = readStatements([
      [
        title('Profit and Loss'),
        title('Example Roasters Pty Ltd'),
        line([495, 539, '1 JULY-16 NOV']),
        line([524, 539, '2026']),
        title('Trading Income'),
        row(64, 'Sales', [539], '1,000.00'),
        row(64, 'Total Trading Income', [539], '1,000.00'),
      ],
    ]).statements
    expect(pl.columns[0]).toMatchObject({ periodEnd: '2026-11-16', kind: 'current_period' })
  })
})

describe('report kind, from content only', () => {
  const statementPage = (heading: string, header: PdfLine): PdfLine[] => [
    title(heading),
    title('Example Roasters Pty Ltd'),
    title('For the year ended 30 June 2026'),
    header,
    title('Income'),
    row(64, 'Sales', [540], '1,000'),
    row(64, 'Total Income', [540], '1,000'),
  ]

  it('is an export when only the statement is printed, with one column or two', () => {
    expect(readStatements([statementPage('Profit and Loss', line([500, 540, '2026']))]).report?.kind).toBe('export')
    expect(readStatements([statementPage('Profit and Loss', line([440, 480, '2026'], [500, 540, '2025']))]).report?.kind).toBe('export')
  })

  it.each([
    ['a contents page', [title('Contents'), title('Income Statement 3')]],
    ['notes to the financial statements', [title('Notes to the Financial Statements')]],
    ['a compilation report', [title('Compilation Report to Example Roasters Pty Ltd')]],
    ["a directors' declaration", [title("Directors' Declaration")]],
    ["a trustees' declaration", [title("Trustee's Declaration")]],
  ])('is annual financial statements with %s', (_name, extra) => {
    const read = readStatements([extra as PdfLine[], statementPage('Profit and Loss', line([500, 540, '2026']))])
    expect(read.report?.kind).toBe('annual_statements')
    expect(read.report?.markers[0]).toMatch(/\(page 1\)$/)
  })

  it('is annual financial statements when titled "Income Statement", or with a Notes column', () => {
    expect(readStatements([statementPage('Income Statement', line([500, 540, '2026']))]).report?.kind).toBe('annual_statements')
    expect(readStatements([statementPage('Profit and Loss', line([400, 430, 'Notes'], [500, 540, '2026']))]).report?.kind).toBe('annual_statements')
  })

  it('never takes a long sentence that mentions notes as a contents page', () => {
    const read = readStatements([statementPage('Profit and Loss', line([500, 540, '2026'])), [title('This report should be read together with all of the information on the contents page of the pack')]])
    expect(read.report?.kind).toBe('export')
  })
})

describe('entityOf', () => {
  it('takes the title-block line naming an entity, never a date line or a bare name', () => {
    expect(entityOf(['Balance Sheet', 'Example Roasters Pty Ltd', 'As at 30 June 2026'], 'Balance Sheet')).toBe('Example Roasters Pty Ltd')
    expect(entityOf(['The Trustee for Example Family Trust', 'Profit and Loss'], 'Profit and Loss')).toBe('The Trustee for Example Family Trust')
    expect(entityOf(['Profit and Loss', 'Jane Example', 'For the year ended 30 June 2026'], 'Profit and Loss')).toBeNull()
  })
})
