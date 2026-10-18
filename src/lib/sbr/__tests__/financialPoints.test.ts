import { describe, it, expect } from 'vitest'
import { BANNED_WORDS, financialPoints, isMaterial, money } from '../financialPoints'
import type { DiffRow, FinancialsComparison } from '@/lib/financials/types'

/** "What the financial statements show" — each rule. Synthetic figures only. */

type Values = Record<string, (number | null)[]>

/**
 * A comparison over the given years: each key's values per year, and
 * optionally a current-period value (balance-sheet keys).
 */
function comparison(years: number[], values: Values, current?: Record<string, number>): FinancialsComparison {
  const row = (key: string, list: (number | null)[]): DiffRow => ({
    canonicalKey: key,
    label: key,
    valuesByYear: Object.fromEntries(years.map((y, i) => [y, list[i] ?? null])),
    yoyPercentByYear: {},
    absoluteChangeOldestToLatest: null,
    direction: 'flat',
    ...(current ? { currentPeriodValue: current[key] ?? null } : {}),
  })
  const rows = Object.entries(values).map(([k, v]) => row(k, v))
  return {
    years,
    periodRange: { start: '', end: '' },
    headlines: {} as never,
    ratiosByYear: {},
    atoLiabilityByYear: {},
    incomeStatementDiffs: [{ category: 'Totals', rows: rows.filter((r) => ['totalIncome', 'profitBeforeTax', 'wagesAndSalaries', 'superannuation'].includes(r.canonicalKey)) }],
    balanceSheetDiffs: [{ category: 'Balance', rows: rows.filter((r) => !['totalIncome', 'profitBeforeTax', 'wagesAndSalaries', 'superannuation'].includes(r.canonicalKey)) }],
    cumulativeProfitBeforeTax: 0,
    ...(current
      ? {
          currentPeriod: {
            periodLabel: '1 July 2026 to 30 September 2026',
            periodStartDate: '2026-07-01',
            periodEndDate: '2026-09-30',
            financialYear: 2027,
            atoLiabilityTotal: 0,
          },
        }
      : {}),
  }
}

const Y = [2023, 2024, 2025, 2026]
const points = (c: FinancialsComparison, entityType: string | null = 'company') => financialPoints({ comparison: c, entityType })
const rule = (c: FinancialsComparison, r: string, entityType?: string | null) =>
  points(c, entityType).find((p) => p.rule === r)?.text ?? null

describe('materiality', () => {
  it('needs $10,000 AND 20%', () => {
    expect(isMaterial(50_000, 60_000)).toBe(true) // +10,000, +20%
    expect(isMaterial(50_000, 59_999)).toBe(false) // under $10,000
    expect(isMaterial(100_000, 115_000)).toBe(false) // +15%
    expect(isMaterial(0, 10_000)).toBe(true)
    expect(isMaterial(-100_000, -50_000)).toBe(true)
  })

  it('formats whole dollars, negatives with a minus', () => {
    expect(money(1234.5)).toBe('$1,235')
    expect(money(-36178)).toBe('-$36,178')
  })
})

describe('(a) ATO-related debt — always shown, super excluded', () => {
  it('states the trend and what is included', () => {
    const c = comparison(Y, { atoLiability: [100_000, null, null, 140_000], gstPayable: [9_301, null, null, 10_143], superannuationPayable: [50_000, null, null, 1] })
    expect(rule(c, 'a')).toBe(
      'ATO-related debt (ATO account, GST and PAYG withholding; excluding super) rose from $109,301 (FY2023) to $150,143 (FY2026).',
    )
  })

  it('adds the current period', () => {
    const c = comparison(Y, { atoLiability: [100_000, 0, 0, 150_000] }, { atoLiability: 186_000 })
    expect(rule(c, 'a')).toMatch(/to \$150,000 \(FY2026\), and was \$186,000 at 30 Sept 2026 \(current period\)\.$/)
  })

  it('says "went" when the change is not material, and still gives the figures', () => {
    const c = comparison(Y, { atoLiability: [100_000, null, null, 105_000] })
    expect(rule(c, 'a')).toBe(
      'ATO-related debt (ATO account, GST and PAYG withholding; excluding super) went from $100,000 (FY2023) to $105,000 (FY2026).',
    )
  })

  it('says so when there is none', () => {
    expect(rule(comparison(Y, {}), 'a')).toMatch(/^The balance sheets show no ATO-related debt/)
  })

  it('handles a single year', () => {
    const c = comparison([2026], { atoLiability: [42_000] })
    expect(rule(c, 'a')).toBe('ATO-related debt (ATO account, GST and PAYG withholding; excluding super) was $42,000 in FY2026.')
  })
})

describe('(b) assets bought while ATO-related debt rose', () => {
  const base = { atoLiability: [109_301, 161_559, 107_306, 150_143] }

  it('fires on plant & equipment (client-c shape)', () => {
    const c = comparison(Y, { ...base, propertyPlantEquipment: [138_683, 103_565, 165_562, 269_741] })
    expect(rule(c, 'b')).toBe(
      'Property, plant & equipment rose from $138,683 (FY2023) to $269,741 (FY2026) while ATO-related debt (ATO account, GST and PAYG withholding; excluding super) rose from $109,301 to $150,143.',
    )
    expect(points(c)[0].rule).toBe('b')
  })

  it('does not fire when ATO-related debt did not rise materially', () => {
    const c = comparison(Y, { atoLiability: [100_000, 0, 0, 105_000], propertyPlantEquipment: [100_000, 0, 0, 300_000] })
    expect(rule(c, 'b')).toBeNull()
  })

  it('does not count loans to directors as assets bought (client-b shape)', () => {
    const c = comparison(Y, {
      atoLiability: [68_000, 90_000, 136_000, 206_000],
      propertyPlantEquipment: [159_000, 260_000, 191_000, 140_000],
      totalNonCurrentAssets: [159_000, 260_000, 316_000, 288_000],
      directorRelatedLoansReceivable: [29_000, 58_000, 125_000, 148_000],
    })
    expect(rule(c, 'b')).toBeNull()
  })

  it('falls back to other non-current assets when plant & equipment did not rise', () => {
    const c = comparison(Y, {
      ...base,
      propertyPlantEquipment: [100_000, 0, 0, 100_000],
      totalNonCurrentAssets: [120_000, 0, 0, 300_000],
      directorRelatedLoansReceivable: [20_000, 0, 0, 30_000],
    })
    expect(rule(c, 'b')).toMatch(/^Non-current assets other than loans to directors rose from \$100,000 \(FY2023\) to \$270,000 \(FY2026\)/)
  })
})

describe('(c) and (d) related-party loans', () => {
  it('(c) loans owed to directors or related parties, with the current period', () => {
    const c = comparison(Y, { directorRelatedLoansPayable: [92_898, null, null, 763_544] }, { directorRelatedLoansPayable: 779_948 })
    expect(rule(c, 'c')).toBe(
      'Loans owed to directors or related parties rose from $92,898 (FY2023) to $763,544 (FY2026), and were $779,948 at 30 Sept 2026 (current period).',
    )
  })

  it('(c) not when they fell', () => {
    expect(rule(comparison(Y, { directorRelatedLoansPayable: [281_000, 0, 0, 83_000] }), 'c')).toBeNull()
  })

  it('(d) loans owed to the business, just above and just below the threshold', () => {
    expect(rule(comparison(Y, { directorRelatedLoansReceivable: [50_000, 0, 0, 60_000] }), 'd')).toMatch(/^Loans owed to the business by directors/)
    expect(rule(comparison(Y, { directorRelatedLoansReceivable: [50_000, 0, 0, 59_999] }), 'd')).toBeNull()
  })
})

describe('(e) losses — the threshold decides whether, never the facts', () => {
  it('counts EVERY loss year and the true total (client-b: 3 of 4, not 1 of 4)', () => {
    const c = comparison(Y, { profitBeforeTax: [16_000, -1_152, -34_836, -190] })
    expect(rule(c, 'e')).toBe('The company made a loss in 3 of the 4 years compared (FY2024, FY2025 and FY2026), $36,178 in total.')
  })

  it('does not show small losses that add up to less than $10,000', () => {
    expect(rule(comparison(Y, { profitBeforeTax: [16_000, -1_152, -4_000, 2_000] }), 'e')).toBeNull()
  })

  it('shows a move from profit to a loss of $5,000 or more, with the full count', () => {
    const c = comparison(Y, { profitBeforeTax: [16_000, 20_000, 3_000, -5_000] })
    expect(rule(c, 'e')).toBe(
      'The company made a loss in 1 of the 4 years compared (FY2026), $5,000 in total, including FY2026 after a profit in FY2025.',
    )
  })

  it('names the entity type', () => {
    const c = comparison(Y, { profitBeforeTax: [-50_000, -50_000, null, null] })
    expect(rule(c, 'e', 'trust')).toMatch(/^The trust made a loss in 2 of the 2 years/)
    expect(rule(c, 'e', null)).toMatch(/^The business made a loss/)
  })
})

describe('(f) net assets', () => {
  it('says a deficit as one, including the current period', () => {
    const c = comparison(Y, { netAssets: [-46_000, 0, 0, -82_000] }, { netAssets: -74_000 })
    expect(rule(c, 'f')).toBe(
      'Liabilities exceeded assets by $82,000 in FY2026; in FY2023 liabilities exceeded assets by $46,000; at 30 Sept 2026 (current period), liabilities exceeded assets by $74,000.',
    )
  })

  it('reports a material change in positive net assets', () => {
    expect(rule(comparison(Y, { netAssets: [100_000, 0, 0, 40_000] }), 'f')).toBe('Net assets fell from $100,000 (FY2023) to $40,000 (FY2026).')
  })

  it('stays quiet about a small change in positive net assets', () => {
    expect(rule(comparison(Y, { netAssets: [100_000, 0, 0, 95_000] }), 'f')).toBeNull()
  })
})

describe('(g) revenue against ATO-related debt', () => {
  const ato = { atoLiability: [26_000, 0, 0, 73_000] }

  it('fires when revenue grew 5% or less', () => {
    expect(rule(comparison(Y, { ...ato, totalIncome: [255_000, 0, 0, 267_750] }), 'g')).toMatch(/^Revenue went from \$255,000 \(FY2023\) to \$267,750/)
  })

  it('does not fire when revenue grew more than 5%', () => {
    expect(rule(comparison(Y, { ...ato, totalIncome: [255_000, 0, 0, 268_000] }), 'g')).toBeNull()
  })
})

describe('(h) wages and super against what is owing', () => {
  it('fires only when both rose materially', () => {
    const both = comparison(Y, {
      wagesAndSalaries: [70_000, 0, 0, 100_000],
      superannuation: [6_000, 0, 0, 11_000],
      superannuationPayable: [5_000, 0, 0, 20_000],
      paygWithholdingPayable: [5_000, 0, 0, 10_000],
    })
    expect(rule(both, 'h')).toBe(
      'Wages and super expense rose from $76,000 (FY2023) to $111,000 (FY2026) while super and PAYG withholding owing rose from $10,000 to $30,000.',
    )
    const owingFlat = comparison(Y, { wagesAndSalaries: [70_000, 0, 0, 100_000], superannuationPayable: [5_000, 0, 0, 6_000] })
    expect(rule(owingFlat, 'h')).toBeNull()
  })
})

describe('order, limit and wording', () => {
  const busy = comparison(
    Y,
    {
      atoLiability: [100_000, 0, 0, 200_000],
      propertyPlantEquipment: [100_000, 0, 0, 300_000],
      directorRelatedLoansPayable: [50_000, 0, 0, 200_000],
      directorRelatedLoansReceivable: [10_000, 0, 0, 90_000],
      profitBeforeTax: [-20_000, -30_000, -40_000, -50_000],
      netAssets: [-10_000, 0, 0, -300_000],
      totalIncome: [500_000, 0, 0, 480_000],
      wagesAndSalaries: [100_000, 0, 0, 200_000],
      superannuationPayable: [10_000, 0, 0, 60_000],
    },
    { atoLiability: 220_000 },
  )

  it('puts b, a, c, d first and shows at most six', () => {
    const shown = points(busy)
    expect(shown.map((p) => p.rule)).toEqual(['b', 'a', 'c', 'd', 'e', 'f'])
  })

  it('never uses a legal conclusion', () => {
    for (const p of points(busy)) expect(BANNED_WORDS.test(p.text)).toBe(false)
    expect(BANNED_WORDS.test('the business may be insolvent')).toBe(true)
  })

  it('handles missing years without inventing figures', () => {
    const gaps = comparison(Y, { atoLiability: [null, 50_000, null, 90_000] })
    expect(rule(gaps, 'a')).toMatch(/from \$50,000 \(FY2024\) to \$90,000 \(FY2026\)/)
  })
})
