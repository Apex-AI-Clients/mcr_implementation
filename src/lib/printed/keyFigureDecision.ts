import type { ComparisonRow, PrintedComparison } from './compare'
import type { MappingEntry } from './mapping'
import { onCreditSide } from './mapping'
import { MEANING, type Meaning } from './meanings'
import { PLAUSIBLE } from './picker'
import { personAccount, suggestMappingWithRules, type RelatedNames } from './dictionary'
import { AUTO_BY, latestPrinted, type AutoMapping, type PossibleLine } from './autoMapping'
import { AI_FIGURE_MEANINGS, AI_KEY_FIGURES, type AiFigureAnswer, type KeyFigureChoice } from '@/lib/ai/keyFigureChoice'

/**
 * Pure. The key-figure decision for each meaning still open (item 9b/9c; the
 * user's conditions, 26 Nov 2026): Claude's choice (ai/keyFigureChoice.ts)
 * with the rules (autoMapping.ts) on top.
 *
 *   AI off, failed, or not asked      the rules alone (chosen_by 'rule'), exactly as before
 *   AI and rules agree                 the lines (chosen_by 'ai'), ⓘ "Chosen by AI: <reason>"
 *   AI resolves what the rules only    the lines that pass the rules' checks (statement, kind
 *   offered (lookalikes)               of line, the loan sign rule)
 *   AI names a line the rules reject,  that line is never chosen: it is a "Possible line — use
 *   or only ever offer (a [person n],  it?"; the lines agreed on still stand
 *   drawings, an unproven total)
 *   AI unclear, AI leaves out a line   nothing chosen: every line either named is a possible
 *   the rules chose, AI says not       line (outcome 'possible')
 *   printed while the rules chose one
 *   both say not printed               not printed (chosen_by 'ai')
 *
 * A one-line figure printed under another label in another year ("Net Profit After Tax", then
 * "Net Profit") is the same figure: the rules' line for the years the AI's line is not printed
 * in counts as agreed.
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

const isLoan = (m: Meaning) => m === 'loan_receivable' || m === 'loan_payable'

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

export function decideKeyFigures(
  comparison: PrintedComparison,
  open: Meaning[],
  rules: AutoMapping,
  names: RelatedNames,
  choice: KeyFigureChoice | null,
): KeyFigureDecision[] {
  const rows = new Map(comparison.tables.flatMap((t) => t.rows.map((r) => [r.key, { row: r, kind: t.kind }] as const)))
  // Lines the rules only ever offer (a loan naming a person not on file; drawings for the loan account;
  // asset totals the arithmetic does not prove): never auto-chosen, whoever chooses them.
  const offeredOnly = new Set(Object.values(suggestMappingWithRules(comparison, names)).flatMap((ls) => ls.filter((l) => l.unknownPerson || l.possibleOnly).map((l) => l.rowKey)))
  const out: KeyFigureDecision[] = []
  const decided = new Set<Meaning>()

  for (const figure of AI_KEY_FIGURES) {
    const meanings = AI_FIGURE_MEANINGS[figure].filter((m) => open.includes(m))
    if (meanings.length === 0) continue
    meanings.forEach((m) => decided.add(m))
    const byRule = meanings.map((m) => ruleDecision(m, rules))
    const ai = choice?.answer[figure]
    if (!ai || byRule.every((d) => d === null)) {
      out.push(...byRule.filter((d): d is KeyFigureDecision => d !== null))
      continue
    }
    out.push(...decideFigure(comparison, meanings, byRule, ai, rows, offeredOnly, choice!.unknownPersonLines))
  }
  // Meanings Claude is not asked about: the rules alone.
  for (const m of open) {
    if (decided.has(m)) continue
    const d = ruleDecision(m, rules)
    if (d) out.push(d)
  }
  return out
}

function decideFigure(
  comparison: PrintedComparison,
  meanings: Meaning[],
  byRule: (KeyFigureDecision | null)[],
  ai: AiFigureAnswer,
  rows: Map<string, { row: ComparisonRow; kind: string }>,
  offeredOnly: Set<string>,
  unknownPerson: Set<string>,
): KeyFigureDecision[] {
  const loans = meanings.some(isLoan)
  const ruleLines = new Set(byRule.flatMap((d) => (d?.outcome === 'lines' ? d.entries.map((e) => e.rowKey) : [])))
  const ruleNone = byRule.every((d) => d?.outcome === 'not_printed')
  const rulePossible = new Map(byRule.flatMap((d) => (d?.possible ?? []).map((p) => [p.rowKey, p] as const)))
  const aiRule = `Chosen by AI: ${ai.reason || 'no reason given'}`
  const sideOf = (key: string): Meaning => (loans ? loanSide(rows.get(key)!.row, comparison) : meanings[0])

  /** Why a line Claude chose fails the rules' checks; null when it passes. */
  const failing = (key: string): string | null => {
    const found = rows.get(key)
    if (!found) return 'not a line of the statements'
    if (found.kind !== MEANING[meanings[0]].statement || found.row.style === 'heading' || found.row.style === 'ratio') return 'not on the right statement'
    if (unknownPerson.has(key)) return 'it names someone who is not the client, a director, a beneficiary or a related company on file'
    if (offeredOnly.has(key)) return 'the rules only ever offer this line for staff to choose'
    if (loans) {
      const loanLike = PLAUSIBLE.loan_receivable(found.row) || rulePossible.has(key) || ruleLines.has(key) || !!personAccount(found.row.label)
      return loanLike ? null : 'the rules do not read it as a loan or current account'
    }
    return PLAUSIBLE[meanings[0]](found.row) ? null : `the rules do not read it as ${MEANING[meanings[0]].label.toLowerCase()}`
  }

  const describe = (key: string, why: string): PossibleLine | null => {
    const found = rows.get(key)
    if (!found) return null
    return { rowKey: key, label: found.row.label.trim() || '(line with no label)', ...latestPrinted(found.row, comparison.columns), why }
  }

  /** Nothing chosen: every line either side named waits for staff, under the meaning it would count for. */
  const allPossible = (note: string): KeyFigureDecision[] => {
    const lines = new Map<string, PossibleLine>()
    for (const d of byRule) {
      for (const e of d?.outcome === 'lines' ? d.entries : []) {
        const p = describe(e.rowKey, `The rules chose it (${e.autoRule ?? 'rule'}); ${note}`)
        if (p) lines.set(e.rowKey, p)
      }
    }
    for (const key of ai.rowKeys) {
      if (lines.has(key)) continue
      const why = failing(key)
      const p = describe(key, `AI: ${ai.reason || 'no reason given'}${why ? ` (not chosen: ${why})` : ''}`)
      if (p) lines.set(key, p)
    }
    for (const [key, p] of rulePossible) if (!lines.has(key)) lines.set(key, p)
    return meanings.flatMap((m, i) => {
      const mine = [...lines.values()].filter((p) => {
        const ruleMeaning = byRule.flatMap((d) => d?.entries ?? []).find((e) => e.rowKey === p.rowKey)?.meaning
        const ownPossible = (byRule[i]?.possible ?? []).some((x) => x.rowKey === p.rowKey)
        if (ruleMeaning) return ruleMeaning === m
        if (ownPossible) return true
        if (byRule.some((d, j) => j !== i && (d?.possible ?? []).some((x) => x.rowKey === p.rowKey))) return false
        return sideOf(p.rowKey) === m
      })
      // A meaning nothing is offered for keeps what the rules decided.
      if (mine.length === 0) return byRule[i] ? [byRule[i]!] : []
      return [{ meaning: m, outcome: 'possible' as const, chosenBy: 'ai' as const, entries: [], possible: mine, rule: null, aiReason: ai.reason || null }]
    })
  }

  if (ai.kind === 'unclear') return allPossible(`the AI was not sure: ${ai.reason || 'no reason given'}`)

  if (ai.kind === 'not_printed') {
    if (ruleNone) {
      return byRule.map((d) => ({ ...d!, chosenBy: 'ai' as const, aiReason: ai.reason || null, entries: d!.entries.map((e) => ({ ...e, autoRule: aiRule })), rule: aiRule }))
    }
    if (ruleLines.size === 0) {
      // The rules only offered lines and the AI says none of them is it: they stay offered.
      return byRule.flatMap((d) => (d ? [{ ...d, chosenBy: 'ai' as const, aiReason: ai.reason || null }] : []))
    }
    return allPossible(`the AI says no line is this figure: ${ai.reason || 'no reason given'}`)
  }

  // Claude chose lines. Rules on top: a line they reject, or only ever offer (a [person n], drawings for
  // the loan account, an unproven asset total), is never chosen: it is offered to staff instead.
  const vetoed = ai.rowKeys.filter((k) => failing(k) !== null)
  const ok = ai.rowKeys.filter((k) => failing(k) === null)
  // A one-line figure printed under another label in another year ("Net Profit After Tax" in one
  // year, "Net Profit" in the next) is the same figure: a rule line in years the AI's line is not
  // printed in counts as agreed.
  const printedIn = (k: string) => new Set((rows.get(k)?.row.cells ?? []).flatMap((c, i) => (c.printed && typeof c.value === 'number' ? [i] : [])))
  const oneLine = !loans && !MEANING[meanings[0]].multiple
  const covered = (k: string) =>
    ok.includes(k) || (oneLine && ok.length > 0 && ok.every((c) => [...printedIn(k)].every((i) => !printedIn(c).has(i))))
  if (ok.length === 0) return allPossible(`the AI chose only lines the rules do not accept: ${ai.reason || 'no reason given'}`)
  if (ruleNone) return allPossible('the rules found no such line, but the AI chose one')
  if ([...ruleLines].some((k) => !covered(k))) return allPossible(`the AI chose differently: ${ai.reason || 'no reason given'}`)
  const chosenKeys = [...new Set([...ok, ...ruleLines])]
  const offered = vetoed.flatMap((k) => {
    const p = describe(k, `AI: ${ai.reason || 'no reason given'} (not chosen: ${failing(k)})`)
    return p ? [p] : []
  })
  // Agreed (or the AI resolved what the rules only offered): keep the rules' meaning for their own lines.
  const ruleMeaning = new Map(byRule.flatMap((d) => (d?.outcome === 'lines' ? d.entries.map((e) => [e.rowKey, e.meaning] as const) : [])))
  return meanings.map((m) => {
    const keys = chosenKeys.filter((k) => (ruleMeaning.get(k) ?? sideOf(k)) === m)
    const possible = offered.filter((p) => sideOf(p.rowKey) === m)
    if (keys.length === 0) {
      // The other loan side: the AI's lines are all on one side, so this one prints none.
      const entry: MappingEntry = { meaning: m, rowKey: '', label: null, nonePrinted: true, confirmedBy: AUTO_BY, confirmedAt: '', autoRule: aiRule }
      return { meaning: m, outcome: 'not_printed' as const, chosenBy: 'ai' as const, entries: [entry], possible, rule: aiRule, aiReason: ai.reason || null }
    }
    const entries: MappingEntry[] = keys.map((k) => ({
      meaning: m,
      rowKey: k,
      label: rows.get(k)!.row.label || '(no label)',
      nonePrinted: false,
      confirmedBy: AUTO_BY,
      confirmedAt: '',
      autoRule: aiRule,
    }))
    // Lines the rules only offered that the AI left out are no longer offered: the AI chose among them.
    return { meaning: m, outcome: 'lines' as const, chosenBy: 'ai' as const, entries, possible, rule: aiRule, aiReason: ai.reason || null }
  })
}
