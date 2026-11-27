/**
 * Server-only (askClaude). The key-figure choice (item 9b, Gabby 24 Nov 2026;
 * the user's conditions, 26 Nov 2026): Claude chooses the printed lines for
 * the key figures, from labels and headings only.
 *
 * What is sent: each printed line's label and the headings above it, with
 * every name masked by role (maskLabels.ts), long digit strings and street
 * addresses masked. Never an amount, an ABN / ACN, a file name or a document.
 * The answer's placeholders are turned back into names here, on our side.
 *
 * The AI only fills gaps (the user, 26 Nov 2026): only figures the rules chose
 * no line for are asked, twice, and a line both asks agree on is only ever
 * OFFERED to staff ("Possible line — use it?"), never chosen
 * (printed/keyFigureDecision.ts). Off (or failing): the rules decide alone;
 * failures go to the developer alert.
 */
import { askClaude } from './openrouterClient'
import { KEY_FIGURE_CHOICE_PROMPT_TEMPLATE } from './prompts'
import { LabelMasker, namesUnknownPlaceholder, type MaskRecords } from './maskLabels'
import { MEANING, type Meaning } from '@/lib/printed/meanings'
import { STATEMENT_NAME } from '@/lib/printed/picker'
import type { ComparisonRow, PrintedComparison } from '@/lib/printed/compare'

/** The key figures Claude chooses. The two loan figures are asked as one: our sign rule splits them. */
export const AI_KEY_FIGURES = ['related_loans', 'net_profit', 'total_current_assets', 'total_non_current_assets', 'total_assets', 'income_tax_payable'] as const
export type AiKeyFigure = (typeof AI_KEY_FIGURES)[number]

/** The meanings each asked figure decides. */
export const AI_FIGURE_MEANINGS: Record<AiKeyFigure, Meaning[]> = {
  related_loans: ['loan_receivable', 'loan_payable'],
  net_profit: ['net_profit'],
  total_current_assets: ['total_current_assets'],
  total_non_current_assets: ['total_non_current_assets'],
  total_assets: ['total_assets'],
  income_tax_payable: ['income_tax_payable'],
}

const FIGURE_TEXT: Record<AiKeyFigure, string> = {
  related_loans:
    'related_loans (Balance sheet, several lines): every line of a loan or current account between the business and its directors, owners, partners, shareholders, beneficiaries, the [client]\'s trust or a related company: loans to or from them, their drawings, funds or capital introduced, their share of profit, unpaid distributions. Not bank, equipment or vehicle finance, not credit cards, not share capital, not retained earnings, not a total.',
  net_profit: `net_profit (Profit and loss, one line): ${MEANING.net_profit.label}. ${MEANING.net_profit.hint}`,
  total_current_assets: `total_current_assets (Balance sheet, one line): ${MEANING.total_current_assets.label}. ${MEANING.total_current_assets.hint}`,
  total_non_current_assets: `total_non_current_assets (Balance sheet, one line): ${MEANING.total_non_current_assets.label}. ${MEANING.total_non_current_assets.hint}`,
  total_assets: `total_assets (Balance sheet, one line): ${MEANING.total_assets.label}. ${MEANING.total_assets.hint}`,
  income_tax_payable: `income_tax_payable (Balance sheet, several lines): ${MEANING.income_tax_payable.label}. ${MEANING.income_tax_payable.hint}`,
}

const FIGURE_STATEMENT: Record<AiKeyFigure, keyof typeof STATEMENT_NAME> = {
  related_loans: 'balance_sheet',
  net_profit: 'profit_and_loss',
  total_current_assets: 'balance_sheet',
  total_non_current_assets: 'balance_sheet',
  total_assets: 'balance_sheet',
  income_tax_payable: 'balance_sheet',
}
const ONE_LINE: ReadonlySet<AiKeyFigure> = new Set(['net_profit', 'total_current_assets', 'total_non_current_assets', 'total_assets'])

export interface MaskedLine {
  id: number
  row: ComparisonRow
  statement: keyof typeof STATEMENT_NAME
  /** As sent: statement › masked headings › masked label. */
  text: string
  /** Names someone not on our records ([person n]): never auto-chosen. */
  unknownPerson: boolean
}

/** Claude's answer for one figure, checked for shape, with names restored (our side only). */
export interface AiFigureAnswer {
  kind: 'lines' | 'not_printed' | 'unclear'
  rowKeys: string[]
  reason: string
}
export type AiKeyFigureAnswer = Partial<Record<AiKeyFigure, AiFigureAnswer>>

const printed = (r: ComparisonRow) => r.cells.some((c) => c.printed && typeof c.value === 'number')

/** The lines sent, masked: printed lines and totals of both statements, in printed order. */
export function maskedLines(comparison: PrintedComparison, masker: LabelMasker): MaskedLine[] {
  let id = 0
  return comparison.tables
    .filter((t) => t.kind === 'profit_and_loss' || t.kind === 'balance_sheet')
    .flatMap((t) =>
      t.rows
        .filter((r) => r.style !== 'heading' && r.style !== 'ratio' && r.label.trim() !== '' && printed(r))
        .map((row) => {
          const statement = t.kind as keyof typeof STATEMENT_NAME
          const parts = [...row.path.filter((p) => p.trim() !== '').map((p) => masker.mask(p.trim())), masker.mask(row.label.trim())]
          const text = `${STATEMENT_NAME[statement]} › ${parts.join(' › ')}${row.style === 'total' || row.style === 'subtotal' ? ' (total)' : ''}`
          return { id: ++id, row, statement, text, unknownPerson: namesUnknownPlaceholder(masker.mask(row.label.trim())) }
        }),
    )
}

export function keyFigurePrompt(figures: AiKeyFigure[], lines: MaskedLine[]): string {
  return KEY_FIGURE_CHOICE_PROMPT_TEMPLATE.replaceAll('{meanings}', figures.map((f) => `- ${FIGURE_TEXT[f]}`).join('\n')).replaceAll(
    '{lines}',
    lines.map((l) => `${l.id}: ${l.text}`).join('\n'),
  )
}

/** The answer, checked: only offered ids on the figure's statement; one line for a one-line figure; else unclear. */
export function parseKeyFigureAnswer(text: string, figures: AiKeyFigure[], lines: MaskedLine[], masker: LabelMasker): AiKeyFigureAnswer {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}
  const out: AiKeyFigureAnswer = {}
  for (const f of figures) {
    const a = (parsed as Record<string, unknown>)[f]
    if (!a || typeof a !== 'object') continue
    const item = a as { lines?: unknown; notPrinted?: unknown; unclear?: unknown; reason?: unknown }
    const reason = masker.restore(typeof item.reason === 'string' ? item.reason.replace(/\s+/g, ' ').trim().slice(0, 240) : '')
    const ids = Array.isArray(item.lines) ? [...new Set(item.lines.filter((x): x is number => typeof x === 'number'))] : []
    const offered = ids.map((id) => lines.find((l) => l.id === id && l.statement === FIGURE_STATEMENT[f]))
    const rowKeys = offered.filter((l): l is MaskedLine => !!l).map((l) => l.row.key)
    if (item.unclear === true) {
      out[f] = { kind: 'unclear', rowKeys, reason }
    } else if (item.notPrinted === true && ids.length === 0) {
      out[f] = { kind: 'not_printed', rowKeys: [], reason }
    } else if (rowKeys.length > 0 && offered.every(Boolean) && !(ONE_LINE.has(f) && rowKeys.length > 1)) {
      out[f] = { kind: 'lines', rowKeys, reason }
    } else {
      // Lines not offered, on the wrong statement, several for a one-line figure, or nothing at all.
      out[f] = { kind: 'unclear', rowKeys, reason }
    }
  }
  return out
}

export interface KeyFigureChoice {
  answer: AiKeyFigureAnswer
  /** Lines naming someone not on our records ([person n]), by row key. */
  unknownPersonLines: Set<string>
  model: string
}

/**
 * The answers two separate asks agree on (the user, 26 Nov 2026: "ask twice; offer only if both
 * answers agree"). A figure counts only when both say the same kind and, for lines, the same set of
 * lines; the first ask's reason is kept. Current Claude models refuse a temperature setting, so
 * agreement between two asks is the consistency check.
 */
export function agreedAnswers(a: AiKeyFigureAnswer, b: AiKeyFigureAnswer): AiKeyFigureAnswer {
  const out: AiKeyFigureAnswer = {}
  for (const f of AI_KEY_FIGURES) {
    const x = a[f]
    const y = b[f]
    if (!x || !y || x.kind !== y.kind) continue
    const same = x.rowKeys.length === y.rowKeys.length && x.rowKeys.every((k) => y.rowKeys.includes(k))
    if (x.kind === 'lines' && !same) continue
    out[f] = x
  }
  return out
}

/**
 * Asks Claude (purpose 'labels', the label model) about the gap figures only, twice, and keeps only
 * what both asks agree on. Throws when the AI is off or a call fails: the caller keeps the rules alone.
 */
export async function chooseKeyFigures(comparison: PrintedComparison, records: MaskRecords, figures: AiKeyFigure[]): Promise<KeyFigureChoice | null> {
  if (figures.length === 0) return null
  const masker = new LabelMasker(records)
  const lines = maskedLines(comparison, masker)
  if (lines.length === 0) return null
  const prompt = keyFigurePrompt(figures, lines)
  const ask = (n: number) => askClaude({ purpose: 'labels', prompt, maxTokens: 900, label: `key-figure-gaps-${n}`, timeoutMs: 45_000 })
  const first = await ask(1)
  const second = await ask(2)
  return {
    answer: agreedAnswers(parseKeyFigureAnswer(first.text, figures, lines, masker), parseKeyFigureAnswer(second.text, figures, lines, masker)),
    unknownPersonLines: new Set(lines.filter((l) => l.unknownPerson).map((l) => l.row.key)),
    model: first.model,
  }
}
