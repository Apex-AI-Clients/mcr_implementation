/**
 * Server-only. Calls Gemini 2.5 Flash via OpenRouter to write a 3-5 sentence
 * plain-language summary covering compliance, DPN risk, and debt composition.
 * Must only be imported from API routes.
 */
import { OPENROUTER_NARRATIVE_MODEL, LODGEMENT_SUMMARY_PROMPT_TEMPLATE } from './prompts'
import { getOpenRouterClient } from './openrouterClient'
import type { DpnRiskBreakdown, DebtBreakdown } from '@/lib/analysis/types'

function formatNum(value: number): string {
  return value.toLocaleString('en-AU', { maximumFractionDigits: 0 })
}

function formatMonthYear(isoOrNull: string | null): string {
  if (!isoOrNull) return 'N/A'
  const d = new Date(isoOrNull)
  return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
}

export async function generateLodgementAiSummary(input: {
  dpnRisk: DpnRiskBreakdown
  debtBreakdown: DebtBreakdown
  summary: { numberOfLateLodgements: number; cumulativeDaysLate: number }
}): Promise<{ text: string; model: string }> {
  const { dpnRisk, debtBreakdown, summary } = input

  const prompt = LODGEMENT_SUMMARY_PROMPT_TEMPLATE
    .replaceAll('{periodStart}', formatMonthYear(dpnRisk.periodStart))
    .replaceAll('{periodEnd}', formatMonthYear(dpnRisk.periodEnd))
    .replaceAll('{numberOfLateLodgements}', String(summary.numberOfLateLodgements))
    .replaceAll('{cumulativeDaysLate}', String(summary.cumulativeDaysLate))
    .replaceAll('{totalGrossLate}', formatNum(dpnRisk.totalGrossLate))
    .replaceAll('{totalReversed}', formatNum(dpnRisk.totalPaidSince))
    .replaceAll('{totalNetAtRisk}', formatNum(dpnRisk.totalNetAtRisk))
    .replaceAll('{principalNet}', formatNum(debtBreakdown.principalNet))
    .replaceAll('{interestNet}', formatNum(debtBreakdown.interestNet))
    .replaceAll('{penaltyNet}', formatNum(debtBreakdown.penaltyNet))
    .replaceAll('{paymentsReceived}', formatNum(debtBreakdown.paymentsReceived))

  // Narrative generation is short — drop the SDK timeout to 60s.
  const client = getOpenRouterClient({ timeoutMs: 60_000 })

  const response = await client.chat.completions.create({
    model: OPENROUTER_NARRATIVE_MODEL,
    max_tokens: 250,
    messages: [{ role: 'user', content: prompt }],
    // @ts-expect-error — OpenRouter `provider` extension not in OpenAI's types.
    provider: {
      order: ['google-ai-studio', 'google-vertex'],
      allow_fallbacks: false,
    },
  })

  const text = response.choices[0]?.message?.content?.trim() ?? ''
  if (!text) {
    throw new Error('generateLodgementAiSummary: OpenRouter returned empty content.')
  }

  return { text, model: response.model }
}
