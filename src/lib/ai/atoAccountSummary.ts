/**
 * Server-only. Claude (openrouterClient.ts) writes a 3-5 sentence summary of
 * an income tax or superannuation guarantee account, from the analysis's
 * computed figures only (atoAccount/), never the CSV.
 *
 * The same checks as every summary (checkedSummary.ts): every dollar figure
 * must be one given or the difference of two, and no banned word — plus, for
 * a super guarantee account, never "lodged by the company" (the export does
 * not say who lodged a statement). Written again once, then a summary without
 * figures.
 */
import { INCOME_TAX_SUMMARY_PROMPT_TEMPLATE, SUPER_GUARANTEE_SUMMARY_PROMPT_TEMPLATE } from './prompts'
import { writeCheckedSummary } from './checkedSummary'
import { BANNED_WORDS_INSTRUCTION } from './wording'
import { unpaidPhrase, type IncomeTaxSummary } from '@/lib/analysis/atoAccount/incomeTax'
import type { SuperGuaranteeSummary } from '@/lib/analysis/atoAccount/superGuarantee'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string | null | undefined) => {
  if (!iso) return 'unknown date'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const num = (n: number) => Math.round(n).toLocaleString('en-AU')

export interface AccountForSummary {
  balance: number | null
  balanceDate: string | null
}

function balanceLine(a: AccountForSummary): string {
  if (a.balance === null) return 'no balance printed'
  const side = a.balance > 0 ? 'owed to the ATO' : a.balance < 0 ? 'in credit' : 'nil'
  return `$${num(Math.abs(a.balance))} ${side}, as at ${day(a.balanceDate)}`
}

function paymentsLine(p: IncomeTaxSummary['payments']): string {
  return p.count === 0 ? 'none (no payments found in the account)' : `${p.count} payments totalling $${num(p.total)}, ${day(p.first)} to ${day(p.last)}`
}

export function incomeTaxSummaryPrompt(account: AccountForSummary, s: IncomeTaxSummary): string {
  const assessments = s.assessments.length
    ? s.assessments
        .map(
          (a) =>
            `  - ${a.period ? `${day(a.period.from)} to ${day(a.period.to)}` : 'Period not printed'}: $${num(a.amount)}, assessed ${day(a.assessedOn)}, payment due ${day(a.paymentDue)}; ${a.unpaid <= 0 ? 'paid' : `$${num(a.unpaid)} ${unpaidPhrase(a) ?? 'unpaid, not yet due'}`}`,
        )
        .join('\n')
    : '  - none'
  return INCOME_TAX_SUMMARY_PROMPT_TEMPLATE.replaceAll('{bannedWordsInstruction}', BANNED_WORDS_INSTRUCTION)
    .replaceAll('{balance}', balanceLine(account))
    .replaceAll('{assessments}', assessments)
    .replaceAll('{payments}', paymentsLine(s.payments))
    .replaceAll('{gicCharged}', num(s.gic.charged))
    .replaceAll('{gicRemitted}', num(s.gic.remitted))
    .replaceAll('{gicNet}', num(s.gic.net))
}

export function superGuaranteeSummaryPrompt(account: AccountForSummary, s: SuperGuaranteeSummary): string {
  const first = s.quarters[0]?.period
  const last = s.quarters.at(-1)?.period
  return SUPER_GUARANTEE_SUMMARY_PROMPT_TEMPLATE.replaceAll('{bannedWordsInstruction}', BANNED_WORDS_INSTRUCTION)
    .replaceAll('{balance}', balanceLine(account))
    .replaceAll('{quarters}', String(s.quarters.length))
    .replaceAll('{firstQuarter}', first ? `the quarter ending ${day(first.to)}` : 'none')
    .replaceAll('{lastQuarter}', last ? `the quarter ending ${day(last.to)}` : 'none')
    .replaceAll('{shortfall}', num(s.totals.shortfall))
    .replaceAll('{nominalInterest}', num(s.totals.nominalInterest))
    .replaceAll('{adminFee}', num(s.totals.adminFee))
    .replaceAll('{sgTotal}', num(s.totals.total))
    .replaceAll('{auditQuarters}', String(s.quartersRaisedBy.ato_audit))
    .replaceAll('{defaultQuarters}', String(s.quartersRaisedBy.ato_default))
    .replaceAll('{clientQuarters}', String(s.quartersRaisedBy.client_amendment))
    .replaceAll('{part7Charged}', num(s.part7.charged))
    .replaceAll('{part7Remitted}', num(s.part7.remitted))
    .replaceAll('{part7Net}', num(s.part7.net))
    .replaceAll('{gicCharged}', num(s.gic.charged))
    .replaceAll('{gicNet}', num(s.gic.net))
    .replaceAll('{payments}', paymentsLine(s.payments))
}

/** Phrases a super guarantee summary must not use: the export does not say who lodged a statement. */
export const SG_FORBIDDEN: readonly RegExp[] = [/lodged by (the|this) (company|client|employer|business)/i]

/** No figures: used when the model's figures do not check out twice. */
export function atoAccountSummaryWithoutFigures(kind: 'income_tax' | 'super_guarantee', summary: IncomeTaxSummary | SuperGuaranteeSummary): string {
  if (kind === 'income_tax') {
    const s = summary as IncomeTaxSummary
    return `The income tax account shows ${s.assessments.length} assessment${s.assessments.length === 1 ? '' : 's'} and ${s.payments.count} payment${s.payments.count === 1 ? '' : 's'}. The automated summary could not be confirmed against the figures, so they are in the tables below.`
  }
  const s = summary as SuperGuaranteeSummary
  return `The superannuation guarantee account shows ${s.quarters.length} quarter${s.quarters.length === 1 ? '' : 's'} with a charge, ${s.quartersRaisedBy.ato_audit} with an ATO audit. The automated summary could not be confirmed against the figures, so they are in the tables below.`
}

export async function generateAtoAccountSummary(
  input: AccountForSummary &
    ({ kind: 'income_tax'; summary: IncomeTaxSummary } | { kind: 'super_guarantee'; summary: SuperGuaranteeSummary }),
): Promise<{ text: string; model: string }> {
  return input.kind === 'income_tax'
    ? writeCheckedSummary({
        prompt: incomeTaxSummaryPrompt(input, input.summary),
        label: 'income-tax-summary',
        maxTokens: 250,
        withoutFigures: () => atoAccountSummaryWithoutFigures('income_tax', input.summary),
      })
    : writeCheckedSummary({
        prompt: superGuaranteeSummaryPrompt(input, input.summary),
        label: 'super-guarantee-summary',
        maxTokens: 250,
        withoutFigures: () => atoAccountSummaryWithoutFigures('super_guarantee', input.summary),
        forbidden: SG_FORBIDDEN,
      })
}
