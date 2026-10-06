import { describe, it, expect } from 'vitest'
import {
  applyYearWindow,
  arithmeticFindings,
  comparableName,
  documentChecks,
  entityChecks,
  restatementChecks,
  rollForwardChecks,
  runChecks,
  type CompanyDetailsForCheck,
  type DocumentRecordForCheck,
} from '../checks'
import { computeFinancialsComparison } from '../computeComparison'
import { toStoredSlot, type FinancialStatementRow } from '../halves'
import { mergeAnnualYears, mergeCurrentPeriod, type MergedStatement } from '../statementSelection'
import type {
  ExtractedBalanceSheet,
  ExtractedFinancialStatement,
  ExtractedIncomeStatement,
  FinancialStatementSourceColumn,
} from '../types'

/**
 * Stage 4: the checks and the year window. SYNTHETIC figures only — the
 * statement builders below invent every number.
 */

// ─── Synthetic statements ─────────────────────────────────────────────────────

function incomeStatement(year: number, scale = 1): ExtractedIncomeStatement {
  const sales = Math.round(1_000_000 * scale + year)
  const purchases = Math.round(sales * 0.4)
  const expenses = { rent: 60_000, wagesAndSalaries: 250_000, depreciation: 15_000 }
  const totalExpenses = Object.values(expenses).reduce((a, b) => a + b, 0)
  const profitBeforeTax = sales - purchases - totalExpenses
  return {
    income: { sales },
    cogs: { purchases },
    expenses,
    totals: {
      totalIncome: sales,
      totalCogs: purchases,
      grossProfit: sales - purchases,
      totalExpenses,
      profitBeforeTax,
      netProfitAfterTax: profitBeforeTax,
    },
  }
}

function balanceSheet(year: number, retainedEarnings: number, scale = 1): ExtractedBalanceSheet {
  const bank = Math.round(80_000 * scale)
  const receivables = Math.round(120_000 * scale)
  const ppe = 200_000
  const loans = 30_000 + (year - 2020) * 5_000
  const ato = Math.round(90_000 * scale)
  const gst = 20_000
  const chattel = 60_000
  const totalCurrentAssets = bank + receivables
  const totalNonCurrentAssets = ppe + loans
  const totalAssets = totalCurrentAssets + totalNonCurrentAssets
  const totalCurrentLiabilities = ato + gst
  const totalLiabilities = totalCurrentLiabilities + chattel
  const netAssets = totalAssets - totalLiabilities
  return {
    currentAssets: { bankAccounts: bank, accountsReceivable: receivables },
    nonCurrentAssets: { propertyPlantEquipment: ppe, directorRelatedLoansReceivable: loans },
    currentLiabilities: { atoLiability: ato, gstPayable: gst },
    nonCurrentLiabilities: { chattelMortgages: chattel },
    equity: { retainedEarnings, shareCapital: netAssets - retainedEarnings },
    totals: {
      totalCurrentAssets,
      totalNonCurrentAssets,
      totalAssets,
      totalCurrentLiabilities,
      totalNonCurrentLiabilities: chattel,
      totalLiabilities,
      netAssets,
      totalEquity: netAssets,
    },
  }
}

function statement(
  year: number,
  sourceColumn: FinancialStatementSourceColumn = 'primary',
  over: Partial<ExtractedFinancialStatement> = {},
): ExtractedFinancialStatement {
  return {
    financialYear: year,
    periodEndDate: `${year}-06-30`,
    sourceFilename: `SYNTH_Tax ${year}_signed.pdf`,
    sourceColumn,
    incomeStatement: incomeStatement(year),
    balanceSheet: balanceSheet(year, 100_000 + (year - 2020) * 10_000),
    rawExtraction: [],
    warnings: [],
    ...over,
  }
}

function merged(s: ExtractedFinancialStatement, docs = { is: `doc-${s.financialYear}`, bs: `doc-${s.financialYear}` }): MergedStatement {
  return {
    statement: s,
    sources: {
      income_statement: { sourceColumn: s.sourceColumn, documentId: docs.is, sourceFilename: s.sourceFilename },
      balance_sheet: { sourceColumn: s.sourceColumn, documentId: docs.bs, sourceFilename: s.sourceFilename },
    },
  }
}

/** A legacy whole row, exactly as the old code stored a combined PDF's column. */
function legacyRow(s: ExtractedFinancialStatement, documentId: string, filename: string): FinancialStatementRow {
  return {
    id: `${documentId}-${s.sourceColumn}`,
    client_id: 'client-1',
    financial_year: s.financialYear,
    period_end_date: s.periodEndDate,
    period_start_date: null,
    period_label: null,
    source_column: s.sourceColumn,
    income_statement: s.incomeStatement as unknown as FinancialStatementRow['income_statement'],
    balance_sheet: s.balanceSheet as unknown as FinancialStatementRow['balance_sheet'],
    document_id: documentId,
    source_filename: filename,
    extracted_at: '2026-01-01T00:00:00Z',
    extraction_model: 'synthetic',
    extraction_warnings: [],
    raw_extraction: null,
    is_document_id: documentId,
    is_source_filename: filename,
    is_extracted_at: '2026-01-01T00:00:00Z',
    is_warnings: [],
    bs_document_id: documentId,
    bs_source_filename: filename,
    bs_extracted_at: '2026-01-01T00:00:00Z',
    bs_warnings: [],
  }
}

// ─── Regression: the combined path ────────────────────────────────────────────

/** Today's read path, kept here verbatim as the reference (comparisonJob before Stage 3). */
function oldReadPath(rows: FinancialStatementRow[]): ExtractedFinancialStatement[] {
  const inferYear = (filename: string) => {
    const match = filename.match(/(?<!\d)(20\d{2})(?!\d)/)
    return match ? parseInt(match[1], 10) : null
  }
  const has = (row: FinancialStatementRow) => {
    const is = (row.income_statement ?? {}) as { income?: { sales?: unknown }; totals?: { totalIncome?: unknown } }
    const bs = (row.balance_sheet ?? {}) as { totals?: { totalAssets?: unknown; netAssets?: unknown } }
    return is.income?.sales != null || is.totals?.totalIncome != null || bs.totals?.totalAssets != null || bs.totals?.netAssets != null
  }
  const uploadedYears = new Set<number>()
  for (const row of rows) {
    const y = inferYear(row.source_filename ?? '')
    if (y !== null) uploadedYears.add(y)
  }
  const byYear = new Map<number, FinancialStatementRow>()
  for (const row of rows.filter((r) => uploadedYears.has(r.financial_year) && has(r))) {
    const existing = byYear.get(row.financial_year)
    if (!existing) {
      byYear.set(row.financial_year, row)
      continue
    }
    const existingMatches = inferYear(existing.source_filename ?? '') === existing.financial_year
    const newMatches = inferYear(row.source_filename ?? '') === row.financial_year
    if (newMatches && !existingMatches) byYear.set(row.financial_year, row)
  }
  return [...byYear.values()]
    .sort((a, b) => a.financial_year - b.financial_year)
    .map((row) => ({
      financialYear: row.financial_year,
      periodEndDate: row.period_end_date,
      sourceFilename: row.source_filename ?? '',
      sourceColumn: row.source_column as 'primary' | 'comparative',
      incomeStatement: row.income_statement as unknown as ExtractedIncomeStatement,
      balanceSheet: row.balance_sheet as unknown as ExtractedBalanceSheet,
      rawExtraction: [],
      warnings: [],
    }))
}

describe('regression: four combined PDFs give the same comparison as before', () => {
  // FY2022–FY2025 combined files, each with its prior-year comparative. FY2023's
  // comparative in the FY2024 file is restated, as real comparatives sometimes are.
  const rows: FinancialStatementRow[] = []
  for (const year of [2022, 2023, 2024, 2025]) {
    const filename = `SYNTH_Tax ${year}_signed.pdf`
    rows.push(legacyRow(statement(year), `doc-${year}`, filename))
    const comparative = statement(year - 1, 'comparative')
    if (year === 2024) comparative.incomeStatement = incomeStatement(2023, 1.1)
    rows.push(legacyRow(comparative, `doc-${year}`, filename))
  }

  it('produces an identical comparison', () => {
    const before = computeFinancialsComparison(oldReadPath(rows))

    const slots = rows.map(toStoredSlot)
    const { used, extraYears } = applyYearWindow(mergeAnnualYears(slots))
    const after = computeFinancialsComparison(used.map((m) => m.statement))

    expect(after).toEqual(before)
    expect(after.years).toEqual([2022, 2023, 2024, 2025])
    // The FY2021 comparative the old filename filter dropped is now kept, as extra.
    expect(extraYears).toEqual([2021])
  })

  it('reports the restated comparative, and nothing else, on this clean data', () => {
    const slots = rows.map(toStoredSlot)
    const all = mergeAnnualYears(slots)
    const { used } = applyYearWindow(all)
    const checks = runChecks({ slots, allAnnual: all, used, current: null, records: [], company: null })
    const warnings = checks.filter((c) => c.severity === 'warning')
    expect(warnings.map((c) => [c.kind, c.financialYear, c.statement])).toEqual([
      ['restatement', 2023, 'income_statement'],
    ])
  })
})

// ─── Year window ──────────────────────────────────────────────────────────────

describe('applyYearWindow', () => {
  it('keeps the latest four and reports older years as extra', () => {
    const all = [2019, 2020, 2021, 2022, 2023, 2024].map((y) => merged(statement(y)))
    const { used, extraYears } = applyYearWindow(all)
    expect(used.map((m) => m.statement.financialYear)).toEqual([2021, 2022, 2023, 2024])
    expect(extraYears).toEqual([2019, 2020])
  })

  it('keeps everything when there are four or fewer, with gaps as they are', () => {
    const { used, extraYears } = applyYearWindow([2021, 2023].map((y) => merged(statement(y))))
    expect(used.map((m) => m.statement.financialYear)).toEqual([2021, 2023])
    expect(extraYears).toEqual([])
  })
})

// ─── Arithmetic (scenario 9) ──────────────────────────────────────────────────

describe('arithmetic checks', () => {
  it('passes balanced statements', () => {
    expect(arithmeticFindings(statement(2025))).toEqual([])
  })

  it('flags totals that do not add up, as the separate-files trust PDFs sometimes have', () => {
    const s = statement(2025)
    s.balanceSheet.totals.totalAssets = (s.balanceSheet.totals.totalAssets ?? 0) + 5_000
    s.incomeStatement.totals.profitBeforeTax = (s.incomeStatement.totals.profitBeforeTax ?? 0) + 900
    const kinds = arithmeticFindings(s).map((f) => [f.statement, f.kind])
    expect(kinds).toEqual([
      ['income_statement', 'totals_reconciliation'],
      ['balance_sheet', 'totals_reconciliation'],
      ['balance_sheet', 'balance_sheet_equation'],
    ])
  })

  it('flags net assets that do not equal total equity', () => {
    const s = statement(2025)
    s.balanceSheet.totals.totalEquity = (s.balanceSheet.totals.netAssets ?? 0) - 1_000
    expect(arithmeticFindings(s)).toEqual([
      expect.objectContaining({ kind: 'balance_sheet_equation', message: expect.stringMatching(/total equity/) }),
    ])
  })

  it('allows the wider current-period tolerance on the balance sheet only', () => {
    const s = statement(2026)
    s.balanceSheet.totals.netAssets = (s.balanceSheet.totals.netAssets ?? 0) + 150
    s.balanceSheet.totals.totalEquity = s.balanceSheet.totals.netAssets
    expect(arithmeticFindings(s, { currentPeriod: true })).toEqual([])
    expect(arithmeticFindings(s)).toHaveLength(1)
  })

  it('skips an identity with a figure missing', () => {
    const s = statement(2025)
    delete s.balanceSheet.totals.totalLiabilities
    expect(arithmeticFindings(s)).toEqual([])
  })
})

// ─── Retained earnings ────────────────────────────────────────────────────────

describe('retained earnings roll-forward', () => {
  const profit = (y: number) => incomeStatement(y).totals.netProfitAfterTax!

  function years(closing2025: number) {
    const fy24 = statement(2024, 'primary', { balanceSheet: balanceSheet(2024, 500_000) })
    const fy25 = statement(2025, 'primary', { balanceSheet: balanceSheet(2025, closing2025) })
    return [merged(fy24), merged(fy25)]
  }

  it('is quiet when opening + profit = closing', () => {
    expect(rollForwardChecks(years(500_000 + profit(2025)), [2025])).toEqual([])
  })

  it('reads a shortfall as a distribution (information)', () => {
    const [check] = rollForwardChecks(years(500_000 + profit(2025) - 40_000), [2025])
    expect(check).toMatchObject({ severity: 'info', financialYear: 2025 })
    expect(check.message).toMatch(/\$40,000/)
  })

  it('warns when retained earnings rise by more than the profit', () => {
    const [check] = rollForwardChecks(years(500_000 + profit(2025) + 25_000), [2025])
    expect(check).toMatchObject({ severity: 'warning', kind: 'retained_earnings_rollforward' })
  })

  it('skips a trust with no retained earnings line', () => {
    const [a, b] = years(0)
    delete a.statement.balanceSheet.equity.retainedEarnings
    expect(rollForwardChecks([a, b], [2025])).toEqual([])
  })
})

// ─── Restatement (scenario 8) ─────────────────────────────────────────────────

describe('restatement', () => {
  function slots(change: (bs: ExtractedBalanceSheet) => void) {
    const own = statement(2024)
    const later = statement(2024, 'comparative')
    later.balanceSheet = balanceSheet(2024, 140_000)
    change(later.balanceSheet)
    return [legacyRow(own, 'doc-2024', 'BS_23-24.pdf'), legacyRow(later, 'doc-2025', 'BS_24-25.pdf')].map(toStoredSlot)
  }

  // These statements have no line lists (extracted before they existed), so
  // only the printed totals are compared — mapping cannot affect totals.
  // Comparison by printed label is covered in assembleComparison.test.ts.
  it('without line lists, compares the printed totals and names both files', () => {
    const [check] = restatementChecks(
      slots((bs) => {
        bs.currentLiabilities.atoLiability = 97_000
        bs.totals.totalCurrentLiabilities = 117_000
      }),
    )
    expect(check).toMatchObject({ kind: 'restatement', financialYear: 2024, statement: 'balance_sheet' })
    expect(check.message).toContain('BS_23-24.pdf')
    expect(check.message).toContain('BS_24-25.pdf')
    expect(check.message).toContain('total current liabilities $110,000 → $117,000')
    expect(check.message).not.toContain('ato liability')
    expect(check.documentIds).toEqual(['doc-2024', 'doc-2025'])
  })

  it('ignores differences within $50 or 0.5%', () => {
    expect(restatementChecks(slots((bs) => (bs.currentAssets.bankAccounts = 80_040)))).toEqual([])
    expect(restatementChecks(slots((bs) => (bs.nonCurrentAssets.propertyPlantEquipment = 200_900)))).toEqual([])
  })
})

// ─── Entity (scenario 10) ─────────────────────────────────────────────────────

const record = (over: Partial<DocumentRecordForCheck> = {}): DocumentRecordForCheck => ({
  documentId: 'doc-1',
  filename: 'statements.pdf',
  kind: 'combined',
  headingEntity: { name: 'SAMPLE TRADING PTY LTD', abns: ['30484621880'] },
  warnings: [],
  ...over,
})

const companyFile: CompanyDetailsForCheck = {
  entityType: 'company',
  companyName: 'Sample Trading Pty. Ltd.',
  abnNumber: '30 484 621 880',
  trustName: null,
  trustAbnNumber: null,
}

const trustFile: CompanyDetailsForCheck = {
  entityType: 'trust',
  companyName: 'Sample Holdings Pty Ltd',
  abnNumber: '30 484 621 880',
  trustName: 'Sample Family Trust',
  trustAbnNumber: '33 114 847 696',
}

describe('entity checks', () => {
  it('passes a company whose heading matches its file, despite punctuation', () => {
    expect(entityChecks([record()], companyFile)).toEqual([])
  })

  it('flags a company heading with another ABN or name', () => {
    const [check] = entityChecks(
      [record({ headingEntity: { name: 'OTHER BUILDERS PTY LTD', abns: ['33114847696'] } })],
      companyFile,
    )
    expect(check.kind).toBe('entity_mismatch')
    expect(check.message).toMatch(/ABN 33114847696/)
    expect(check.message).toMatch(/OTHER BUILDERS/)
  })

  it('passes a trust heading "<CO> ATF <TRUST>" with the trust ABN', () => {
    const heading = { name: 'SAMPLE HOLDINGS PTY LTD ATF SAMPLE FAMILY TRUST', abns: ['33114847696'] }
    expect(entityChecks([record({ headingEntity: heading })], trustFile)).toEqual([])
  })

  it("says so when a trust's statements print the trustee company's ABN instead", () => {
    const heading = { name: 'SAMPLE HOLDINGS PTY LTD ATF SAMPLE FAMILY TRUST', abns: ['30484621880'] }
    const [check] = entityChecks([record({ headingEntity: heading })], trustFile)
    expect(check.message).toMatch(/trustee company's ABN/)
  })

  it('flags a trust heading that names another trust', () => {
    const heading = { name: 'SAMPLE HOLDINGS PTY LTD ATF OTHER UNIT TRUST', abns: [] }
    expect(entityChecks([record({ headingEntity: heading })], trustFile)).toHaveLength(1)
  })

  it('stays quiet with nothing to compare', () => {
    expect(entityChecks([record()], null)).toEqual([])
    expect(entityChecks([record({ headingEntity: null })], companyFile)).toEqual([])
    expect(entityChecks([record({ headingEntity: { name: null, abns: [] } })], companyFile)).toEqual([])
  })

  it('compares names without legal-form words', () => {
    expect(comparableName('The Trustee for SAMPLE FAMILY TRUST')).toBe('sample family trust')
    expect(comparableName('Sample & Co Pty. Ltd.')).toBe('sample and co')
  })
})

// ─── Documents (scenario 11) ──────────────────────────────────────────────────

describe('document checks', () => {
  it('reports a trust deed or a bare tax return in a financials slot', () => {
    const checks = documentChecks([
      record({ documentId: 'deed', filename: 'deed.pdf', kind: 'not_financial' }),
      record({ documentId: 'itr', filename: 'itr.pdf', kind: 'tax_return_only' }),
    ])
    expect(checks.map((c) => [c.kind, c.severity])).toEqual([
      ['not_statements', 'warning'],
      ['not_statements', 'warning'],
    ])
    expect(checks[1].message).toMatch(/tax return/)
  })

  it("surfaces a document's own warnings, with the filename", () => {
    const [check] = documentChecks([
      record({ warnings: [{ kind: 'filename_year_conflict', message: 'The filename suggests FY2023.' }] }),
    ])
    // The headings were used: nothing for staff to do, so a note, not a warning.
    expect(check).toMatchObject({ kind: 'extraction_note', severity: 'info', group: 'filename_year_conflict' })
    expect(check.message).toBe('statements.pdf: The filename suggests FY2023.')
  })
})

// ─── Current period ───────────────────────────────────────────────────────────

describe('runChecks with a current period', () => {
  it('checks the current period separately and marks its findings', () => {
    const cp = statement(2026, 'current_period', { periodEndDate: '2026-05-04' })
    cp.incomeStatement.totals.profitBeforeTax = 1
    const row = legacyRow(cp, 'cp-doc', 'Current period.pdf')
    const slots = [row].map(toStoredSlot)
    const current = mergeCurrentPeriod(slots)
    const checks = runChecks({ slots, allAnnual: [], used: [], current, records: [], company: null })
    expect(checks).toEqual([
      expect.objectContaining({ kind: 'totals_reconciliation', currentPeriod: true, financialYear: 2026 }),
    ])
  })
})

// ─── Stock and distributions (mapping-fix round) ──────────────────────────────

describe('cost of sales with stock', () => {
  function withStock(totalCogs: number) {
    const s = statement(2025)
    s.incomeStatement.cogs = { openingStock: 15_000, purchases: 80_000, closingStock: 20_000 }
    s.incomeStatement.totals.totalCogs = totalCogs
    s.incomeStatement.totals.profitBeforeTax =
      (s.incomeStatement.totals.totalIncome ?? 0) - totalCogs - (s.incomeStatement.totals.totalExpenses ?? 0)
    return s
  }

  it('checks opening + purchases - closing against the total', () => {
    expect(arithmeticFindings(withStock(75_000))).toEqual([])
    expect(arithmeticFindings(withStock(95_000))).toEqual([
      expect.objectContaining({ kind: 'totals_reconciliation', message: expect.stringMatching(/opening stock \$15,000.*closing stock \$20,000 = \$75,000/) }),
    ])
  })
})

describe('roll-forward with distributions read from the P&L', () => {
  const profit = incomeStatement(2025).totals.netProfitAfterTax!
  function years(closing: number, distributions: number) {
    const fy24 = statement(2024, 'primary', { balanceSheet: balanceSheet(2024, 500_000) })
    const fy25 = statement(2025, 'primary', { balanceSheet: balanceSheet(2025, closing) })
    fy25.incomeStatement.appropriations = { distributions }
    return [merged(fy24), merged(fy25)]
  }

  it('is quiet when opening + profit - distributions = closing', () => {
    expect(rollForwardChecks(years(500_000 + profit - 40_000, 40_000), [2025])).toEqual([])
  })

  it('warns either way once distributions are known', () => {
    const [low] = rollForwardChecks(years(500_000 + profit - 70_000, 40_000), [2025])
    expect(low).toMatchObject({ severity: 'warning' })
    expect(low.message).toMatch(/distributions and dividends \$40,000/)
  })
})
