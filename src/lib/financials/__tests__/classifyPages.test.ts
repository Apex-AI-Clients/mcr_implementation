import { describe, it, expect } from 'vitest'
import { classifyFinancialDocument, classifyPages } from '../classifyPages'
import {
  COMPANY,
  appropriation,
  balanceSheet,
  contents,
  contractorLicence,
  coverLetter,
  currentPeriodBalanceSheet,
  currentPeriodProfitAndLoss,
  declaration,
  depreciation,
  incomeStatement,
  incomeStatementContinuation,
  invoice,
  notes,
  onePageBoth,
  taxReturn,
  titlePage,
  trustBalanceSheet,
  trustDeed,
  trustProfitAndLoss,
  TRUSTEE_HEADING,
  type Page,
} from './fixtures/statementPages'

/**
 * The text pre-pass classifier, on SYNTHETIC page text. Every shape here is
 * one the product has to read; see fixtures/statementPages.ts.
 */

/** Shape A: one PDF per FY, the statements wrapped in front and back matter. */
function combined(fy: number): Page[] {
  return [
    coverLetter(),
    titlePage(fy),
    contents(),
    incomeStatement(fy),
    balanceSheet(fy),
    notes(),
    appropriation(fy),
    declaration(),
    depreciation(),
    ...taxReturn(fy, 10),
  ]
}

const classes = (pages: Page[]) => classifyPages(pages).map((p) => p.class)

describe('combined PDF (shape A)', () => {
  const pages = combined(2025)
  const result = classifyFinancialDocument(pages)

  it('classifies every page', () => {
    expect(classes(pages)).toEqual([
      'cover',
      'cover',
      'cover',
      'income_statement',
      'balance_sheet',
      'notes_other',
      'notes_other',
      'notes_other',
      'notes_other',
      ...Array(10).fill('tax_return'),
    ])
  })

  it('names the statement pages, and only those', () => {
    expect(result.kind).toBe('combined')
    expect(result.statementPages).toEqual({ income_statement: [4], balance_sheet: [5] })
  })

  it('never takes a tax-return page as a statement, though it says "Balance sheet items"', () => {
    const taxPages = result.pages.filter((p) => p.page > 9)
    expect(taxPages.every((p) => p.class === 'tax_return' && p.statements.length === 0)).toBe(true)
  })

  it('reads the year from the headings, and the prior year from the column header', () => {
    expect(result.headingYears).toEqual([2025])
    expect(result.comparativeYears).toEqual([2024])
    expect(result.currentPeriodYear).toBeNull()
    expect(result.periods.map((p) => [p.statement, p.kind, p.endDate])).toEqual([
      ['income_statement', 'annual', '2025-06-30'],
      ['balance_sheet', 'annual', '2025-06-30'],
    ])
  })

  it('labels the front and back matter', () => {
    const sections = result.pages.map((p) => p.section).filter(Boolean)
    expect(sections).toEqual([
      'letter',
      'title',
      'contents',
      'notes',
      'appropriation',
      'declaration',
      'depreciation',
    ])
  })

  it('takes the entity from the statements, not the accountant on the cover letter', () => {
    expect(result.entity?.name).toBe(COMPANY)
  })
})

describe('page order', () => {
  it('finds the statements when a tax return comes first', () => {
    const pages = [...taxReturn(2025, 4), incomeStatement(2025), balanceSheet(2025), notes()]
    const result = classifyFinancialDocument(pages)
    expect(result.statementPages).toEqual({ income_statement: [5], balance_sheet: [6] })
    expect(classes(pages).slice(0, 4)).toEqual(Array(4).fill('tax_return'))
  })

  it('finds statements after page 8', () => {
    const front = [coverLetter(), titlePage(2025), contents(), notes(), declaration(), depreciation(), notes(), notes(), notes()]
    const result = classifyFinancialDocument([...front, incomeStatement(2025), balanceSheet(2025)])
    expect(result.statementPages).toEqual({ income_statement: [10], balance_sheet: [11] })
  })

  it('follows a statement onto a page with no heading of its own', () => {
    const pages = [incomeStatement(2025), incomeStatementContinuation(), balanceSheet(2025)]
    const result = classifyPages(pages)
    expect(result[1]).toMatchObject({ class: 'income_statement', continued: true })
    expect(classifyFinancialDocument(pages).statementPages.income_statement).toEqual([1, 2])
  })

  it('sees both statements on a one-page export', () => {
    const result = classifyFinancialDocument([onePageBoth(2025)])
    expect(result.kind).toBe('combined')
    expect(result.statementPages).toEqual({ income_statement: [1], balance_sheet: [1] })
  })
})

describe('decoys', () => {
  it('does not take a contents page listing the statements as a statement', () => {
    expect(classifyPages([contents()])[0]).toMatchObject({ class: 'cover', section: 'contents' })
  })

  it('does not take "Notes to the Balance Sheet" or "Income statement items" as a statement', () => {
    const page = [COMPANY, 'Notes to the Balance Sheet', 'Income statement items are below']
    expect(classifyPages([page])[0].statements).toEqual([])
    expect(classifyPages([notes()])[0]).toMatchObject({ class: 'notes_other', section: 'notes' })
  })

  it('does not take a cover letter that mentions both statements as a statement', () => {
    expect(classifyPages([coverLetter()])[0]).toMatchObject({ class: 'cover', section: 'letter' })
  })
})

describe('separate files (shape B)', () => {
  it('reads a trust P&L on its own', () => {
    const result = classifyFinancialDocument([trustProfitAndLoss(2025)])
    expect(result.kind).toBe('pnl_only')
    expect(result.headingYears).toEqual([2025])
    expect(result.comparativeYears).toEqual([2024])
    expect(result.statementPages).toEqual({ income_statement: [1], balance_sheet: [] })
  })

  it('reads a trust balance sheet on its own', () => {
    const result = classifyFinancialDocument([trustBalanceSheet(2024)])
    expect(result.kind).toBe('bs_only')
    expect(result.headingYears).toEqual([2024])
    expect(result.periods[0]).toMatchObject({ kind: 'annual', endDate: '2024-06-30' })
  })

  it('takes the trustee heading and the trust ABN printed under it', () => {
    const entity = classifyFinancialDocument([trustProfitAndLoss(2025)]).entity
    expect(entity?.name).toBe(TRUSTEE_HEADING)
    expect(entity?.abns).toEqual(['33114847696'])
  })

  it('ignores an ABN that fails its checksum', () => {
    const page = [COMPANY, 'ABN 12 345 678 901', 'Balance Sheet', 'As at 30 June 2025', 'Total Assets | 1,000']
    expect(classifyFinancialDocument([page]).entity).toEqual({ name: COMPANY, abns: [] })
  })

  it('accepts the other common heading words', () => {
    for (const heading of ['Statement of Profit or Loss', 'Detailed Profit and Loss Statement', 'Profit & Loss [Accrual]', 'Trading, Profit and Loss Statement']) {
      expect(classifyFinancialDocument([incomeStatement(2025, { heading })]).kind).toBe('pnl_only')
    }
    expect(
      classifyFinancialDocument([balanceSheet(2025, { heading: 'Statement of Financial Position' })]).kind,
    ).toBe('bs_only')
  })

  it('reads a single-column statement with no comparative', () => {
    const result = classifyFinancialDocument([incomeStatement(2021, { comparative: false })])
    expect(result.headingYears).toEqual([2021])
    expect(result.comparativeYears).toEqual([])
  })
})

describe('current period (shape C)', () => {
  it('reads a combined current-period PDF with cents', () => {
    const result = classifyFinancialDocument([currentPeriodProfitAndLoss(), currentPeriodBalanceSheet()])
    expect(result.kind).toBe('combined')
    expect(result.headingYears).toEqual([])
    expect(result.currentPeriodYear).toBe(2026)
    expect(result.periods).toEqual([
      expect.objectContaining({
        statement: 'income_statement',
        kind: 'current_period',
        startDate: '2025-07-01',
        endDate: '2026-05-04',
        financialYear: 2026,
      }),
      expect.objectContaining({ statement: 'balance_sheet', kind: 'current_period', endDate: '2026-05-04' }),
    ])
  })

  it('reads separate current-period files', () => {
    expect(classifyFinancialDocument([currentPeriodProfitAndLoss()])).toMatchObject({
      kind: 'pnl_only',
      currentPeriodYear: 2026,
    })
    expect(classifyFinancialDocument([currentPeriodBalanceSheet()])).toMatchObject({
      kind: 'bs_only',
      currentPeriodYear: 2026,
    })
  })

  it('treats a full year to 30 June written as a period as annual', () => {
    const page = ['Profit and Loss', COMPANY, 'For the period 1 July 2024 to 30 June 2025', 'Sales | 1,000.00']
    const result = classifyFinancialDocument([page])
    expect(result.headingYears).toEqual([2025])
    expect(result.currentPeriodYear).toBeNull()
  })

  it('reads other date spellings', () => {
    const page = ['Balance Sheet', COMPANY, 'As at 30th June, 2023', 'Total Assets | 1,000']
    expect(classifyFinancialDocument([page]).headingYears).toEqual([2023])
    const numeric = ['Balance Sheet', COMPANY, 'As at 30/06/2022', 'Total Assets | 1,000']
    expect(classifyFinancialDocument([numeric]).headingYears).toEqual([2022])
  })
})

describe('documents that are not financial statements', () => {
  it('a bare tax return', () => {
    expect(classifyFinancialDocument(taxReturn(2025, 3)).kind).toBe('tax_return_only')
  })

  it('a trust deed', () => {
    expect(classifyFinancialDocument(trustDeed()).kind).toBe('not_financial')
  })

  it('a licence', () => {
    expect(classifyFinancialDocument(contractorLicence()).kind).toBe('not_financial')
  })

  it('anything else unrecognised is unknown, not "not financial" — it still goes to the model', () => {
    expect(classifyFinancialDocument(invoice()).kind).toBe('unknown')
  })

  it('no text layer at all', () => {
    const result = classifyFinancialDocument([[], [], []])
    expect(result).toMatchObject({ kind: 'unknown', hasTextLayer: false, entity: null })
    expect(result.pages.map((p) => p.class)).toEqual(['unknown', 'unknown', 'unknown'])
  })
})
