import { normaliseLabel } from './labels'
import {
  effectiveKey,
  isIncomeStatementSection,
  moveLine,
  type CorrectionContext,
  type Statements,
} from './lineCorrections'
import { emptyBalanceSheet, emptyIncomeStatement } from './statementSelection'
import type {
  ExtractedBalanceSheet,
  ExtractedIncomeStatement,
  FinancialCheck,
  StatementHalfKey,
  StatementLine,
  StoredHalf,
  StoredStatementSlot,
} from './types'

/**
 * One client's files, mapped the same way. Pure; mutates the slots it is
 * given (they are read fresh for each build and never written back).
 *
 * When the same printed label (normalised) was mapped to different keys in
 * different files, every occurrence moves to one key:
 *   1. the label dictionary or the loan rule, when either decides the label;
 *   2. otherwise the key used by most DOCUMENTS — one vote per file, not per
 *      column, so a file's comparative column cannot outvote another file;
 *      a tie goes to the key a year's own file (primary column) used, then
 *      alphabetically, so the result never depends on reading order.
 * Each harmonised label is reported once.
 */

interface Occurrence {
  slot: StoredStatementSlot
  half: StatementHalfKey
  data: ExtractedIncomeStatement | ExtractedBalanceSheet
  stored: StoredHalf<unknown>
  line: StatementLine
}

function readableKey(path: string): string {
  const last = path.split('.').pop() ?? path
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

export function harmoniseMappings(slots: StoredStatementSlot[], ctx: CorrectionContext = { isTrust: false }): FinancialCheck[] {
  const groups = new Map<string, Occurrence[]>()
  for (const slot of slots) {
    for (const half of ['income_statement', 'balance_sheet'] as const) {
      const stored = half === 'income_statement' ? slot.incomeStatement : slot.balanceSheet
      const lines = stored?.data.lines
      if (!stored || !lines) continue
      for (const line of lines) {
        if (line.isTotal || line.value === null || !line.canonicalKey || line.canonicalKey.startsWith('ignore.')) continue
        const group = `${half}|${normaliseLabel(line.rawLabel)}`
        groups.set(group, [...(groups.get(group) ?? []), { slot, half, data: stored.data, stored: stored as StoredHalf<unknown>, line }])
      }
    }
  }

  const checks: FinancialCheck[] = []
  for (const occurrences of groups.values()) {
    const keys = [...new Set(occurrences.map((o) => o.line.canonicalKey as string))]
    const first = occurrences[0].line
    const decided = effectiveKey(first, ctx)
    const fromRule = decided.source === 'dictionary' || decided.source === 'loan' ? decided.key : null
    // A rule applies even when every file agrees on something else — that is
    // how statements read before the rule existed get corrected on a rebuild.
    if (fromRule ? keys.every((k) => k === fromRule) : keys.length < 2) continue

    let chosen = fromRule
    if (!chosen) {
      // One vote per document; a key used in some year's own file wins a tie.
      const votes = new Map<string, Set<string>>()
      const ownFile = new Set<string>()
      for (const o of occurrences) {
        const key = o.line.canonicalKey as string
        votes.set(key, (votes.get(key) ?? new Set()).add(o.stored.documentId ?? o.slot.id))
        if (o.slot.sourceColumn === 'primary') ownFile.add(key)
      }
      chosen = [...votes.entries()].sort(
        (a, b) =>
          b[1].size - a[1].size ||
          Number(ownFile.has(b[0])) - Number(ownFile.has(a[0])) ||
          a[0].localeCompare(b[0]),
      )[0][0]
    }

    const moved: Occurrence[] = []
    const was = new Map<string, string[]>()
    for (const o of occurrences) {
      const key = o.line.canonicalKey as string
      if (key === chosen) continue
      const statements: Statements =
        o.half === 'income_statement'
          ? { incomeStatement: o.data as ExtractedIncomeStatement, balanceSheet: emptyBalanceSheet() }
          : { incomeStatement: emptyIncomeStatement(), balanceSheet: o.data as ExtractedBalanceSheet }
      if (moveLine(statements, o.line, chosen)) {
        moved.push(o)
        was.set(key, [...(was.get(key) ?? []), o.stored.sourceFilename ?? 'a file'])
      }
    }
    if (moved.length === 0) continue

    const previously = [...was.entries()]
      .map(([key, files]) => `${readableKey(key)} in ${[...new Set(files)].join(', ')}`)
      .join('; ')
    checks.push({
      kind: 'mapping_consistency',
      severity: 'info',
      group: 'mapping_consistency',
      financialYear: null,
      statement: isIncomeStatementSection(first.section) ? 'income_statement' : 'balance_sheet',
      message: `"${first.rawLabel}" was read as ${previously}. It is treated as ${readableKey(chosen)} in every file (${fromRule ? (decided.source === 'loan' ? 'the loan rule' : 'the label dictionary') : 'what most files used'}).`,
      documentIds: [...new Set(moved.map((o) => o.stored.documentId).filter((id): id is string => !!id))],
    })
  }
  return checks
}
