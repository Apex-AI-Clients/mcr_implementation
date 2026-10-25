/**
 * Server-only. The comparison summary: Claude (openrouterClient.ts) writes 4–6
 * sentences from the as-printed figures of the key figures staff confirmed
 * (printed/mapping.ts), and nothing else. No PDF, no unconfirmed suggestion,
 * no figure a person has not confirmed the line of.
 *
 * Not written while the AI features are off, while a printed total that does
 * not add up is unticked (Needs review), or before two years and at least one
 * confirmed figure are on file (summaryBlock). Every dollar figure in the
 * answer must be one of the figures given, or the difference between two
 * (checkedSummary.ts); otherwise it is written again once, then a summary
 * without figures is used.
 */
import { aiSummariesEnabled } from './openrouterClient'
import { BANNED_WORDS_INSTRUCTION } from './wording'
import { COMPARISON_SUMMARY_PROMPT_TEMPLATE } from './prompts'
import { writeCheckedSummary } from './checkedSummary'
import { columnTitle } from '@/lib/printed/csv'
import { resolveMeaning, type MappingEntry, type ResolvedMeaning } from '@/lib/printed/mapping'
import { KEY_FIGURES, MEANING } from '@/lib/printed/meanings'
import { printedExportsLocked } from '@/lib/printed/review'
import type { PrintedComparison } from '@/lib/printed/compare'
import type { FiguresChecked } from '@/lib/financials/hardChecks'

export type SummaryBlock = 'ai_off' | 'needs_review' | 'too_few_years' | 'no_confirmed_figures'

export const SUMMARY_BLOCK_MESSAGE: Record<SummaryBlock, string> = {
  ai_off: 'The AI summary is off.',
  needs_review: 'The summary is written once the figures that do not add up have been checked.',
  too_few_years: 'The summary is written once two years are on file.',
  no_confirmed_figures: 'The summary is written from the confirmed key figures: confirm them first.',
}

/** The confirmed key figures, as printed: the only figures a summary is written from. */
export function confirmedFigures(comparison: PrintedComparison, mapping: MappingEntry[]): ResolvedMeaning[] {
  return KEY_FIGURES.map((m) => resolveMeaning(comparison, mapping, m.key)).filter((r) => r.status === 'mapped' && r.years.some((y) => y.value !== null))
}

const money = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`

/** The prompt, from the confirmed figures. Null when there is nothing confirmed to summarise. */
export function comparisonSummaryPrompt(comparison: PrintedComparison, mapping: MappingEntry[]): string | null {
  const figures = confirmedFigures(comparison, mapping)
  if (figures.length === 0) return null
  const rows = comparison.columns.flatMap((column, i) => {
    const parts = figures.flatMap((f) => (f.years[i].value === null ? [] : [`${MEANING[f.meaning].label}: ${money(f.years[i].value as number)}`]))
    if (parts.length === 0) return []
    const { title, period } = columnTitle(column)
    const name = column.kind === 'annual' ? `${title} (${period})` : `Current period, partial year (${period})`
    return [`- ${name}: ${parts.join('; ')}`]
  })
  const none = KEY_FIGURES.filter((m) => mapping.some((e) => e.meaning === m.key && e.nonePrinted)).map((m) => m.label)
  return COMPARISON_SUMMARY_PROMPT_TEMPLATE.replaceAll('{bannedWordsInstruction}', BANNED_WORDS_INSTRUCTION)
    .replaceAll('{figuresTable}', rows.join('\n'))
    .replaceAll('{notPrinted}', none.length ? `\nNot printed in these statements: ${none.join('; ')}.\n` : '')
}

/** Why no summary may be written now, or null. */
export function summaryBlock(input: { comparison: PrintedComparison; mapping: MappingEntry[]; builtAt: string | null; checked: FiguresChecked | null }): SummaryBlock | null {
  if (!aiSummariesEnabled()) return 'ai_off'
  if (printedExportsLocked(input.comparison, input.builtAt, input.checked)) return 'needs_review'
  if (input.comparison.annualYears < 2) return 'too_few_years'
  if (confirmedFigures(input.comparison, input.mapping).length === 0) return 'no_confirmed_figures'
  return null
}

/** Direction only, no figures: used when the model's figures do not check out twice. */
export function summaryWithoutFigures(comparison: PrintedComparison, mapping: MappingEntry[]): string {
  const sentences: string[] = []
  const annual = comparison.columns.map((c, i) => [c, i] as const).filter(([c]) => c.kind === 'annual')
  for (const f of confirmedFigures(comparison, mapping)) {
    const shown = annual.filter(([, i]) => f.years[i].value !== null)
    if (shown.length < 2) continue
    const [first, firstI] = shown[0]
    const [last, lastI] = shown[shown.length - 1]
    const a = f.years[firstI].value as number
    const b = f.years[lastI].value as number
    const word = b > a ? 'rose' : b < a ? 'fell' : 'was unchanged'
    sentences.push(`${MEANING[f.meaning].label} ${word} between ${first.key} and ${last.key}.`)
  }
  sentences.push('The automated summary could not be confirmed against the figures, so the figures are in the tables below.')
  return sentences.join(' ')
}

export async function generateComparisonSummary(comparison: PrintedComparison, mapping: MappingEntry[]): Promise<{ text: string; model: string }> {
  const prompt = comparisonSummaryPrompt(comparison, mapping)
  if (!prompt) throw new Error('No confirmed key figures to summarise.')
  return writeCheckedSummary({
    prompt,
    label: 'comparison-summary',
    maxTokens: 350,
    withoutFigures: () => summaryWithoutFigures(comparison, mapping),
  })
}
