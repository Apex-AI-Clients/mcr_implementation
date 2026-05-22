/**
 * Server-only. Calls Gemini 2.5 Flash via OpenRouter to write a 4-6 sentence
 * narrative summary of the multi-year financial comparison. Mirrors
 * lodgementSummary.ts.
 *
 * Must only be imported from API routes.
 */
import {
  OPENROUTER_NARRATIVE_MODEL,
  FINANCIALS_COMPARISON_SUMMARY_PROMPT_TEMPLATE,
} from './prompts'
import { getOpenRouterClient } from './openrouterClient'
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

  const client = getOpenRouterClient({ timeoutMs: 60_000 })

  const response = await client.chat.completions.create({
    model: OPENROUTER_NARRATIVE_MODEL,
    max_tokens: 350,
    messages: [{ role: 'user', content: prompt }],
    // @ts-expect-error — OpenRouter `provider` extension not in OpenAI's types.
    provider: {
      order: ['google-ai-studio', 'google-vertex'],
      allow_fallbacks: false,
    },
  })

  const text = response.choices[0]?.message?.content?.trim() ?? ''
  if (!text) {
    throw new Error('generateFinancialsComparisonSummary: OpenRouter returned empty content.')
  }

  return { text, model: response.model }
}
