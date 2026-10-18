/**
 * Server-only. Calls Gemini 2.5 Flash via OpenRouter to write a 3-5 sentence
 * plain-language summary covering compliance, director penalty notices, and
 * debt composition. Must only be imported from API routes.
 *
 * The DPN figures are the ATO's notices' own when any are on file
 * (dpn/noticeFigures.ts); otherwise the estimate from the ATO account
 * (computeDpnRisk), labelled as an estimate. A summary that uses a banned
 * word (wording.ts) is asked for once more; then those sentences are removed.
 */
import { OPENROUTER_NARRATIVE_MODEL, LODGEMENT_SUMMARY_PROMPT_TEMPLATE } from './prompts'
import { getOpenRouterClient } from './openrouterClient'
import { BANNED_WORDS_INSTRUCTION, bannedWordsIn, withoutBannedSentences } from './wording'
import type { DpnRiskBreakdown, DebtBreakdown } from '@/lib/analysis/types'
import type { DpnNoticeFigures } from '@/lib/dpn/noticeFigures'

function formatNum(value: number): string {
  return value.toLocaleString('en-AU', { maximumFractionDigits: 0 })
}

function formatMonthYear(isoOrNull: string | null): string {
  if (!isoOrNull) return 'N/A'
  const d = new Date(isoOrNull)
  return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** The DPN lines of the prompt: the notices' figures, or the estimate. */
export function dpnPromptSection(dpnRisk: DpnRiskBreakdown, notices: DpnNoticeFigures | null): string {
  if (notices) {
    return [
      `- Director penalty notices (source: the ATO's director penalty notices, latest issued ${formatDay(notices.issuedOn)}):`,
      `  - Unpaid: $${formatNum(notices.unpaid)}`,
      `  - Removed if an SBR practitioner, administrator or liquidator is appointed, or it is paid, by ${formatDay(notices.deadline)}: $${formatNum(notices.removable)}`,
      `  - Stays with the director unless paid: $${formatNum(notices.staysWithDirector)}`,
      `  - Deadline: ${formatDay(notices.deadline)} (${notices.daysLeft >= 0 ? `${notices.daysLeft} days left` : `passed ${-notices.daysLeft} days ago`})`,
    ].join('\n')
  }
  return [
    `- Director penalty notices: none uploaded. Estimate from the ATO account (not the ATO's figures):`,
    `  - Debt from lodgements filed more than 90 days late: $${formatNum(dpnRisk.totalGrossLate)}`,
    `  - Reduced by later amendments for the same periods: $${formatNum(dpnRisk.totalReducedByAmendments)}`,
    `  - Estimated still owing on those late lodgements: $${formatNum(dpnRisk.totalNetAtRisk)}`,
  ].join('\n')
}

export function lodgementSummaryPrompt(input: {
  dpnRisk: DpnRiskBreakdown
  debtBreakdown: DebtBreakdown
  summary: { numberOfLateLodgements: number; cumulativeDaysLate: number }
  notices?: DpnNoticeFigures | null
}): string {
  const { dpnRisk, debtBreakdown, summary } = input
  return LODGEMENT_SUMMARY_PROMPT_TEMPLATE
    .replaceAll('{bannedWordsInstruction}', BANNED_WORDS_INSTRUCTION)
    .replaceAll('{periodStart}', formatMonthYear(dpnRisk.periodStart))
    .replaceAll('{periodEnd}', formatMonthYear(dpnRisk.periodEnd))
    .replaceAll('{numberOfLateLodgements}', String(summary.numberOfLateLodgements))
    .replaceAll('{cumulativeDaysLate}', String(summary.cumulativeDaysLate))
    .replaceAll('{dpnSection}', dpnPromptSection(dpnRisk, input.notices ?? null))
    .replaceAll('{principalNet}', formatNum(debtBreakdown.principalNet))
    .replaceAll('{interestNet}', formatNum(debtBreakdown.interestNet))
    .replaceAll('{penaltyNet}', formatNum(debtBreakdown.penaltyNet))
    .replaceAll('{auditNet}', formatNum(debtBreakdown.auditNet ?? 0))
    .replaceAll(
      '{paymentsReceived}',
      debtBreakdown.paymentsCount > 0 ? `$${formatNum(debtBreakdown.paymentsReceived)}` : 'none (no payments found in the ATO account)',
    )
}

export async function generateLodgementAiSummary(input: {
  dpnRisk: DpnRiskBreakdown
  debtBreakdown: DebtBreakdown
  summary: { numberOfLateLodgements: number; cumulativeDaysLate: number }
  /** The ATO's director penalty notices' figures, when any are on file. */
  notices?: DpnNoticeFigures | null
}): Promise<{ text: string; model: string }> {
  const prompt = lodgementSummaryPrompt(input)

  // Narrative generation is short — drop the SDK timeout to 60s.
  const client = getOpenRouterClient({ timeoutMs: 60_000 })
  const ask = async (content: string) => {
    const response = await client.chat.completions.create({
      model: OPENROUTER_NARRATIVE_MODEL,
      max_tokens: 250,
      messages: [{ role: 'user', content }],
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

  const first = await ask(prompt)
  const banned = bannedWordsIn(first.text)
  if (banned.length === 0) return first
  const second = await ask(
    `${prompt}\n\nYour previous summary used ${banned.map((w) => `"${w}"`).join(', ')}, which you must never use. Write it again.`,
  )
  return bannedWordsIn(second.text).length === 0 ? second : { ...second, text: withoutBannedSentences(second.text) }
}
