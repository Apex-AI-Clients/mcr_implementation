/**
 * Server-only. Claude (openrouterClient.ts) writes a 3-5 sentence
 * plain-language summary covering compliance, director penalty notices, and
 * debt composition, from the analysis's computed figures only (no CSV).
 *
 * The DPN figures are the ATO's notices' own when any are on file
 * (dpn/noticeFigures.ts); otherwise the estimate from the ATO account
 * (computeDpnRisk), labelled as an estimate. The same checks as every summary
 * (checkedSummary.ts): every dollar figure must be one given or the
 * difference of two, and no banned word; written again once, then a summary
 * without figures.
 */
import { LODGEMENT_SUMMARY_PROMPT_TEMPLATE } from './prompts'
import { writeCheckedSummary } from './checkedSummary'
import { BANNED_WORDS_INSTRUCTION } from './wording'
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

/** No figures: used when the model's figures do not check out twice. */
export function lodgementSummaryWithoutFigures(input: {
  dpnRisk: DpnRiskBreakdown
  summary: { numberOfLateLodgements: number; cumulativeDaysLate: number }
  notices?: DpnNoticeFigures | null
}): string {
  const { dpnRisk, summary } = input
  const n = summary.numberOfLateLodgements
  return [
    `Between ${formatMonthYear(dpnRisk.periodStart)} and ${formatMonthYear(dpnRisk.periodEnd)}, ${n} BAS lodgement${n === 1 ? ' was' : 's were'} filed late, ${summary.cumulativeDaysLate} days late in total.`,
    input.notices
      ? `Director penalty notices are on file; their figures are shown below.`
      : `No director penalty notices are on file; the estimate from the ATO account is shown below.`,
    'The automated summary could not be confirmed against the figures, so the debt figures are in the tables below.',
  ].join(' ')
}

/** True when a stored summary was written under the current rules (Claude, checked figures). */
export function isClaudeSummary(model: string | null | undefined): boolean {
  return !!model && model.startsWith('anthropic/')
}

export async function generateLodgementAiSummary(input: {
  dpnRisk: DpnRiskBreakdown
  debtBreakdown: DebtBreakdown
  summary: { numberOfLateLodgements: number; cumulativeDaysLate: number }
  /** The ATO's director penalty notices' figures, when any are on file. */
  notices?: DpnNoticeFigures | null
}): Promise<{ text: string; model: string }> {
  return writeCheckedSummary({
    prompt: lodgementSummaryPrompt(input),
    label: 'lodgement-summary',
    maxTokens: 250,
    withoutFigures: () => lodgementSummaryWithoutFigures(input),
  })
}
