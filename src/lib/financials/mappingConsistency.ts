import { dictionaryKey, normaliseLabel } from './labels'
import { isIncomeStatementSection, moveLine, type Statements } from './lineCorrections'
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
 * different files, every occurrence moves to one key: the dictionary's if it
 * knows the label, otherwise the key most files used (ties: alphabetical, so
 * the result never depends on the order files were read). Each harmonised
 * label is reported once.
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

export function harmoniseMappings(slots: StoredStatementSlot[]): FinancialCheck[] {
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
    if (keys.length < 2) continue

    const first = occurrences[0].line
    const fromDictionary = dictionaryKey(first.rawLabel, first.section)
    let chosen = fromDictionary
    if (!chosen) {
      const counts = new Map<string, number>()
      for (const o of occurrences) counts.set(o.line.canonicalKey as string, (counts.get(o.line.canonicalKey as string) ?? 0) + 1)
      chosen = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
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
      financialYear: null,
      statement: isIncomeStatementSection(first.section) ? 'income_statement' : 'balance_sheet',
      message: `"${first.rawLabel}" was read as ${previously}. It is treated as ${readableKey(chosen)} in every file (${fromDictionary ? 'the label dictionary' : 'what most files used'}).`,
      documentIds: [...new Set(moved.map((o) => o.stored.documentId).filter((id): id is string => !!id))],
    })
  }
  return checks
}
