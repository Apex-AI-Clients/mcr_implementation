/**
 * Server-only. Calls the Claude API to write a 4-6 sentence narrative summary
 * of the multi-year financial comparison. Mirrors lodgementSummary.ts.
 *
 * Must only be imported from API routes.
 */
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODEL, FINANCIALS_COMPARISON_SUMMARY_PROMPT_TEMPLATE } from './prompts'
import type { FinancialsComparison } from '@/lib/financials/types'

function formatNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A'
  return value.toLocaleString('en-AU', { maximumFractionDigits: 0 })
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A'
  return `${value.toFixed(1)}%`
}

function buildYearByYearTable(comparison: FinancialsComparison): string {
  const lines: string[] = []
  for (const fy of comparison.years) {
    const ratios = comparison.ratiosByYear[fy]
    const atoTotal = comparison.atoLiabilityByYear[fy]?.total ?? 0
    const revenueTrend = comparison.headlines.revenue.trend
    const idx = comparison.years.indexOf(fy)
    const revenue = revenueTrend[idx] ?? null
    const netProfit = comparison.headlines.netProfit.trend[idx] ?? null
    const netAssets = comparison.headlines.netAssets.trend[idx] ?? null
    const dirLoans = comparison.headlines.directorLoansReceivable.trend[idx] ?? null

    lines.push(
      `- FY${fy}: Revenue $${formatNum(revenue)}, Net profit/(loss) $${formatNum(
        netProfit,
      )}, ATO-related debt $${formatNum(atoTotal)} (${formatPercent(
        ratios.atoDebtAsPercentOfRevenue,
      )} of revenue), Director loans receivable $${formatNum(dirLoans)} (${formatPercent(
        ratios.directorLoansAsPercentOfAssets,
      )} of assets), Net assets $${formatNum(netAssets)}`,
    )
  }
  return lines.join('\n')
}

export async function generateFinancialsComparisonSummary(input: {
  comparison: FinancialsComparison
}): Promise<{ text: string; model: string }> {
  const { comparison } = input

  if (comparison.years.length < 2) {
    throw new Error(
      'generateFinancialsComparisonSummary: need at least 2 years of data to produce a comparison summary.',
    )
  }

  const latestYear = comparison.years[comparison.years.length - 1]
  const latestRatios = comparison.ratiosByYear[latestYear]

  const prompt = FINANCIALS_COMPARISON_SUMMARY_PROMPT_TEMPLATE
    .replaceAll('{yearByYearTable}', buildYearByYearTable(comparison))
    .replaceAll(
      '{atoDebtPctRevenueLatest}',
      formatPercent(latestRatios?.atoDebtAsPercentOfRevenue ?? null),
    )
    .replaceAll(
      '{directorLoansPctAssetsLatest}',
      formatPercent(latestRatios?.directorLoansAsPercentOfAssets ?? null),
    )
    .replaceAll(
      '{netAssetsLatest}',
      formatNum(comparison.headlines.netAssets.latestValue),
    )
    .replaceAll('{numYears}', String(comparison.years.length))
    .replaceAll(
      '{cumulativeProfitLoss}',
      formatNum(comparison.cumulativeProfitBeforeTax),
    )

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.')

  const client = new Anthropic({ apiKey })

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 350,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('')
    .trim()

  return { text, model: message.model }
}
