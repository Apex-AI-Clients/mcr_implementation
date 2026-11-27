import { describe, it, expect } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import { autoMapping } from '../autoMapping'
import { suggestMapping, personAccount } from '../dictionary'
import { headlineRows, headlineCsv, NEGATIVE_LIABILITY_NOTE, type HeadlineRow } from '../headline'
import { predictionFinancials } from '../mapping'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'

/**
 * Headline figures on a Xero balance sheet (Gabby, 25 Nov 2026): Bank printed as its own section,
 * beneficiary accounts per person, income tax payable printed negative. Synthetic figures, laid out as
 * the Fortitude export prints them.
 */

const col = (fy: number): PrintedColumn => ({ header: `30 JUNE ${fy}`, periodStart: null, periodEnd: `${fy}-06-30`, kind: 'annual', financialYear: fy })
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })

function balanceSheet(): PrintedStatement {
  const A = ['Assets']
  const L = ['Liabilities', 'Non-current Liabilities']
  const C = ['Liabilities', 'Current Liabilities']
  return {
    kind: 'balance_sheet',
    title: 'Balance Sheet',
    pages: [1],
    columns: [col(2026), col(2025)],
    rows: [
      r([], 'Assets', 'heading', null, null),
      r(A, 'Bank', 'heading', null, null),
      r([...A, 'Bank'], 'Cheque Account', 'line', 1000, 2000),
      r([...A, 'Bank'], 'Total Bank', 'subtotal', 1000, 2000),
      r(A, 'Current Assets', 'heading', null, null),
      r([...A, 'Current Assets'], 'Accounts Receivable', 'line', 500, 400),
      r([...A, 'Current Assets'], 'Total Current Assets', 'subtotal', 500, 400),
      r(A, 'Fixed Assets', 'heading', null, null),
      r([...A, 'Fixed Assets'], 'Plant and Equipment', 'line', 3000, 3000),
      r([...A, 'Fixed Assets'], 'Total Fixed Assets', 'subtotal', 3000, 3000),
      r(A, 'Total Assets', 'subtotal', 4500, 5400),
      r([], 'Liabilities', 'heading', null, null),
      r(['Liabilities'], 'Current Liabilities', 'heading', null, null),
      r(C, 'Income Tax Payable', 'line', -700, -700),
      r(C, 'Owner A Drawings', 'line', -50, null),
      r(C, 'Total Current Liabilities', 'subtotal', -750, -700),
      r(['Liabilities'], 'Non-current Liabilities', 'heading', null, null),
      // Jane Example (a director): owes the company 900 net in FY2026.
      r(L, 'Jane Example - Drawings', 'line', -1200, -1000),
      r(L, 'Jane Example - Share of Profit', 'line', 300, 300),
      // Example Holdings Pty Ltd (a beneficiary: it has a share of profit): the company owes it 400.
      r(L, 'Example Holdings Pty Ltd - Drawings', 'line', -100, -100),
      r(L, 'Example Holdings Pty Ltd - Share of Profit', 'line', 500, 500),
      // Sam Other: nets to nil.
      r(L, 'Sam Other - Drawings', 'line', -50, -50),
      r(L, 'Sam Other - Share of Profit', 'line', 50, 50),
      // Not related to anyone on file: two lines, no share of profit.
      r(L, 'Pat Stranger - Drawings', 'line', -20, -20),
      r(L, 'Pat Stranger - Capital Introduced', 'line', 10, 10),
      r(L, 'Total Non-current Liabilities', 'subtotal', -510, -310),
      r(['Liabilities'], 'Total Liabilities', 'subtotal', -1260, -1010),
      r([], 'Net Assets', 'total', 5760, 6410),
    ],
    wholeDollars: true,
  }
}

const doc: ComparisonDocument = {
  documentId: 'bs',
  filename: 'Balance Sheet.pdf',
  uploadedAt: '2026-11-20',
  read: { status: 'read', pageCount: 1, statements: [balanceSheet()], issues: [], report: { kind: 'export', markers: [] } },
}
const names = { directors: ['Jane Example'], parties: [] }

function rows(): { comparison: ReturnType<typeof buildPrintedComparison>; rows: HeadlineRow[]; auto: ReturnType<typeof autoMapping> } {
  const comparison = buildPrintedComparison([doc])
  const auto = autoMapping(comparison, [], names)
  return { comparison, auto, rows: headlineRows(comparison, auto.entries, suggestMapping(comparison, names), { status: 'none', cells: [] }) }
}
const row = (rs: HeadlineRow[], key: string) => rs.find((x) => x.key === key)!
const fy26 = (h: HeadlineRow) => h.cells[1] as Extract<HeadlineRow['cells'][number], { kind: 'value' }>

describe('Xero balance sheet headline figures', () => {
  it('total current assets = Bank + Current Assets, proven by the printed Total Assets; never "Total Current Assets" alone', () => {
    const { rows: rs } = rows()
    const cur = fy26(row(rs, 'total_current_assets'))
    expect(cur.value).toBe(1500)
    expect(cur.lines.map((l) => l.label).sort()).toEqual(['Total Bank', 'Total Current Assets'])
    expect(cur.lines[0].rule).toBe('From “Total Bank” and “Total Current Assets”, added up: with “Total Fixed Assets” they add up to the printed Total Assets.')
    expect(fy26(row(rs, 'total_non_current_assets')).value).toBe(3000)
  })

  it('one account per person, netted within the person, never across people', () => {
    const { rows: rs } = rows()
    const debit = fy26(row(rs, 'loan_receivable'))
    const credit = fy26(row(rs, 'loan_payable'))
    expect(debit.lines.map((l) => [l.label, l.value])).toEqual([
      ['Jane Example', 900],
      ['Sam Other', 0],
    ])
    expect(debit.value).toBe(900)
    expect(credit.lines.map((l) => [l.label, l.value])).toEqual([['Example Holdings Pty Ltd', 400]])
    expect(debit.lines[0].parts?.map((p) => p.label)).toEqual(['Jane Example - Drawings', 'Jane Example - Share of Profit'])
    expect(debit.lines[0].rule).toBe(
      'One account per person: “Jane Example - Drawings” −$1,200.00 + “Jane Example - Share of Profit” $300.00 = −$900.00 as printed, so Jane Example owes the company $900.00.',
    )
  })

  it('drawings naming nobody, and a stranger\'s own account lines, are possible lines only', () => {
    const { auto, comparison } = rows()
    expect((auto.possible.loan_receivable ?? []).map((p) => p.label).sort()).toEqual(['Owner A Drawings', 'Pat Stranger - Capital Introduced', 'Pat Stranger - Drawings'])
    // The prediction waits for staff ("Use it?") rather than guessing.
    const f = predictionFinancials(comparison, auto.entries, names)
    expect(f.loanReceivable).toBeNull()
    expect(f.notIdentified.loanReceivable?.candidates).toContain('Owner A Drawings')
    expect(f.loanPayable?.amount).toBe(400)
  })

  it('income tax payable as printed, with "Printed as a negative liability"', () => {
    const { rows: rs } = rows()
    expect(fy26(row(rs, 'income_tax_payable'))).toMatchObject({ value: -700, note: NEGATIVE_LIABILITY_NOTE })
  })

  it('the CSV carries each period\'s checks and source', () => {
    const { comparison, rows: rs } = rows()
    const csv = headlineCsv({ clientName: 'Example', comparison, rows: rs })
    expect(csv).toContain('Source: Multi-year export (2026–2025) — “Balance Sheet.pdf”')
    expect(csv).toContain('✓ Every total on the statements adds up')
  })
})

describe('personAccount', () => {
  it.each([
    ['Matthew Trow - Drawings', { name: 'Matthew Trow', kind: 'Drawings' }],
    ['Yan-Trow Investments Pty Ltd - Share of Profit', { name: 'Yan-Trow Investments Pty Ltd', kind: 'Share of Profit' }],
    ['Jane Example – Capital Introduced', { name: 'Jane Example', kind: 'Capital Introduced' }],
  ])('%s', (label, expected) => expect(personAccount(label)).toEqual(expected))

  it.each(['Owner A Drawings', 'Loan - Square', 'Loan - Drawings', 'Drawings', 'Loan - Director'])('%s is not a person account', (label) => expect(personAccount(label)).toBeNull())
})
