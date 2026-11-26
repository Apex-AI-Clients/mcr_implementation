import type { ComparisonRow, PrintedComparison } from './compare'
import type { MappingEntry } from './mapping'
import { onCreditSide } from './mapping'
import { MEANING, type Meaning } from './meanings'
import { latestPrinted, type AutoMapping, type PossibleLine } from './autoMapping'
import { AI_FIGURE_MEANINGS, AI_KEY_FIGURES, type AiKeyFigure, type KeyFigureChoice } from '@/lib/ai/keyFigureChoice'

/**
 * Pure. The key-figure decision for each meaning still open (item 9b/9c; the policy the user set
 * on 26 Nov 2026 after the 9d review): the AI only fills gaps, it never overrides the rules.
 *
 *   the rules chose lines            kept exactly; the figure is never sent to the AI
 *   the rules found nothing, or      the AI is asked (twice; only an answer both times agree
 *   only lookalikes ("possible")     on counts) and its lines are OFFERED as "Possible line —
 *                                    use it?", never chosen. The rules' own answer stands
 *                                    ("not printed" stays not printed until staff use a line)
 *   AI off, failed, unsure, or the   the rules alone, exactly as before
 *   two answers differ
 *
 * Loans are one question (both sides): asked only when the rules chose no loan line on either side.
 */

export type DecisionOutcome = 'lines' | 'not_printed' | 'possible'

export interface KeyFigureDecision {
  meaning: Meaning
  outcome: DecisionOutcome
  chosenBy: 'ai' | 'rule'
  /** The auto entries kept in client_line_mappings (outcome 'lines' / 'not_printed'). */
  entries: MappingEntry[]
  possible: PossibleLine[]
  rule: string | null
  aiReason: string | null
}

/** The loan side a line's latest printed amount is read on (mapping.ts readLoanLine: the one sign-aware section rule). */
export function loanSide(row: ComparisonRow, comparison: PrintedComparison): 'loan_receivable' | 'loan_payable' {
  const { value } = latestPrinted(row, comparison.columns)
  const negative = (value ?? 0) < 0
  const debit = onCreditSide(row) ? negative : !negative
  return debit ? 'loan_receivable' : 'loan_payable'
}

/** The rules alone, for one meaning; null when the rules had nothing to decide from (no statement of that kind). */
export function ruleDecision(meaning: Meaning, rules: AutoMapping): KeyFigureDecision | null {
  const entries = rules.entries.filter((e) => e.meaning === meaning)
  const possible = rules.possible[meaning] ?? []
  const rule = [...new Set(entries.map((e) => e.autoRule).filter((r): r is string => !!r))].join(' ') || null
  if (entries.some((e) => !e.nonePrinted)) return { meaning, outcome: 'lines', chosenBy: 'rule', entries, possible, rule, aiReason: null }
  if (entries.some((e) => e.nonePrinted)) return { meaning, outcome: 'not_printed', chosenBy: 'rule', entries, possible, rule, aiReason: null }
  if (possible.length > 0) return { meaning, outcome: 'possible', chosenBy: 'rule', entries: [], possible, rule: null, aiReason: null }
  return null
}

/**
 * The figures the AI may be asked about: those whose open meanings the rules left as a gap (not
 * printed, or only possible lines) and where the rules chose no line for any of its meanings.
 */
export function gapFigures(open: Meaning[], rules: AutoMapping): AiKeyFigure[] {
  return AI_KEY_FIGURES.filter((f) => {
    const meanings = AI_FIGURE_MEANINGS[f]
    const decided = meanings.map((m) => ruleDecision(m, rules))
    if (decided.some((d) => d?.outcome === 'lines')) return false
    return meanings.some((m, i) => open.includes(m) && decided[i] !== null)
  })
}

/** The open meanings the AI may be asked about. */
export function gapMeanings(open: Meaning[], rules: AutoMapping): Meaning[] {
  return gapFigures(open, rules).flatMap((f) => AI_FIGURE_MEANINGS[f].filter((m) => open.includes(m)))
}

export function decideKeyFigures(
  comparison: PrintedComparison,
  open: Meaning[],
  rules: AutoMapping,
  _names: unknown,
  choice: KeyFigureChoice | null,
): KeyFigureDecision[] {
  const rows = new Map(comparison.tables.flatMap((t) => t.rows.map((r) => [r.key, { row: r, kind: t.kind }] as const)))
  // Lines the rules chose for any meaning are spoken for: never offered elsewhere.
  const chosenByRules = new Set(rules.entries.filter((e) => !e.nonePrinted).map((e) => e.rowKey))
  const figures = new Set(gapFigures(open, rules))
  const out: KeyFigureDecision[] = []

  for (const m of open) {
    const d = ruleDecision(m, rules)
    if (!d) continue
    const figure = AI_KEY_FIGURES.find((f) => AI_FIGURE_MEANINGS[f].includes(m))
    const ai = figure && figures.has(figure) ? choice?.answer[figure] : undefined
    if (!ai || ai.kind !== 'lines') {
      out.push(d)
      continue
    }
    const loans = m === 'loan_receivable' || m === 'loan_payable'
    const already = new Set(d.possible.map((p) => p.rowKey))
    const offered: PossibleLine[] = []
    for (const key of ai.rowKeys) {
      const found = rows.get(key)
      if (!found || found.kind !== MEANING[m].statement || found.row.style === 'heading' || found.row.style === 'ratio') continue
      if (chosenByRules.has(key) || already.has(key)) continue
      if (loans && loanSide(found.row, comparison) !== m) continue
      offered.push({
        rowKey: key,
        label: found.row.label.trim() || '(line with no label)',
        ...latestPrinted(found.row, comparison.columns),
        why: `Suggested by AI (asked twice, the same answer both times): ${ai.reason || 'no reason given'}`,
      })
    }
    if (offered.length === 0) {
      out.push(d)
      continue
    }
    // The rules' answer stands: the AI's lines are only offered for staff to use.
    out.push({ ...d, possible: [...d.possible, ...offered], aiReason: ai.reason || null })
  }
  return out
}
