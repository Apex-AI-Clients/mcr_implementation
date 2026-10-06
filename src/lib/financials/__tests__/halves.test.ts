import { describe, it, expect } from 'vitest'
import {
  hasRealBalanceSheet,
  hasRealIncomeStatement,
  isLegacyRow,
  toStoredSlot,
  warningHalf,
  type FinancialStatementRow,
} from '../halves'

/**
 * Reading a financial_statements row as two halves. Synthetic data only.
 *
 * These rules mirror the SQL backfill in 0026_financial_statement_halves.sql
 * exactly — the "real data" checks and the warning section keys. Change one,
 * change the other.
 */

const REAL_IS = { income: { sales: 100 }, cogs: {}, expenses: {}, totals: {} }
const STUB_IS = { income: { sales: null }, cogs: {}, expenses: {}, totals: { totalIncome: null } }
const REAL_BS = {
  currentAssets: {},
  nonCurrentAssets: {},
  currentLiabilities: {},
  nonCurrentLiabilities: {},
  equity: {},
  totals: { totalAssets: 50 },
}
const STUB_BS = { ...REAL_BS, totals: { totalAssets: null } }

function row(overrides: Partial<FinancialStatementRow> = {}): FinancialStatementRow {
  return {
    id: 'row-1',
    client_id: 'client-1',
    financial_year: 2025,
    period_end_date: '2025-06-30',
    period_start_date: null,
    period_label: null,
    source_column: 'primary',
    income_statement: REAL_IS,
    balance_sheet: REAL_BS,
    document_id: 'doc-legacy',
    source_filename: 'synthetic.pdf',
    extracted_at: '2026-01-01T00:00:00.000Z',
    extraction_model: 'model-x',
    extraction_warnings: [],
    raw_extraction: null,
    is_document_id: null,
    is_source_filename: null,
    is_extracted_at: null,
    is_warnings: [],
    bs_document_id: null,
    bs_source_filename: null,
    bs_extracted_at: null,
    bs_warnings: [],
    ...overrides,
  }
}

describe('real data', () => {
  it('counts an income statement with any of sales, total income or a profit line', () => {
    expect(hasRealIncomeStatement({ income: { sales: 0 } })).toBe(true)
    expect(hasRealIncomeStatement({ totals: { totalIncome: 1 } })).toBe(true)
    expect(hasRealIncomeStatement({ totals: { profitBeforeTax: -5 } })).toBe(true)
    expect(hasRealIncomeStatement({ totals: { netProfitAfterTax: 2 } })).toBe(true)
  })

  it('does not count a stub, an empty object or null', () => {
    expect(hasRealIncomeStatement(STUB_IS)).toBe(false)
    expect(hasRealIncomeStatement({})).toBe(false)
    expect(hasRealIncomeStatement(null)).toBe(false)
    // Expenses alone are not enough: the backfill does not look at them.
    expect(hasRealIncomeStatement({ expenses: { rent: 10 } })).toBe(false)
  })

  it('counts a balance sheet by any of its four headline totals', () => {
    for (const key of ['totalAssets', 'totalLiabilities', 'netAssets', 'totalEquity']) {
      expect(hasRealBalanceSheet({ totals: { [key]: 0 } })).toBe(true)
    }
    expect(hasRealBalanceSheet(STUB_BS)).toBe(false)
    expect(hasRealBalanceSheet({ currentAssets: { bankAccounts: 5 } })).toBe(false)
  })
})

describe('warningHalf', () => {
  it.each([
    ['incomeStatement', 'income_statement'],
    ['Income > Other Revenue', 'income_statement'],
    ['Cost of Sales', 'income_statement'],
    ['Expenses', 'income_statement'],
    ['balanceSheet', 'balance_sheet'],
    ['Current Assets', 'balance_sheet'],
    ['Non-Current Liabilities > Loans', 'balance_sheet'],
    ['Equity', 'balance_sheet'],
  ])('%s -> %s', (section, half) => {
    expect(warningHalf(section)).toBe(half)
  })

  it.each([undefined, null, '', 'weird', 'totals', 'currentPeriod'])('%s -> neither', (section) => {
    expect(warningHalf(section)).toBeNull()
  })
})

describe('toStoredSlot: legacy rows', () => {
  it('treats a row with no per-half owner as legacy, both halves from its document', () => {
    const slot = toStoredSlot(row())
    expect(isLegacyRow(row())).toBe(true)
    expect(slot.legacy).toBe(true)
    expect(slot.incomeStatement?.documentId).toBe('doc-legacy')
    expect(slot.balanceSheet?.documentId).toBe('doc-legacy')
    expect(slot.incomeStatement?.sourceFilename).toBe('synthetic.pdf')
    expect(slot.balanceSheet?.extractedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('drops a stub half — the leftover of one file overwriting the other', () => {
    const slot = toStoredSlot(row({ income_statement: STUB_IS }))
    expect(slot.incomeStatement).toBeNull()
    expect(slot.balanceSheet).not.toBeNull()
  })

  it('splits its warnings by section, and keeps the rest on the slot', () => {
    const slot = toStoredSlot(
      row({
        extraction_warnings: [
          { kind: 'totals_reconciliation', message: 'a', section: 'incomeStatement' },
          { kind: 'missing_total', message: 'b', section: 'Current Assets' },
          { kind: 'unmapped_line_item', message: 'c', section: 'weird' },
          { kind: 'unmapped_line_item', message: 'd' },
        ],
      }),
    )
    expect(slot.incomeStatement?.warnings.map((w) => w.message)).toEqual(['a'])
    expect(slot.balanceSheet?.warnings.map((w) => w.message)).toEqual(['b'])
    expect(slot.slotWarnings.map((w) => w.message)).toEqual(['c', 'd'])
  })

  it('tolerates a non-array warnings value', () => {
    expect(toStoredSlot(row({ extraction_warnings: { odd: true } })).slotWarnings).toEqual([])
  })
})

describe('toStoredSlot: split rows', () => {
  const split = row({
    document_id: 'doc-legacy',
    extraction_warnings: [{ kind: 'unmapped_line_item', message: 'slot-level', section: 'weird' }],
    is_document_id: 'doc-pnl',
    is_source_filename: 'pnl.pdf',
    is_extracted_at: '2026-02-01T00:00:00.000Z',
    is_warnings: [{ kind: 'totals_reconciliation', message: 'pnl', section: 'incomeStatement' }],
    bs_document_id: 'doc-bs',
    bs_source_filename: 'bs.pdf',
    bs_extracted_at: '2026-02-02T00:00:00.000Z',
    bs_warnings: [],
  })

  it('takes each half from its own document, not the legacy column', () => {
    const slot = toStoredSlot(split)
    expect(slot.legacy).toBe(false)
    expect(slot.incomeStatement).toMatchObject({
      documentId: 'doc-pnl',
      sourceFilename: 'pnl.pdf',
      extractedAt: '2026-02-01T00:00:00.000Z',
    })
    expect(slot.balanceSheet).toMatchObject({ documentId: 'doc-bs', sourceFilename: 'bs.pdf' })
    expect(slot.incomeStatement?.warnings.map((w) => w.message)).toEqual(['pnl'])
    expect(slot.slotWarnings.map((w) => w.message)).toEqual(['slot-level'])
  })

  it('leaves out a half with no owner, even when stub data is still stored', () => {
    // A backfilled row: the BS half was a stub, so it got no owner.
    const slot = toStoredSlot({ ...split, bs_document_id: null, balance_sheet: STUB_BS })
    expect(slot.legacy).toBe(false)
    expect(slot.balanceSheet).toBeNull()
    expect(slot.incomeStatement?.documentId).toBe('doc-pnl')
  })

  it('leaves out a half whose data was cleared', () => {
    const slot = toStoredSlot({ ...split, income_statement: null })
    expect(slot.incomeStatement).toBeNull()
  })

  it('carries the slot fields through, current period included', () => {
    const slot = toStoredSlot({
      ...split,
      source_column: 'current_period',
      financial_year: 2026,
      period_end_date: '2026-05-04',
      period_start_date: '2025-07-01',
      period_label: '1 July 2025 to 4 May 2026',
    })
    expect(slot).toMatchObject({
      sourceColumn: 'current_period',
      financialYear: 2026,
      periodEndDate: '2026-05-04',
      periodStartDate: '2025-07-01',
      periodLabel: '1 July 2025 to 4 May 2026',
      extractionModel: 'model-x',
    })
  })
})
