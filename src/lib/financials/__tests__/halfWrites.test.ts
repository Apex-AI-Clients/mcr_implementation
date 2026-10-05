import { describe, it, expect } from 'vitest'
import { computeFinancialsComparison } from '../computeComparison'
import { toStoredSlot, type FinancialStatementRow } from '../halves'
import { planSlotWrite, type WritingDocument } from '../halfWrites'
import { latestBalanceSheet, mergeAnnualYears, mergeCurrentPeriod } from '../statementSelection'
import type {
  ExtractedBalanceSheet,
  ExtractedFinancialStatement,
  ExtractedIncomeStatement,
  FinancialStatementSourceColumn,
} from '../types'

/**
 * Writing columns half by half, then reading them back, over sequences of
 * documents — the storage scenarios from the brief. SYNTHETIC figures.
 *
 * `Store` is an in-memory financial_statements table: it applies each plan
 * the way comparisonJob does, and deleteDocument() does what the 0026
 * BEFORE DELETE trigger does, so whole sequences can be played out.
 */

const CLIENT = 'client-1'

class Store {
  rows: FinancialStatementRow[] = []
  private uploaded = new Map<string, string>()
  private clock = 0

  doc(id: string, uploadedAt: string): WritingDocument {
    this.uploaded.set(id, uploadedAt)
    return { id, filename: `${id}.pdf`, uploadedAt }
  }

  write(document: WritingDocument, statement: ExtractedFinancialStatement) {
    const existing =
      this.rows.find(
        (r) => r.financial_year === statement.financialYear && r.source_column === statement.sourceColumn,
      ) ?? null
    const plan = planSlotWrite({
      clientId: CLIENT,
      existing,
      statement,
      document,
      uploadedAtOf: (id) => this.uploaded.get(id) ?? null,
      now: new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++)).toISOString(),
    })
    if (plan.op === 'insert') {
      this.rows.push({ ...blankRow(), ...(plan.values as Partial<FinancialStatementRow>), id: `row-${this.rows.length + 1}` })
    } else if (plan.op === 'update') {
      const row = this.rows.find((r) => r.id === plan.id)!
      Object.assign(row, plan.values)
    }
    return plan
  }

  /** The 0026 trigger: clear the halves this document owns, drop rows left with no owner. */
  deleteDocument(id: string) {
    for (const row of this.rows) {
      if (row.is_document_id === id) {
        Object.assign(row, { income_statement: null, is_document_id: null, is_source_filename: null, is_extracted_at: null, is_warnings: [] })
      }
      if (row.bs_document_id === id) {
        Object.assign(row, { balance_sheet: null, bs_document_id: null, bs_source_filename: null, bs_extracted_at: null, bs_warnings: [] })
      }
    }
    this.rows = this.rows.filter(
      (r) => r.is_document_id !== null || r.bs_document_id !== null || (r.document_id !== null && r.document_id !== id),
    )
  }

  slots() {
    return this.rows.map(toStoredSlot)
  }

  slot(year: number, column: FinancialStatementSourceColumn = 'primary') {
    const row = this.rows.find((r) => r.financial_year === year && r.source_column === column)
    return row ? toStoredSlot(row) : null
  }
}

function blankRow(): FinancialStatementRow {
  return {
    id: '',
    client_id: CLIENT,
    financial_year: 0,
    period_end_date: '',
    period_start_date: null,
    period_label: null,
    source_column: 'primary',
    income_statement: null,
    balance_sheet: null,
    document_id: null,
    source_filename: null,
    extracted_at: '',
    extraction_model: null,
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
  }
}

const is = (sales: number): ExtractedIncomeStatement => ({
  income: { sales },
  cogs: {},
  expenses: {},
  totals: { totalIncome: sales, profitBeforeTax: sales / 10 },
})
const bs = (totalAssets: number): ExtractedBalanceSheet => ({
  currentAssets: {},
  nonCurrentAssets: { directorRelatedLoansReceivable: totalAssets / 100 },
  currentLiabilities: { atoLiability: totalAssets / 5 },
  nonCurrentLiabilities: {},
  equity: {},
  totals: { totalAssets, totalLiabilities: totalAssets / 2, netAssets: totalAssets / 2 },
})

function column(
  year: number,
  halves: { is?: number; bs?: number },
  sourceColumn: FinancialStatementSourceColumn = 'primary',
): ExtractedFinancialStatement {
  return {
    financialYear: year,
    periodEndDate: sourceColumn === 'current_period' ? '2026-05-04' : `${year}-06-30`,
    sourceFilename: 'unused',
    sourceColumn,
    incomeStatement: halves.is !== undefined ? is(halves.is) : { income: {}, cogs: {}, expenses: {}, totals: {} },
    balanceSheet: halves.bs !== undefined ? bs(halves.bs) : bs(0),
    rawExtraction: [],
    warnings: [],
    present: { income_statement: halves.is !== undefined, balance_sheet: halves.bs !== undefined },
    ...(sourceColumn === 'current_period' && halves.is !== undefined
      ? { periodLabel: '1 July 2025 to 4 May 2026', periodStartDate: '2025-07-01' }
      : {}),
  }
}

/** A combined file: both halves, primary column plus the prior-year comparative. */
function combined(store: Store, doc: WritingDocument, year: number, sales: number, assets: number) {
  store.write(doc, column(year, { is: sales, bs: assets }))
  store.write(doc, column(year - 1, { is: sales - 1, bs: assets - 1 }, 'comparative'))
}

describe('separate P&L and Balance Sheet files (scenario 2)', () => {
  for (const order of ['P&L first', 'Balance Sheet first']) {
    it(`fills one slot with both halves, ${order}`, () => {
      const store = new Store()
      const pnl = store.doc('pnl-2025', '2026-01-01T00:00:00Z')
      const bsDoc = store.doc('bs-2025', '2026-01-01T00:00:01Z')
      const steps = [() => store.write(pnl, column(2025, { is: 210 })), () => store.write(bsDoc, column(2025, { bs: 140 }))]
      if (order !== 'P&L first') steps.reverse()
      steps.forEach((step) => step())

      expect(store.rows).toHaveLength(1)
      const slot = store.slot(2025)!
      expect(slot.incomeStatement?.documentId).toBe('pnl-2025')
      expect(slot.incomeStatement?.data.income.sales).toBe(210)
      expect(slot.balanceSheet?.documentId).toBe('bs-2025')
      expect(slot.balanceSheet?.data.totals.totalAssets).toBe(140)
    })
  }

  it('never lets a P&L file touch the balance sheet half', () => {
    const store = new Store()
    store.write(store.doc('bs', '2026-01-01T00:00:00Z'), column(2025, { bs: 140 }))
    const plan = store.write(store.doc('pnl', '2026-02-01T00:00:00Z'), column(2025, { is: 210 }))
    expect(plan.decisions).toEqual({ income_statement: 'written', balance_sheet: 'not_in_document' })
    expect(plan.op === 'update' && 'balance_sheet' in plan.values).toBe(false)
  })
})

describe('mixed and partial (scenarios 3, 4)', () => {
  it('a combined file plus a later separate balance sheet: the newer balance sheet wins, the P&L stays', () => {
    const store = new Store()
    combined(store, store.doc('combined-2025', '2026-01-01T00:00:00Z'), 2025, 500, 300)
    store.write(store.doc('bs-2025-v2', '2026-03-01T00:00:00Z'), column(2025, { bs: 333 }))

    const slot = store.slot(2025)!
    expect(slot.incomeStatement?.documentId).toBe('combined-2025')
    expect(slot.balanceSheet?.documentId).toBe('bs-2025-v2')
    expect(slot.balanceSheet?.data.totals.totalAssets).toBe(333)
  })

  it('a P&L with no balance sheet anywhere leaves that half missing, not filled with a stub', () => {
    const store = new Store()
    store.write(store.doc('pnl-2023', '2026-01-01T00:00:00Z'), column(2023, { is: 90 }))
    const merged = mergeAnnualYears(store.slots())
    expect(merged).toHaveLength(1)
    expect(merged[0].sources.balance_sheet).toBeNull()
    expect(merged[0].statement.present).toEqual({ income_statement: true, balance_sheet: false })
    expect(store.rows[0].balance_sheet).toBeNull()
  })
})

describe('re-upload and delete (scenarios 13, 14)', () => {
  it('a re-uploaded file replaces only its own half, and re-running the old file does not put it back', () => {
    const store = new Store()
    const pnl = store.doc('pnl-v1', '2026-01-01T00:00:00Z')
    const bsDoc = store.doc('bs', '2026-01-02T00:00:00Z')
    store.write(pnl, column(2025, { is: 100 }))
    store.write(bsDoc, column(2025, { bs: 50 }))

    const corrected = store.doc('pnl-v2', '2026-02-01T00:00:00Z')
    store.write(corrected, column(2025, { is: 111 }))
    expect(store.slot(2025)!.incomeStatement?.data.income.sales).toBe(111)

    // A full re-run processes every document again, the old upload included.
    const replay = store.write(pnl, column(2025, { is: 100 }))
    expect(replay.decisions.income_statement).toBe('kept_newer_upload')
    expect(store.slot(2025)!.incomeStatement?.documentId).toBe('pnl-v2')
    expect(store.slot(2025)!.balanceSheet?.documentId).toBe('bs')
  })

  it('deleting one file clears only its half; deleting the other removes the slot', () => {
    const store = new Store()
    store.write(store.doc('pnl', '2026-01-01T00:00:00Z'), column(2025, { is: 100 }))
    store.write(store.doc('bs', '2026-01-02T00:00:00Z'), column(2025, { bs: 50 }))

    store.deleteDocument('pnl')
    expect(store.slot(2025)!.incomeStatement).toBeNull()
    expect(store.slot(2025)!.balanceSheet?.documentId).toBe('bs')
    expect(mergeAnnualYears(store.slots())[0].sources.income_statement).toBeNull()

    store.deleteDocument('bs')
    expect(store.rows).toHaveLength(0)
  })

  it('deleting a combined file takes both its halves, and its comparative too', () => {
    const store = new Store()
    combined(store, store.doc('combined', '2026-01-01T00:00:00Z'), 2025, 500, 300)
    store.deleteDocument('combined')
    expect(store.rows).toHaveLength(0)
  })
})

describe('legacy rows (written whole before 0026)', () => {
  function legacyRow(over: Partial<FinancialStatementRow> = {}): FinancialStatementRow {
    return {
      ...blankRow(),
      id: 'legacy-1',
      financial_year: 2025,
      period_end_date: '2025-06-30',
      income_statement: is(100) as unknown as FinancialStatementRow['income_statement'],
      balance_sheet: bs(50) as unknown as FinancialStatementRow['balance_sheet'],
      document_id: 'old-combined',
      source_filename: 'old-combined.pdf',
      extracted_at: '2025-12-01T00:00:00Z',
      ...over,
    }
  }

  it('converts on first write: the untouched half keeps the old document as owner', () => {
    const store = new Store()
    store.doc('old-combined', '2025-11-01T00:00:00Z')
    store.rows.push(legacyRow())
    store.write(store.doc('bs-new', '2026-01-01T00:00:00Z'), column(2025, { bs: 77 }))

    const slot = store.slot(2025)!
    expect(slot.legacy).toBe(false)
    expect(slot.incomeStatement).toMatchObject({ documentId: 'old-combined', extractedAt: '2025-12-01T00:00:00Z' })
    expect(slot.balanceSheet?.documentId).toBe('bs-new')
  })

  it('clears a legacy stub half on conversion instead of giving it an owner', () => {
    const store = new Store()
    store.doc('old-bs', '2025-11-01T00:00:00Z')
    store.rows.push(legacyRow({ income_statement: { income: { sales: null }, totals: {} }, document_id: 'old-bs' }))
    store.write(store.doc('bs-new', '2026-01-01T00:00:00Z'), column(2025, { bs: 77 }))
    expect(store.rows[0].income_statement).toBeNull()
    expect(store.rows[0].is_document_id).toBeNull()
  })

  it('an older upload does not replace a legacy half from a newer one', () => {
    const store = new Store()
    store.doc('old-combined', '2025-11-01T00:00:00Z')
    store.rows.push(legacyRow())
    const plan = store.write(store.doc('even-older', '2025-01-01T00:00:00Z'), column(2025, { is: 1 }))
    expect(plan.op).toBe('skip')
  })
})

describe('reading back (merge)', () => {
  it("takes each half from the year's own file first, else the next year's comparative", () => {
    const store = new Store()
    // FY2025 own file is a P&L only; FY2026's combined file carries FY2025 as its comparative.
    store.write(store.doc('pnl-2025', '2026-01-01T00:00:00Z'), column(2025, { is: 210 }))
    combined(store, store.doc('combined-2026', '2026-01-02T00:00:00Z'), 2026, 500, 300)

    const fy2025 = mergeAnnualYears(store.slots()).find((m) => m.statement.financialYear === 2025)!
    expect(fy2025.sources.income_statement).toMatchObject({ sourceColumn: 'primary', documentId: 'pnl-2025' })
    expect(fy2025.sources.balance_sheet).toMatchObject({ sourceColumn: 'comparative', documentId: 'combined-2026' })
    expect(fy2025.statement.incomeStatement.income.sales).toBe(210)
    expect(fy2025.statement.balanceSheet.totals.totalAssets).toBe(299)
  })

  it('merges separate current-period files into one current-period statement (scenario 7)', () => {
    const store = new Store()
    store.write(store.doc('cp-pnl', '2026-05-05T00:00:00Z'), column(2026, { is: 85.17 }, 'current_period'))
    store.write(store.doc('cp-bs', '2026-05-05T00:00:01Z'), column(2026, { bs: 54.09 }, 'current_period'))
    const current = mergeCurrentPeriod(store.slots())!
    expect(current.statement.sourceColumn).toBe('current_period')
    expect(current.statement.incomeStatement.income.sales).toBe(85.17)
    expect(current.statement.balanceSheet.totals.totalAssets).toBe(54.09)
    expect(current.statement.periodLabel).toBe('1 July 2025 to 4 May 2026')
    expect(mergeAnnualYears(store.slots())).toEqual([])
  })

  it('feeds half-filled years to the comparison without failing', () => {
    const store = new Store()
    store.write(store.doc('pnl-2024', '2026-01-01T00:00:00Z'), column(2024, { is: 200 }))
    store.write(store.doc('bs-2024', '2026-01-01T00:00:01Z'), column(2024, { bs: 100 }))
    store.write(store.doc('pnl-2025', '2026-01-01T00:00:02Z'), column(2025, { is: 250 }))
    const statements = mergeAnnualYears(store.slots()).map((m) => m.statement)
    const comparison = computeFinancialsComparison(statements)
    expect(comparison.years).toEqual([2024, 2025])
    expect(comparison.headlines.revenue.trend).toEqual([200, 250])
  })
})

describe('latestBalanceSheet (prediction readers)', () => {
  it('skips a newer year that has only a P&L', () => {
    const store = new Store()
    store.write(store.doc('bs-2024', '2026-01-01T00:00:00Z'), column(2024, { bs: 100 }))
    store.write(store.doc('pnl-2025', '2026-01-01T00:00:01Z'), column(2025, { is: 250 }))
    expect(latestBalanceSheet(store.slots())?.slot.financialYear).toBe(2024)
  })

  it("prefers a year's own balance sheet over another file's comparative of the same year", () => {
    const store = new Store()
    combined(store, store.doc('combined-2025', '2026-01-01T00:00:00Z'), 2025, 500, 300)
    store.write(store.doc('bs-2024', '2026-01-01T00:00:01Z'), column(2024, { bs: 111 }))
    const latest = latestBalanceSheet(store.slots())!
    expect(latest.slot.financialYear).toBe(2025)
    expect(latest.slot.sourceColumn).toBe('primary')
  })

  it('takes the current-period balance sheet first when asked', () => {
    const store = new Store()
    combined(store, store.doc('combined-2025', '2026-01-01T00:00:00Z'), 2025, 500, 300)
    store.write(store.doc('cp', '2026-05-05T00:00:00Z'), column(2026, { bs: 42 }, 'current_period'))
    expect(latestBalanceSheet(store.slots(), { preferCurrentPeriod: true })?.slot.sourceColumn).toBe('current_period')
    expect(latestBalanceSheet(store.slots(), { preferCurrentPeriod: true })?.balanceSheet.totals.totalAssets).toBe(42)
  })

  it('returns null with no balance sheet at all', () => {
    const store = new Store()
    store.write(store.doc('pnl', '2026-01-01T00:00:00Z'), column(2025, { is: 1 }))
    expect(latestBalanceSheet(store.slots())).toBeNull()
  })
})
