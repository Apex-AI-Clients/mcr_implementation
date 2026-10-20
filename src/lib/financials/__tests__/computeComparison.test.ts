import { describe, it, expect } from 'vitest'
import { computeFinancialsComparison } from '../computeComparison'
import type { ExtractedFinancialStatement } from '../types'
import {
  COMPANY_ALL,
  COMPANY_FY22,
  COMPANY_FY23,
  COMPANY_FY24,
  COMPANY_FY25,
} from './fixtures/combinedCompanyStatements'

function blank(fy: number): ExtractedFinancialStatement {
  return {
    financialYear: fy,
    periodEndDate: `${fy}-06-30`,
    sourceFilename: `${fy}.pdf`,
    sourceColumn: 'primary',
    incomeStatement: { income: {}, cogs: {}, expenses: {}, totals: {} },
    balanceSheet: {
      currentAssets: {},
      nonCurrentAssets: {},
      currentLiabilities: {},
      nonCurrentLiabilities: {},
      equity: {},
      totals: {},
    },
    rawExtraction: [],
    warnings: [],
  }
}

describe('computeFinancialsComparison — synthetic cases', () => {
  it('sorts input by financial year ascending regardless of input order', () => {
    const a = blank(2025)
    const b = blank(2022)
    const c = blank(2024)
    const result = computeFinancialsComparison([a, b, c])
    expect(result.years).toEqual([2022, 2024, 2025])
  })

  it('YoY % uses absolute value of the previous period — sign flips are handled', () => {
    const y1 = blank(2022)
    y1.incomeStatement.income.sales = -100
    y1.incomeStatement.totals.totalIncome = -100
    const y2 = blank(2023)
    y2.incomeStatement.income.sales = 50
    y2.incomeStatement.totals.totalIncome = 50

    const result = computeFinancialsComparison([y1, y2])
    expect(result.headlines.revenue.yoyPercent).toBeCloseTo(150, 1)
  })

  it('headline severities respond to the rule thresholds', () => {
    // Revenue growing healthily -> good
    const a = blank(2024)
    a.incomeStatement.income.sales = 100000
    a.incomeStatement.totals.totalIncome = 100000
    const b = blank(2025)
    b.incomeStatement.income.sales = 120000
    b.incomeStatement.totals.totalIncome = 120000
    const result = computeFinancialsComparison([a, b])
    expect(result.headlines.revenue.severity).toBe('good')

    // Net profit large loss -> concern
    b.incomeStatement.totals.profitBeforeTax = -50000
    const r2 = computeFinancialsComparison([a, b])
    expect(r2.headlines.netProfit.severity).toBe('concern')

    // Director loans 0 -> good
    expect(r2.headlines.directorLoansReceivable.severity).toBe('good')
  })

  it('zero denominators in ratios return null rather than throwing', () => {
    const a = blank(2024)
    const b = blank(2025)
    b.incomeStatement.income.sales = 0
    b.incomeStatement.totals.totalIncome = 0
    b.balanceSheet.totals.totalAssets = 0
    b.balanceSheet.currentLiabilities.atoLiability = 50000

    const result = computeFinancialsComparison([a, b])
    expect(result.ratiosByYear[2025].atoDebtAsPercentOfRevenue).toBeNull()
    expect(result.ratiosByYear[2025].directorLoansAsPercentOfAssets).toBeNull()
    expect(result.ratiosByYear[2025].daysRevenueInAtoDebt).toBeNull()
  })

  it('diff tables exclude rows that are zero or null across all years', () => {
    const a = blank(2024)
    a.incomeStatement.income.sales = 100
    a.incomeStatement.totals.totalIncome = 100
    const b = blank(2025)
    b.incomeStatement.income.sales = 200
    b.incomeStatement.totals.totalIncome = 200

    const result = computeFinancialsComparison([a, b])
    const incomeSection = result.incomeStatementDiffs.find((s) => s.category === 'Income')!
    const presentKeys = incomeSection.rows.map((r) => r.canonicalKey)
    expect(presentKeys).toContain('sales')
    expect(presentKeys).not.toContain('interestIncome') // empty across both years
    expect(presentKeys).not.toContain('otherRevenue')
  })

  it('ATO liability aggregation sums the four ATO-related current liabilities', () => {
    const a = blank(2025)
    a.balanceSheet.currentLiabilities.atoLiability = 100000
    a.balanceSheet.currentLiabilities.gstPayable = 25000
    a.balanceSheet.currentLiabilities.paygWithholdingPayable = 15000
    a.balanceSheet.currentLiabilities.superannuationPayable = 10000

    const result = computeFinancialsComparison([a])
    expect(result.atoLiabilityByYear[2025].total).toBe(150000)
  })

  it('cumulative profitBeforeTax sums across all years', () => {
    const a = blank(2024)
    a.incomeStatement.totals.profitBeforeTax = -1000
    const b = blank(2025)
    b.incomeStatement.totals.profitBeforeTax = -500
    const result = computeFinancialsComparison([a, b])
    expect(result.cumulativeProfitBeforeTax).toBe(-1500)
  })
})

describe('current period handling', () => {
  // SYNTHETIC current period for the same invented company, laid out like a
  // merged balance sheet + P&L export covering 1 July 2025 → 4 May 2026,
  // with cents. Figures invented.
  const currentPeriodMay2026: ExtractedFinancialStatement = {
    sourceFilename: 'SYNTH_Company_current_period_2026.pdf',
    financialYear: 2026,
    periodEndDate: '2026-05-04',
    periodStartDate: '2025-07-01',
    periodLabel: '1 July 2025 to 4 May 2026',
    sourceColumn: 'current_period',
    incomeStatement: {
      income: { sales: 478300.4, interestIncome: null, otherRevenue: null },
      cogs: { purchases: 219880.15, directCosts: null },
      expenses: {
        wagesAndSalaries: 186000,
        superannuation: 21000,
        rent: 25200,
        generalExpenses: 19113.7,
      },
      totals: {
        totalIncome: 478300.4,
        totalCogs: 219880.15,
        grossProfit: 258420.25,
        totalExpenses: 251313.7,
        profitBeforeTax: 7106.55,
        netProfitAfterTax: 7106.55,
      },
    },
    balanceSheet: {
      currentAssets: { bankAccounts: 5000, accountsReceivable: 10000 },
      nonCurrentAssets: {
        propertyPlantEquipment: 60000,
        directorRelatedLoansReceivable: 155961.2,
      },
      currentLiabilities: {
        atoLiability: 184605.3,
        gstPayable: 14560.75,
        paygWithholdingPayable: 22840,
        superannuationPayable: 33120.45,
      },
      nonCurrentLiabilities: { loansAndFinance: 73450.2 },
      equity: { retainedEarnings: -90508.95, shareCapital: 0 },
      totals: {
        totalCurrentAssets: 15000,
        totalNonCurrentAssets: 215961.2,
        totalAssets: 230961.2,
        totalCurrentLiabilities: 255126.5,
        totalNonCurrentLiabilities: 73450.2,
        totalLiabilities: 328576.7,
        netAssets: -97615.5,
        totalEquity: -97615.5,
      },
    },
    rawExtraction: [],
    warnings: [],
  }

  it('exposes currentPeriod separately from years', () => {
    const result = computeFinancialsComparison([
      COMPANY_FY22,
      COMPANY_FY23,
      COMPANY_FY24,
      COMPANY_FY25,
      currentPeriodMay2026,
    ])
    expect(result.years).toEqual([2022, 2023, 2024, 2025])
    expect(result.currentPeriod?.periodLabel).toBe('1 July 2025 to 4 May 2026')
    expect(result.currentPeriod?.financialYear).toBe(2026)
  })

  it('does not include current period in scorecard sparklines', () => {
    const result = computeFinancialsComparison([
      COMPANY_FY22,
      COMPANY_FY23,
      COMPANY_FY24,
      COMPANY_FY25,
      currentPeriodMay2026,
    ])
    expect(result.headlines.revenue.trend).toHaveLength(4)
  })

  it('does not include current period in YoY ratio calculations', () => {
    const result = computeFinancialsComparison([
      COMPANY_FY22,
      COMPANY_FY23,
      COMPANY_FY24,
      COMPANY_FY25,
      currentPeriodMay2026,
    ])
    expect(Object.keys(result.ratiosByYear).map(Number).sort()).toEqual([
      2022, 2023, 2024, 2025,
    ])
  })

  it('regression: headlines (annual fields) and ratios unchanged when current period is added', () => {
    const withCurrent = computeFinancialsComparison([
      COMPANY_FY22,
      COMPANY_FY23,
      COMPANY_FY24,
      COMPANY_FY25,
      currentPeriodMay2026,
    ])
    const withoutCurrent = computeFinancialsComparison([
      COMPANY_FY22,
      COMPANY_FY23,
      COMPANY_FY24,
      COMPANY_FY25,
    ])

    // Strip the additive currentPeriodValue so the annual headline state is
    // compared on equal terms.
    const stripCurrent = (h: typeof withCurrent.headlines) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(h)) {
        const rest = { ...v }
        delete (rest as { currentPeriodValue?: unknown }).currentPeriodValue
        out[k] = rest
      }
      return out
    }

    expect(stripCurrent(withCurrent.headlines)).toEqual(stripCurrent(withoutCurrent.headlines))
    expect(withCurrent.ratiosByYear).toEqual(withoutCurrent.ratiosByYear)
  })

  it('handles current period with no annual data gracefully', () => {
    const result = computeFinancialsComparison([currentPeriodMay2026])
    expect(result.years).toEqual([])
    expect(result.currentPeriod?.financialYear).toBe(2026)
  })
})

describe('computeFinancialsComparison — four-year company regression', () => {
  // These assertions anchor against the SYNTHETIC four-year company fixture.
  // If any of these fail after refactoring, the methodology is wrong — fix the
  // algorithm, never weaken the test. If the fixture changes, recompute the
  // expected values here from it.

  it('headline revenue tracks the published trajectory FY22-FY25', () => {
    const result = computeFinancialsComparison(COMPANY_ALL)
    expect(result.headlines.revenue.latestValue).toBe(869300)
    expect(result.headlines.revenue.trend).toEqual([352410, 728600, 781900, 869300])
    expect(result.headlines.revenue.severity).toBe('good')
    expect(result.headlines.revenue.direction).toBe('up')
  })

  it('headline net profit is the FY25 marginal loss ($270)', () => {
    const result = computeFinancialsComparison(COMPANY_ALL)
    expect(result.headlines.netProfit.latestValue).toBe(-270)
    // -270 is between $0 and -$5,000 -> 'watch'
    expect(result.headlines.netProfit.severity).toBe('watch')
  })

  it('net assets remain deeply negative across the period (FY22 -37k → FY25 -71k)', () => {
    const result = computeFinancialsComparison(COMPANY_ALL)
    expect(result.headlines.netAssets.latestValue).toBe(-71200)
    expect(result.headlines.netAssets.trend).toEqual([-37330, -39670, -70930, -71200])
    expect(result.headlines.netAssets.severity).toBe('concern')
  })

  it('ATO-related debt sum stayed roughly proportional to revenue (28.5% → 28.1%)', () => {
    // Sums atoLiability + gstPayable + paygWithholdingPayable + superannuationPayable.
    // FY22 70,080+2,410+0+27,950 = 100,440 over revenue 352,410 = 28.50%.
    // FY25 204,390+6,180+0+33,700 = 244,270 over revenue 869,300 = 28.10%.
    // Note: the ATO Liability LINE alone almost tripled (70k → 204k) but the full ATO
    // payables block grew roughly in line with revenue, so atoDebtTrajectory
    // severity lands on 'watch' not 'concern' under the current rule.
    const result = computeFinancialsComparison(COMPANY_ALL)
    expect(result.ratiosByYear[2022].atoDebtAsPercentOfRevenue).toBeCloseTo(28.5, 0)
    expect(result.ratiosByYear[2025].atoDebtAsPercentOfRevenue).toBeCloseTo(28.1, 0)
    expect(result.headlines.atoDebtTrajectory.severity).toBe('watch')
  })

  it('director loans receivable build-up — $0 FY22 to >40% of assets FY25', () => {
    // This is the single strongest negative SBR signal — locked tight.
    const result = computeFinancialsComparison(COMPANY_ALL)
    expect(result.ratiosByYear[2022].directorLoansAsPercentOfAssets).toBe(0)
    expect(result.ratiosByYear[2025].directorLoansAsPercentOfAssets).toBeGreaterThan(40)
    expect(result.headlines.directorLoansReceivable.latestValue).toBe(155960)
    expect(result.headlines.directorLoansReceivable.severity).toBe('concern')
  })

  it('cumulative profit/(loss) across the four years is negative (-$21,000)', () => {
    // FY22 +12,870; FY23 -2,340; FY24 -31,260; FY25 -270 → -21,000.
    // Three of the four years posted losses, matching the spec narrative.
    const cumulativeProfitLoss = [COMPANY_FY22, COMPANY_FY23, COMPANY_FY24, COMPANY_FY25].reduce(
      (s, fy) => s + (fy.incomeStatement.totals.profitBeforeTax ?? 0),
      0,
    )
    expect(cumulativeProfitLoss).toBe(-21000)
    const result = computeFinancialsComparison(COMPANY_ALL)
    expect(result.cumulativeProfitBeforeTax).toBe(cumulativeProfitLoss)
  })
})
