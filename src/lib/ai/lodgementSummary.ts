/**
 * Server-only. Calls the Claude API to write a 3-5 sentence plain-language
 * summary covering compliance, DPN risk, and debt composition.
 * Must only be imported from API routes.
 */
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODEL, LODGEMENT_SUMMARY_PROMPT_TEMPLATE } from './prompts'
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

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const message = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 250,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('')
    .trim()

  return { text, model: message.model }
}
