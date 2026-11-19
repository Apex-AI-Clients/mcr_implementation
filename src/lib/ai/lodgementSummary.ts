/**
 * Server-only. Claude (openrouterClient.ts) writes a 3-5 sentence
 * plain-language summary covering compliance, director penalty notices, and
 * debt composition, from the analysis's computed figures only (no CSV).
 *
 * Only proven figures, the ones the page shows: the notices' Unpaid (when
 * every current notice is proven, dpn/proof.ts), the lodgements more than 90
 * days late since the balance was last nil, and the ATO account's composition
 * verified against its own balance (ica/view.ts). The same checks as every summary
 * (checkedSummary.ts): every dollar figure must be one given or the
 * difference of two, and no banned word; written again once, then a summary
 * without figures.
 */
import { LODGEMENT_SUMMARY_PROMPT_TEMPLATE } from './prompts'
import { writeCheckedSummary } from './checkedSummary'
import { BANNED_WORDS_INSTRUCTION } from './wording'
import type { DpnRiskBreakdown } from '@/lib/analysis/types'
import { lateSinceNil } from '@/lib/analysis/lateList'
import type { IcaView } from '@/lib/ica/view'
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

/**
 * The director penalty lines of the prompt, as the page shows them (Gabby, 16 Nov 2026): the notices'
 * Unpaid (Column 3), and the ATO account's lodgements more than 90 days late since the balance was last
 * nil, GST and PAYG withholding each on its own.
 */
export function dpnPromptSection(dpnRisk: DpnRiskBreakdown, notices: DpnNoticeFigures | null): string {
  const late = lateSinceNil(dpnRisk)
  return [
    notices
      ? `- Unpaid on the ATO's director penalty notices (Column 3 of the ${notices.notices} current notice${notices.notices === 1 ? '' : 's'}, latest issued ${formatDay(notices.issuedOn)}${notices.badges.length ? `; ${notices.badges.join(', ')}` : ''}): $${formatNum(notices.unpaid)}`
      : '- Director penalty notices: none uploaded.',
    `- Lodged more than 90 days late ${late.since ? `since the balance was last nil (${formatDay(late.since)})` : '(the balance was never nil in the export)'}, from the ATO account: $${formatNum(late.total)} (GST $${formatNum(late.gst)}, PAYG withholding $${formatNum(late.paygw)}${late.other ? `, other $${formatNum(late.other)}` : ''}; each counted on its own)`,
  ].join('\n')
}

/** The ATO account lines of the prompt: the verified composition, in the ATO's words, and its balance. */
export function accountPromptSection(account: IcaView): string {
  const c = account.composition!
  return [
    `- ATO account, balance brought forward: $${formatNum(c.opening)}`,
    // A line that reduces the balance (payments, remissions, credits) is given as a positive amount, said so.
    ...c.lines.map((l) => `- ATO account, ${l.label}: $${formatNum(Math.abs(l.net))}${l.net < 0 ? ' (reduces the balance)' : ''}`),
    `- The ATO's own balance${account.balanceDate ? ` at ${formatDay(account.balanceDate)}` : ''}: $${formatNum(c.total)}`,
  ].join('\n')
}

export function lodgementSummaryPrompt(input: {
  dpnRisk: DpnRiskBreakdown
  /** The ATO account verified against its own balance (ica/view.ts). */
  account: IcaView
  summary: { numberOfLateLodgements: number; cumulativeDaysLate: number }
  notices?: DpnNoticeFigures | null
}): string {
  const { dpnRisk, summary } = input
  return LODGEMENT_SUMMARY_PROMPT_TEMPLATE
    .replaceAll('{bannedWordsInstruction}', BANNED_WORDS_INSTRUCTION)
    .replaceAll('{periodStart}', formatMonthYear(dpnRisk.periodStart))
    .replaceAll('{periodEnd}', formatMonthYear(dpnRisk.periodEnd))
    .replaceAll('{numberOfLateLodgements}', String(summary.numberOfLateLodgements))
    .replaceAll('{cumulativeDaysLate}', String(summary.cumulativeDaysLate))
    .replaceAll('{dpnSection}', dpnPromptSection(dpnRisk, input.notices ?? null))
    .replaceAll('{accountSection}', accountPromptSection(input.account))
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
      : `No director penalty notices are on file.`,
    'The automated summary could not be confirmed against the figures, so the debt figures are in the tables below.',
  ].join(' ')
}

/** True when a stored summary was written under the current rules (Claude, checked figures). */
export function isClaudeSummary(model: string | null | undefined): boolean {
  return !!model && model.startsWith('anthropic/')
}

/**
 * Written only from proven figures: the ATO account verified against its own balance, and every current
 * notice proven (dpn/proof.ts). Null when either is not: no summary is written.
 */
export function canSummarise(account: IcaView | null | undefined, notices: DpnNoticeFigures | null | undefined): account is IcaView {
  return !!account?.verified && !!account.composition && !(notices?.heldBack ?? false)
}

export async function generateLodgementAiSummary(input: {
  dpnRisk: DpnRiskBreakdown
  account: IcaView
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
