import { describe, it, expect, vi, beforeEach } from 'vitest'
import { statedFigures, summaryWithoutFigures, unsupportedFigures } from '../summaryFigures'
import type { FinancialsComparison, HeadlineMetric } from '@/lib/financials/types'

/**
 * The AI summary's figure check. SYNTHETIC figures shaped like the trust
 * client: three years' profits whose sum is NOT the retained earnings.
 */

const mockCreate = vi.fn()
vi.mock('../openrouterClient', () => ({
  getOpenRouterClient: () => ({ chat: { completions: { create: mockCreate } } }),
}))
const { generateFinancialsComparisonSummary } = await import('../financialsComparisonSummary')

function metric(trend: Array<number | null>, direction: HeadlineMetric['direction'] = 'up'): HeadlineMetric {
  return {
    key: 'revenue',
    label: '',
    latestValue: trend.at(-1) ?? null,
    formatted: '',
    trend,
    yoyPercent: null,
    absoluteChange: null,
    severity: 'watch',
    direction,
  }
}

// Profits 52,100 + 48,300 + 55,800 = 156,200: the figure that must never appear.
const comparison = {
  years: [2023, 2024, 2025],
  periodRange: { start: '2022-07-01', end: '2025-06-30' },
  headlines: {
    revenue: metric([800_000, 850_000, 900_000]),
    netProfit: metric([52_100, 48_300, 55_800]),
    netAssets: metric([-90_000, -20_000, 10_000]),
    atoDebtTrajectory: metric([60_000, 70_000, 65_000], 'flat'),
    directorLoansReceivable: metric([0, 0, 0], 'flat'),
  },
  ratiosByYear: Object.fromEntries([2023, 2024, 2025].map((y) => [y, { atoDebtAsPercentOfRevenue: 8, directorLoansAsPercentOfAssets: 0 }])),
  atoLiabilityByYear: { 2023: { byKey: {}, total: 60_000 }, 2024: { byKey: {}, total: 70_000 }, 2025: { byKey: {}, total: 65_000 } },
  incomeStatementDiffs: [],
  balanceSheetDiffs: [],
  cumulativeProfitBeforeTax: 156_200,
  equityByYear: {
    2023: { retainedEarnings: -116_215, distributions: null, dividends: null },
    2024: { retainedEarnings: -4_682, distributions: null, dividends: null },
    2025: { retainedEarnings: 0, distributions: 16_996, dividends: null },
  },
} as unknown as FinancialsComparison

beforeEach(() => mockCreate.mockReset())

describe('statedFigures', () => {
  it('reads plain, abbreviated and negative figures', () => {
    expect(statedFigures('over $156,000, a loss of -$4,682, $1.2 million and $52k').map((f) => f.value)).toEqual([
      156_000, 4_682, 1_200_000, 52_000,
    ])
  })
})

describe('unsupportedFigures', () => {
  it('accepts input figures, differences of two, and rounding', () => {
    const text =
      'Revenue grew from $800,000 to $900,000, up $100,000. Retained earnings moved from -$116,215 to $0 after a $16,996 distribution. Net profit was about $56k.'
    expect(unsupportedFigures(text, comparison)).toEqual([])
  })

  it('rejects a sum of profits presented as retained earnings', () => {
    expect(unsupportedFigures('accumulating over $156,000 in retained earnings', comparison)).toEqual(['$156,000'])
    expect(unsupportedFigures('retained earnings of $123,456', comparison)).toEqual(['$123,456'])
  })
})

describe('generateFinancialsComparisonSummary', () => {
  const reply = (content: string) => ({ choices: [{ message: { content } }], model: 'test-model' })

  it('passes the real retained earnings and distributions to the model', async () => {
    mockCreate.mockResolvedValueOnce(reply('A summary.'))
    await generateFinancialsComparisonSummary({ comparison })
    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('Retained earnings at year end $-116,215')
    expect(prompt).toContain('distributions paid $16,996')
    expect(prompt).toMatch(/NEVER describe a sum of profits as retained earnings/)
    // The sum of the years' profits is not given at all.
    expect(prompt).not.toContain('156,200')
  })

  it('regenerates once when a figure does not check out, naming it', async () => {
    mockCreate.mockResolvedValueOnce(reply('Retained earnings reached $123,456.'))
    mockCreate.mockResolvedValueOnce(reply('Revenue rose from $800,000 to $900,000.'))
    const result = await generateFinancialsComparisonSummary({ comparison })
    expect(result.text).toBe('Revenue rose from $800,000 to $900,000.')
    expect(mockCreate).toHaveBeenCalledTimes(2)
    expect(mockCreate.mock.calls[1][0].messages[0].content).toContain('$123,456')
  })

  it('falls back to a summary without figures when the second try fails too', async () => {
    mockCreate.mockResolvedValue(reply('Retained earnings reached $123,456.'))
    const result = await generateFinancialsComparisonSummary({ comparison })
    expect(result.text).not.toMatch(/\$/)
    expect(result.text).toMatch(/revenue rose/)
    expect(result.model).toMatch(/figures withheld/)
  })
})

describe('summaryWithoutFigures', () => {
  it('states directions and counts only', () => {
    const text = summaryWithoutFigures(comparison)
    expect(text).toMatch(/3 profitable years and 0 loss years/)
    expect(text).not.toMatch(/\$/)
  })
})
