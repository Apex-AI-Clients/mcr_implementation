import { describe, it, expect } from 'vitest'
import { buildCoverage } from '../coverage'
import type {
  ExtractedBalanceSheet,
  ExtractedIncomeStatement,
  FinancialStatementSourceColumn,
  StoredStatementSlot,
} from '../types'

/** The coverage table's data. SYNTHETIC slots. */

const IS = { income: { sales: 1 }, cogs: {}, expenses: {}, totals: {} } as ExtractedIncomeStatement
const BS = { totals: { totalAssets: 1 } } as unknown as ExtractedBalanceSheet

function slot(
  year: number,
  column: FinancialStatementSourceColumn,
  halves: { is?: string; bs?: string },
  over: Partial<StoredStatementSlot> = {},
): StoredStatementSlot {
  const half = <T,>(data: T, doc?: string) =>
    doc ? { data, documentId: doc, sourceFilename: `${doc}.pdf`, extractedAt: null, warnings: [] } : null
  return {
    id: `${year}-${column}`,
    financialYear: year,
    periodEndDate: `${year}-06-30`,
    periodStartDate: null,
    periodLabel: null,
    sourceColumn: column,
    incomeStatement: half(IS, halves.is),
    balanceSheet: half(BS, halves.bs),
    slotWarnings: [],
    legacy: false,
    extractionModel: null,
    ...over,
  }
}

const statuses = (coverage: ReturnType<typeof buildCoverage>) => ({
  columns: coverage.columns.map((c) => (c.extra ? `${c.label}*` : c.label)),
  pnl: coverage.rows.income_statement.map((c) => c.status),
  bs: coverage.rows.balance_sheet.map((c) => c.status),
})

describe('buildCoverage', () => {
  it('shows own files, comparatives and missing halves for the four years asked for', () => {
    const coverage = buildCoverage([
      slot(2025, 'primary', { is: 'pnl-25' }),
      slot(2024, 'comparative', { is: 'pnl-25', bs: 'pnl-25' }),
      slot(2023, 'primary', { is: 'all-23', bs: 'all-23' }),
    ])
    expect(statuses(coverage)).toEqual({
      columns: ['FY2022', 'FY2023', 'FY2024', 'FY2025'],
      pnl: ['missing', 'own', 'comparative', 'own'],
      bs: ['missing', 'own', 'comparative', 'missing'],
    })
  })

  it('names the file behind each cell, for the hover', () => {
    const coverage = buildCoverage([slot(2025, 'primary', { is: 'pnl-25', bs: 'bs-25' })])
    const last = coverage.columns.length - 1
    expect(coverage.rows.income_statement[last]).toEqual({ status: 'own', filename: 'pnl-25.pdf', documentId: 'pnl-25' })
    expect(coverage.rows.balance_sheet[last].filename).toBe('bs-25.pdf')
  })

  it('marks years older than the four used as extra, and keeps gaps visible', () => {
    const coverage = buildCoverage(
      [2019, 2021, 2023, 2024, 2025].map((y) => slot(y, 'primary', { is: `d${y}`, bs: `d${y}` })),
    )
    expect(statuses(coverage).columns).toEqual(['FY2019*', 'FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025'])
    expect(statuses(coverage).pnl).toEqual(['own', 'own', 'missing', 'own', 'own', 'own'])
  })

  it('adds the current period as its own column', () => {
    const coverage = buildCoverage([
      slot(2025, 'primary', { is: 'a', bs: 'a' }),
      slot(2026, 'current_period', { is: 'cp-pnl' }, { periodLabel: '1 July 2025 to 4 May 2026' }),
    ])
    const last = coverage.columns[coverage.columns.length - 1]
    expect(last).toMatchObject({ kind: 'current_period', label: 'Current period', periodLabel: '1 July 2025 to 4 May 2026' })
    expect(coverage.rows.income_statement.at(-1)?.status).toBe('own')
    expect(coverage.rows.balance_sheet.at(-1)?.status).toBe('missing')
  })

  it('is empty with nothing stored', () => {
    expect(buildCoverage([])).toEqual({ columns: [], rows: { income_statement: [], balance_sheet: [] } })
  })
})

describe('failed extraction', () => {
  it('marks a cell "failed" when a file prints the column but it could not be read', () => {
    const coverage = buildCoverage(
      [slot(2024, 'primary', { is: 'pnl', bs: 'bs' }), slot(2023, 'comparative', { is: 'pnl' })],
      [{ financialYear: 2023, sourceColumn: 'comparative', half: 'balance_sheet' }],
    )
    const i = coverage.columns.findIndex((c) => c.financialYear === 2023)
    expect(coverage.rows.balance_sheet[i].status).toBe('failed')
    expect(coverage.rows.income_statement[i].status).toBe('comparative')
  })

  it('keeps "missing" when no file prints it, and never overrides data that is there', () => {
    const coverage = buildCoverage(
      [slot(2024, 'primary', { is: 'pnl', bs: 'bs' })],
      [{ financialYear: 2024, sourceColumn: 'primary', half: 'balance_sheet' }],
    )
    const last = coverage.columns.length - 1
    expect(coverage.rows.balance_sheet[last].status).toBe('own')
    expect(coverage.rows.balance_sheet[0].status).toBe('missing')
  })
})
