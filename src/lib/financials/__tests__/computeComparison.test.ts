import { describe, it, expect } from 'vitest'
import { computeFinancialsComparison } from '../computeComparison'
import type { ExtractedFinancialStatement } from '../types'
import {
  PARKCON_ALL,
  PARKCON_FY22,
  PARKCON_FY23,
  PARKCON_FY24,
  PARKCON_FY25,
} from './fixtures/parkcon-placeholder'

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
  // Hand-built PARKCON current-period fixture from the merged BS_DOA + PL_DOA
  // export covering 1 July 2025 → 4 May 2026. Headline figures (revenue,
  // gross profit, net profit, ATO-related liabilities total, director loans,
  // net assets) are taken verbatim from the source PDF.
  const currentPeriodMay2026: ExtractedFinancialStatement = {
    sourceFilename: 'PARKCON_current_period_2026.pdf',
    financialYear: 2026,
    periodEndDate: '2026-05-04',
    periodStartDate: '2025-07-01',
    periodLabel: '1 July 2025 to 4 May 2026',
    sourceColumn: 'current_period',
    incomeStatement: {
      income: { sales: 462858.5, interestIncome: null, otherRevenue: null },
      cogs: { purchases: 212047.52, directCosts: null },
      expenses: {
        wagesAndSalaries: 180000,
        superannuation: 20000,
        rent: 24000,
        generalExpenses: 18801.88,
      },
      totals: {
        totalIncome: 462858.5,
        totalCogs: 212047.52,
        grossProfit: 250810.98,
        totalExpenses: 242801.88,
        profitBeforeTax: 8009.1,
        netProfitAfterTax: 8009.1,
      },
    },
    balanceSheet: {
      currentAssets: { bankAccounts: 5000, accountsReceivable: 10000 },
      nonCurrentAssets: {
        propertyPlantEquipment: 60000,
        directorRelatedLoansReceivable: 148313.15,
      },
      currentLiabilities: {
        atoLiability: 178822.17,
        gstPayable: 14002.13,
        paygWithholdingPayable: 21974,
        superannuationPayable: 31978.41,
      },
      nonCurrentLiabilities: { loansAndFinance: 70910.5 },
      equity: { retainedEarnings: -82373.06, shareCapital: 0 },
      totals: {
        totalCurrentAssets: 15000,
        totalNonCurrentAssets: 208313.15,
        totalAssets: 223313.15,
        totalCurrentLiabilities: 246776.71,
        totalNonCurrentLiabilities: 70910.5,
        totalLiabilities: 317687.21,
        netAssets: -94374.06,
        totalEquity: -94374.06,
      },
    },
    rawExtraction: [],
    warnings: [],
  }

  it('exposes currentPeriod separately from years', () => {
    const result = computeFinancialsComparison([
      PARKCON_FY22,
      PARKCON_FY23,
      PARKCON_FY24,
      PARKCON_FY25,
      currentPeriodMay2026,
    ])
    expect(result.years).toEqual([2022, 2023, 2024, 2025])
    expect(result.currentPeriod?.periodLabel).toBe('1 July 2025 to 4 May 2026')
    expect(result.currentPeriod?.financialYear).toBe(2026)
  })

  it('does not include current period in scorecard sparklines', () => {
    const result = computeFinancialsComparison([
      PARKCON_FY22,
      PARKCON_FY23,
      PARKCON_FY24,
      PARKCON_FY25,
      currentPeriodMay2026,
    ])
    expect(result.headlines.revenue.trend).toHaveLength(4)
  })

  it('does not include current period in YoY ratio calculations', () => {
    const result = computeFinancialsComparison([
      PARKCON_FY22,
      PARKCON_FY23,
      PARKCON_FY24,
      PARKCON_FY25,
      currentPeriodMay2026,
    ])
    expect(Object.keys(result.ratiosByYear).map(Number).sort()).toEqual([
      2022, 2023, 2024, 2025,
    ])
  })

  it('PARKCON regression: headlines (annual fields) and ratios unchanged when current period is added', () => {
    const withCurrent = computeFinancialsComparison([
      PARKCON_FY22,
      PARKCON_FY23,
      PARKCON_FY24,
      PARKCON_FY25,
      currentPeriodMay2026,
    ])
    const withoutCurrent = computeFinancialsComparison([
      PARKCON_FY22,
      PARKCON_FY23,
      PARKCON_FY24,
      PARKCON_FY25,
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

describe('computeFinancialsComparison — PARKCON regression', () => {
  // These assertions anchor against the four real PARKCON PDFs in sample pdf/.
  // If any of these fail after refactoring, the methodology is wrong — fix the
  // algorithm, never weaken the test. If the source PDFs change, update the
  // fixture, then update the expected values here verbatim.

  it('headline revenue tracks the published trajectory FY22-FY25', () => {
    const result = computeFinancialsComparison(PARKCON_ALL)
    expect(result.headlines.revenue.latestValue).toBe(851021)
    expect(result.headlines.revenue.trend).toEqual([340856, 740148, 760405, 851021])
    expect(result.headlines.revenue.severity).toBe('good')
    expect(result.headlines.revenue.direction).toBe('up')
  })

  it('headline net profit is the FY25 marginal loss ($190)', () => {
    const result = computeFinancialsComparison(PARKCON_ALL)
    expect(result.headlines.netProfit.latestValue).toBe(-190)
    // -190 is between $0 and -$5,000 -> 'watch'
    expect(result.headlines.netProfit.severity).toBe('watch')
  })

  it('net assets remain deeply negative across the period (FY22 -46k → FY25 -82k)', () => {
    const result = computeFinancialsComparison(PARKCON_ALL)
    expect(result.headlines.netAssets.latestValue).toBe(-82383)
    expect(result.headlines.netAssets.trend).toEqual([-46206, -47357, -82193, -82383])
    expect(result.headlines.netAssets.severity).toBe('concern')
  })

  it('ATO-related debt sum stayed roughly proportional to revenue (28.5% → 28.1%)', () => {
    // Sums atoLiability + gstPayable + paygWithholdingPayable + superannuationPayable.
    // PARKCON: FY22 65,432+2,634+0+29,098 = 97,164 over revenue 340,856 = 28.50%.
    //          FY25 200,422+5,964+0+32,438 = 238,824 over revenue 851,021 = 28.06%.
    // Note: the ATO Liability LINE alone tripled (65k → 200k) but the full ATO
    // payables block grew roughly in line with revenue, so atoDebtTrajectory
    // severity lands on 'watch' not 'concern' under the current rule.
    const result = computeFinancialsComparison(PARKCON_ALL)
    expect(result.ratiosByYear[2022].atoDebtAsPercentOfRevenue).toBeCloseTo(28.5, 0)
    expect(result.ratiosByYear[2025].atoDebtAsPercentOfRevenue).toBeCloseTo(28.1, 0)
    expect(result.headlines.atoDebtTrajectory.severity).toBe('watch')
  })

  it('director loans receivable build-up — $0 FY22 to >40% of assets FY25', () => {
    // This is the single strongest negative SBR signal — locked tight.
    const result = computeFinancialsComparison(PARKCON_ALL)
    expect(result.ratiosByYear[2022].directorLoansAsPercentOfAssets).toBe(0)
    expect(result.ratiosByYear[2025].directorLoansAsPercentOfAssets).toBeGreaterThan(40)
    expect(result.headlines.directorLoansReceivable.latestValue).toBe(148312)
    expect(result.headlines.directorLoansReceivable.severity).toBe('concern')
  })

  it('cumulative profit/(loss) across the four years is negative (-$20,238)', () => {
    // FY22 +15,940; FY23 -1,152; FY24 -34,836; FY25 -190 → -20,238.
    // Three of the four years posted losses, matching the spec narrative.
    const cumulativeProfitLoss = [PARKCON_FY22, PARKCON_FY23, PARKCON_FY24, PARKCON_FY25].reduce(
      (s, fy) => s + (fy.incomeStatement.totals.profitBeforeTax ?? 0),
      0,
    )
    expect(cumulativeProfitLoss).toBe(-20238)
    const result = computeFinancialsComparison(PARKCON_ALL)
    expect(result.cumulativeProfitBeforeTax).toBe(cumulativeProfitLoss)
  })
})
