import { describe, it, expect } from 'vitest'
import type { PdfLine } from '@/lib/pdf/pageLines'
import { buildPrintedComparison, fixSpelling, type ComparisonDocument } from '../compare'
import { namesDirector, suggestMapping } from '../dictionary'
import { resolveMeaning, type MappingEntry } from '../mapping'
import { readStatements, splitAtSecondTitle } from '../readStatements'
import { verifyStatements } from '../verify'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'

/**
 * Rules the old (AI) reader applied, ported to the as-printed reader and the
 * suggested mapping (commit 908ed26 removed the old code). One test per rule,
 * named after it. Synthetic statements only.
 */

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })

function sheet(rows: PrintedRow[], pl: PrintedRow[] = []) {
  const statements: PrintedStatement[] = [{ kind: 'balance_sheet', title: 'Balance Sheet', pages: [1], columns: [fy(2025)], rows, wholeDollars: true }]
  if (pl.length) statements.push({ kind: 'profit_and_loss', title: 'Profit and Loss', pages: [1], columns: [fy(2025)], rows: pl, wholeDollars: true })
  const doc: ComparisonDocument = { documentId: 'd', filename: 'd.pdf', uploadedAt: '', read: { status: 'read', pageCount: 1, issues: [], statements } }
  return buildPrintedComparison([doc])
}
const label = (c: ReturnType<typeof sheet>, keys: string[]) => keys.map((k) => c.tables.flatMap((t) => t.rows).find((x) => x.key === k)?.label)
const CA = ['Assets', 'Current Assets']
const CL = ['Liabilities', 'Current Liabilities']
const NCL = ['Liabilities', 'Non-Current Liabilities']

describe('loan accounts (old labels.ts isDirectorLoanLabel / classifyLoan, lineCorrections baseKey)', () => {
  it('year-suffixed unnamed loans are the director\'s: owed to the company under assets, by it under liabilities', () => {
    const c = sheet([r(CA, 'Loan 2020', 'line', 14_971), r(CA, 'Loan - 2023', 'line', 43_310), r(NCL, 'Loan 2021', 'line', 5_000)])
    const s = suggestMapping(c)
    expect(label(c, s.loan_receivable)).toEqual(['Loan 2020', 'Loan - 2023'])
    expect(label(c, s.loan_payable)).toEqual(['Loan 2021'])
    expect(s.cash_loans).toEqual([])
  })

  it('a "(Quarantined)" loan and a unitholder loan are related-party loans', () => {
    const c = sheet([r(CA, 'Loan (Quarantined)', 'line', 9_000), r(CL, 'Loan - Unitholders', 'line', 2_000)])
    const s = suggestMapping(c)
    expect(label(c, s.loan_receivable)).toEqual(['Loan (Quarantined)'])
    expect(label(c, s.loan_payable)).toEqual(['Loan - Unitholders'])
  })

  it('a loan naming a director on file is theirs: one-word names need that word, longer names two of them', () => {
    expect(namesDirector('Loan Jane Citizen', ['Jane Mary Citizen'])).toBe(true)
    expect(namesDirector('Loan Jane', ['Jane Mary Citizen'])).toBe(false)
    expect(namesDirector('Loan from Madonna', ['Madonna'])).toBe(true)
    const c = sheet([r(CL, 'Loan Jane Citizen', 'line', 12_000)])
    expect(label(c, suggestMapping(c, { directors: ['Jane Citizen'] }).loan_payable)).toEqual(['Loan Jane Citizen'])
    expect(suggestMapping(c).loan_payable).toEqual([])
  })

  it('"Owner … Funds Introduced" is owed by the company under liabilities, and to it under assets', () => {
    const liability = sheet([r(CL, 'Owner Example Person Funds Introduced', 'line', 40_667.15)])
    expect(label(liability, suggestMapping(liability).loan_payable)).toEqual(['Owner Example Person Funds Introduced'])
    const asset = sheet([r(CA, 'Owner A Funds Introduced', 'line', 1_000)])
    expect(label(asset, suggestMapping(asset).loan_receivable)).toEqual(['Owner A Funds Introduced'])
  })

  it('vehicles, plant and lenders are finance, never a related party; "Van Nguyen" is a person', () => {
    const c = sheet([
      r(CL, 'Loan - Mercedes Benz', 'line', 30_000),
      r(CL, 'Loan - Pepper Money', 'line', 20_000),
      r(CL, 'Loan - Westpac', 'line', 10_000),
      r(CL, 'Loan - Forklift', 'line', 5_000),
      r(CL, 'Loan - Van', 'line', 4_000),
      r(CL, 'Loan - Van Nguyen', 'line', 3_000),
    ])
    const s = suggestMapping(c)
    expect(label(c, s.loan_payable)).toEqual(['Loan - Van Nguyen'])
    expect(label(c, s.cash_loans)).toEqual(['Loan - Mercedes Benz', 'Loan - Pepper Money', 'Loan - Westpac', 'Loan - Forklift', 'Loan - Van'])
  })
})

describe('bank overdraft (old labels.ts BANK_ACCOUNT)', () => {
  it('a bank account printed under liabilities is the overdraft', () => {
    const c = sheet([r(CL, 'Business Account', 'line', 2_500), r(CL, 'Westpac Cheque Account', 'line', 1_000), r(CA, 'Cash at Bank', 'line', 300)])
    expect(label(c, suggestMapping(c).bank_overdraft)).toEqual(['Business Account', 'Westpac Cheque Account'])
  })
})

describe('"Less" and closing stock (old lineCorrections sectionSum, the extraction prompt\'s unexpired interest netting)', () => {
  it('a positive "Less Unexpired Interest" is taken off the mapped finance, not added', () => {
    const c = sheet([r(NCL, 'Loan - Hino Truck', 'line', 97_135), r(NCL, 'Less Unexpired Interest - Hino Truck', 'line', 21_781)])
    const rows = c.tables.flatMap((t) => t.rows)
    const entries: MappingEntry[] = rows.map((row) => ({ meaning: 'cash_loans', rowKey: row.key, label: row.label, nonePrinted: false, confirmedBy: 't', confirmedAt: 't' }))
    const year = resolveMeaning(c, entries, 'cash_loans').years[0]
    expect(year.value).toBe(75_354)
    expect(year.lines[1]).toMatchObject({ printed: 21_781, value: -21_781 })
  })

  it('closing stock is subtracted in its total whether or not the label says "Less"', () => {
    const statement: PrintedStatement = {
      kind: 'profit_and_loss',
      title: 'Profit and Loss',
      pages: [1],
      columns: [fy(2025)],
      wholeDollars: true,
      rows: [
        r([], 'Cost of sales', 'heading', null),
        r(['Cost of sales'], 'Opening Stock', 'line', 5_000),
        r(['Cost of sales'], 'Purchases', 'line', 20_000),
        r(['Cost of sales'], 'Closing Stock', 'line', 6_000),
        r(['Cost of sales'], 'Total Cost of Sales', 'subtotal', 19_000),
      ],
    }
    expect(verifyStatements([statement]).filter((c) => c.status !== 'ok')).toEqual([])
  })
})

describe('one row however it is spelt (old labels.ts MISSPELLINGS)', () => {
  it('fixes the misspellings accountants print, in labels and in saved row keys', () => {
    expect(fixSpelling('total current liabilites')).toBe('total current liabilities')
    expect(fixSpelling('trade recievables')).toBe('trade receivable')
    const a = sheet([r(['Current Assests'], 'Trade Recievables', 'line', 1)])
    const b = sheet([r(['Current Assets'], 'Trade Receivable', 'line', 1)])
    expect(a.tables[0].rows[0].key).toBe(b.tables[0].rows[0].key)
  })
})

describe('two statements on one page (old classifyPages secondStatement)', () => {
  type Cell = [x: number, right: number, text: string]
  const line = (...cells: Cell[]): PdfLine => ({ text: cells.map((c) => c[2]).join(' '), cells: cells.map(([x, right, text]) => ({ x, right, text })) })
  const row = (text: string, figure: string): PdfLine => line([25, 25 + text.length * 5, text], [470 - figure.length * 5, 470, figure])
  const page: PdfLine[] = [
    line([200, 320, 'PROFIT AND LOSS STATEMENT']),
    line([200, 330, 'for the year ended 30 June 2025']),
    line([450, 470, '2025']),
    row('Sales', '100'),
    row('Total Income', '100'),
    row('Net Profit', '100'),
    line([200, 300, 'BALANCE SHEET']),
    line([200, 330, 'as at 30 June 2025']),
    line([450, 470, '2025']),
    row('Cash', '100'),
    row('Total Assets', '100'),
    row('Net Assets', '100'),
  ]

  it('splits the page at the second title, and reads both statements', () => {
    expect(splitAtSecondTitle(page, null).map((part) => part.length)).toEqual([6, 6])
    const read = readStatements([page])
    expect(read.statements.map((s) => [s.kind, s.rows.map((x) => x.label)])).toEqual([
      ['profit_and_loss', ['Sales', 'Total Income', 'Net Profit']],
      ['balance_sheet', ['Cash', 'Total Assets', 'Net Assets']],
    ])
  })
})

describe('rules already ported, now with their own tests', () => {
  it('superannuation is never ATO-related debt', () => {
    const c = sheet([r(CL, 'GST Payable', 'line', 1_000), r(CL, 'PAYG Withholding', 'line', 500), r(CL, 'Superannuation Payable', 'line', 700), r(CL, 'Super Guarantee Charge - ATO', 'line', 300)])
    expect(label(c, suggestMapping(c).ato_debt)).toEqual(['GST Payable', 'PAYG Withholding'])
  })

  it('revenue is never a total net of cost of sales, nor "other income"', () => {
    const c = sheet(
      [r(CA, 'Cash', 'line', 1)],
      [
        r([], 'Income', 'heading', null),
        r(['Income'], 'Sales', 'line', 100),
        r(['Income'], 'Total Income', 'subtotal', 100),
        r(['Income', 'Cost of sales'], 'Purchases', 'line', 30),
        r(['Income'], 'Gross Profit', 'subtotal', 70),
        r([], 'Other income', 'heading', null),
        r(['Other income'], 'Interest received', 'line', 5),
        r(['Other income'], 'Total Other Income', 'subtotal', 5),
      ],
    )
    expect(label(c, suggestMapping(c).revenue)).toEqual(['Total Income'])
  })

  it('net profit is never the figure after prior-year losses are deducted', () => {
    const c = sheet(
      [r(CA, 'Cash', 'line', 1)],
      [r([], 'Net Profit After Loss', 'total', 47), r([], 'Net Profit', 'total', 51)],
    )
    expect(label(c, suggestMapping(c).net_profit)).toEqual(['Net Profit'])
  })
})
