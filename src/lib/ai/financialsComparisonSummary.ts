/**
 * Server-only. Calls Gemini 2.5 Flash via OpenRouter to write a 4-6 sentence
 * narrative summary of the multi-year financial comparison. Mirrors
 * lodgementSummary.ts.
 *
 * Every dollar figure in the summary is checked against the figures it was
 * given (summaryFigures.ts). A summary with a figure that is not one of them,
 * or the difference between two, is regenerated once with the stray figures
 * named; if that fails too, a summary without figures is used instead.
 *
 * Must only be imported from API routes.
 */
import {
  OPENROUTER_NARRATIVE_MODEL,
  FINANCIALS_COMPARISON_SUMMARY_PROMPT_TEMPLATE,
} from './prompts'
import { getOpenRouterClient } from './openrouterClient'
import { summaryWithoutFigures, unsupportedFigures } from './summaryFigures'
import type { FinancialsComparison } from '@/lib/financials/types'

function formatNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A'
  return value.toLocaleString('en-AU', { maximumFractionDigits: 0 })
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A'
  return `${value.toFixed(1)}%`
}

/** Optional addendum to the comparison prompt when a current-period snapshot
 *  is present. Returns an empty string when no current-period data exists so
 *  the placeholders are never sent unfilled. */
function buildCurrentPeriodPromptSection(comparison: FinancialsComparison): string {
  const cp = comparison.currentPeriod
  if (!cp) return ''

  const revenue = comparison.headlines.revenue.currentPeriodValue ?? null
  const netProfit = comparison.headlines.netProfit.currentPeriodValue ?? null
  const directorLoans = comparison.headlines.directorLoansReceivable.currentPeriodValue ?? null

  return `\n\nA current partial period (${cp.periodLabel}) is also available for this client.\nCurrent period figures:\n - Revenue YTD: $${formatNum(revenue)}\n - Net profit YTD: $${formatNum(netProfit)}\n - ATO debt at period end: $${formatNum(cp.atoLiabilityTotal)}\n - Director loans receivable at period end: $${formatNum(directorLoans)}\n\nIf material, mention briefly how the current period is tracking vs FY${comparison.years[comparison.years.length - 1] ?? ''} — but flag explicitly that this is a partial period not a full year. Do NOT include current-period figures in your year-over-year growth statements. Keep the rest of your narrative focused on the four-year annual trajectory.`
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
    const equity = comparison.equityByYear?.[fy]
    const paidOut = [
      equity?.distributions != null ? `distributions paid $${formatNum(equity.distributions)}` : null,
      equity?.dividends != null ? `dividends paid $${formatNum(equity.dividends)}` : null,
    ].filter(Boolean)

    lines.push(
      `- FY${fy}: Revenue $${formatNum(revenue)}, Net profit/(loss) $${formatNum(
        netProfit,
      )}, ATO-related debt $${formatNum(atoTotal)} (${formatPercent(
        ratios.atoDebtAsPercentOfRevenue,
      )} of revenue), Director loans receivable $${formatNum(dirLoans)} (${formatPercent(
        ratios.directorLoansAsPercentOfAssets,
      )} of assets), Net assets $${formatNum(netAssets)}, Retained earnings at year end $${formatNum(
        equity?.retainedEarnings ?? null,
      )}${paidOut.length ? `, ${paidOut.join(', ')}` : ''}`,
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

  const prompt =
    FINANCIALS_COMPARISON_SUMMARY_PROMPT_TEMPLATE
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
      ) +
    // No sum of profits is given: it was being reported as retained earnings.
    // The real retained earnings are in the year table.
    buildCurrentPeriodPromptSection(comparison)

  const client = getOpenRouterClient({ timeoutMs: 60_000 })
  const ask = async (content: string) => {
    const response = await client.chat.completions.create({
      model: OPENROUTER_NARRATIVE_MODEL,
      max_tokens: 350,
      messages: [{ role: 'user', content }],
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

  const first = await ask(prompt)
  const stray = unsupportedFigures(first.text, comparison)
  if (stray.length === 0) return first

  const second = await ask(
    `${prompt}\n\nYour previous summary stated ${stray.join(', ')}, which ${stray.length === 1 ? 'is' : 'are'} not in the figures above or the difference between two of them. Write it again using only those figures.`,
  )
  if (unsupportedFigures(second.text, comparison).length === 0) return second

  return { text: summaryWithoutFigures(comparison), model: `${second.model} (figures withheld)` }
}
