import { normaliseLabel } from './labels'
import {
  effectiveKey,
  isIncomeStatementSection,
  LINE_TOLERANCE,
  moveLine,
  principalFor,
  type CorrectionContext,
  type Statements,
} from './lineCorrections'
import { emptyBalanceSheet, emptyIncomeStatement } from './statementSelection'
import type {
  ExtractedBalanceSheet,
  ExtractedIncomeStatement,
  FinancialCheck,
  LineSection,
  StatementHalfKey,
  StatementLine,
  StoredHalf,
  StoredStatementSlot,
} from './types'

/**
 * One client's files, mapped the same way. Pure; mutates the slots it is
 * given (they are read fresh for each build and never written back).
 *
 * Lines are grouped by statement, PRINTED SECTION and label (normalised): the
 * same label under assets and under liabilities, or under current and
 * non-current liabilities, is a different line ("Business Account" under
 * Current Assets is cash; under Current Liabilities it is an overdraft).
 *
 * Within a group:
 *   1. the label dictionary and the loan rule decide each line on its own
 *      (they depend on the line's own section and sign);
 *   2. lines no rule decides take the key used by most DOCUMENTS — one vote
 *      per file, not per column; a tie goes to the key a year's own file
 *      (primary column) used, then alphabetically.
 *
 * Order-independent: files, groups and lines are processed in a canonical
 * order, so the same files always give the same result.
 *
 * Invariant: after the pass, no figure may exceed its section's printed total
 * and a director loan receivable may not be negative. A statement the pass
 * leaves breaking either goes back to its mapping before the pass, with a
 * warning.
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

const COLUMN_RANK: Record<string, number> = { primary: 0, comparative: 1, current_period: 2 }

function slotOrder(slot: StoredStatementSlot): string {
  return [String(slot.financialYear).padStart(4, '0'), COLUMN_RANK[slot.sourceColumn] ?? 9, slot.periodEndDate, slot.id].join('|')
}

function lineOrder(line: StatementLine): string {
  return [line.section, normaliseLabel(line.rawLabel), line.rawLabel, line.value ?? '', line.canonicalKey ?? ''].join('|')
}

function occurrenceOrder(o: Occurrence): string {
  return `${slotOrder(o.slot)}|${o.half}|${lineOrder(o.line)}`
}

// ─── Invariant ────────────────────────────────────────────────────────────────

const CATEGORY_TOTALS: Record<StatementHalfKey, Array<[string, string]>> = {
  income_statement: [
    ['income', 'totalIncome'],
    ['cogs', 'totalCogs'],
    ['expenses', 'totalExpenses'],
  ],
  balance_sheet: [
    ['currentAssets', 'totalCurrentAssets'],
    ['nonCurrentAssets', 'totalNonCurrentAssets'],
    ['currentLiabilities', 'totalCurrentLiabilities'],
    ['nonCurrentLiabilities', 'totalNonCurrentLiabilities'],
    ['equity', 'totalEquity'],
  ],
}

/** The printed sections whose lines make up a category. */
const CATEGORY_SECTIONS: Record<string, LineSection[]> = {
  income: ['income', 'otherIncome'],
  cogs: ['cogs'],
  expenses: ['expenses'],
  currentAssets: ['currentAssets'],
  nonCurrentAssets: ['nonCurrentAssets'],
  currentLiabilities: ['currentLiabilities'],
  nonCurrentLiabilities: ['nonCurrentLiabilities'],
  equity: ['equity'],
}

/**
 * The most one figure of a category can be: the GROSS section — the sum of its
 * positive printed lines — or, without lines, the printed total plus every
 * contra amount (negative entries, and closing stock, which is subtracted).
 * Never the net total alone: opening stock can exceed total cost of sales, and
 * chattel mortgages can exceed a non-current liabilities total that negative
 * director loans net down.
 */
function grossLimit(category: string, total: number, figures: Record<string, unknown>, entries: Array<[string, unknown]>, lines: StatementLine[] | undefined): number {
  const sections = CATEGORY_SECTIONS[category] ?? []
  const positiveLines = (lines ?? [])
    .filter((l) => !l.isTotal && sections.includes(l.section) && typeof l.value === 'number' && l.value > 0)
    .reduce((sum, l) => sum + (l.value as number), 0)
  const contra =
    entries.reduce((sum, [, v]) => sum + (typeof v === 'number' && v < 0 ? -v : 0), 0) +
    (category === 'cogs' && typeof figures.closingStock === 'number' ? Math.abs(figures.closingStock) : 0)
  return Math.max(total + contra, positiveLines)
}

/** What breaks the invariant in one statement, in words. Empty when it holds. */
export function invariantBreaches(half: StatementHalfKey, data: ExtractedIncomeStatement | ExtractedBalanceSheet): string[] {
  const out: string[] = []
  const record = data as unknown as Record<string, Record<string, unknown> | undefined>
  const totals = (record.totals ?? {}) as Record<string, unknown>
  const lines = (data as { lines?: StatementLine[] }).lines
  for (const [category, totalKey] of CATEGORY_TOTALS[half]) {
    const total = totals[totalKey]
    const figures = record[category]
    if (typeof total !== 'number' || total <= 0 || !figures) continue
    const entries: Array<[string, unknown]> = [
      ...Object.entries(figures).filter(([k]) => k !== 'other'),
      ...Object.entries((figures.other as Record<string, unknown> | undefined) ?? {}),
    ]
    const limit = grossLimit(category, total, figures, entries, lines)
    for (const [key, value] of entries) {
      // Closing stock is subtracted: never a line "above" its section.
      if (category === 'cogs' && key === 'closingStock') continue
      if (typeof value === 'number' && value > limit + LINE_TOLERANCE) {
        out.push(`${readableKey(key)} ${money(value)} is more than all its ${readableKey(category)} lines together (${money(limit)})`)
      }
    }
  }
  if (half === 'balance_sheet') {
    const receivable = (data as ExtractedBalanceSheet).nonCurrentAssets?.directorRelatedLoansReceivable
    if (typeof receivable === 'number' && receivable < 0) out.push(`director loans receivable is negative (${money(receivable)})`)
  }
  return out
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-AU')}`

// ─── The pass ─────────────────────────────────────────────────────────────────

export function harmoniseMappings(slots: StoredStatementSlot[], ctx: CorrectionContext = { isTrust: false }): FinancialCheck[] {
  const ordered = [...slots].sort((a, b) => slotOrder(a).localeCompare(slotOrder(b)))

  // Every statement as it was before the pass: the mapping to fall back to.
  const before = new Map<object, { half: StatementHalfKey; slot: StoredStatementSlot; stored: StoredHalf<unknown>; copy: string }>()
  const groups = new Map<string, Occurrence[]>()
  for (const slot of ordered) {
    for (const half of ['income_statement', 'balance_sheet'] as const) {
      const stored = half === 'income_statement' ? slot.incomeStatement : slot.balanceSheet
      const lines = stored?.data.lines
      if (!stored || !lines) continue
      before.set(stored.data, { half, slot, stored: stored as StoredHalf<unknown>, copy: JSON.stringify(stored.data) })
      for (const line of lines) {
        if (line.isTotal || line.value === null || !line.canonicalKey || line.canonicalKey.startsWith('ignore.')) continue
        const group = `${half}|${line.section}|${normaliseLabel(line.rawLabel)}`
        groups.set(group, [...(groups.get(group) ?? []), { slot, half, data: stored.data, stored: stored as StoredHalf<unknown>, line }])
      }
    }
  }

  const checks: FinancialCheck[] = []
  const paired: Occurrence[] = []
  /** The statements each consistency note moved lines in. */
  const movedIn = new Map<FinancialCheck, Set<object>>()
  for (const groupKey of [...groups.keys()].sort()) {
    const occurrences = groups.get(groupKey)!.sort((a, b) => occurrenceOrder(a).localeCompare(occurrenceOrder(b)))

    // Unexpired interest paired with a loan follows that loan's FINAL key:
    // it is placed after every group has been decided (below).
    const unpaired = occurrences.filter((o) => {
      if (!principalFor(o.line, o.data.lines ?? [])) return true
      paired.push(o)
      return false
    })

    // 1. Rules, line by line.
    const decided = unpaired.map((o) => {
      const ek = effectiveKey(o.line, ctx)
      const rule = (ek.source === 'dictionary' || ek.source === 'loan') && ek.key ? ek : null
      return { o, rule }
    })

    // 2. A vote among the lines no rule decides.
    const free = decided.filter((d) => !d.rule).map((d) => d.o)
    const freeKeys = [...new Set(free.map((o) => o.line.canonicalKey as string))]
    let voted: string | null = null
    if (freeKeys.length >= 2) {
      const votes = new Map<string, Set<string>>()
      const ownFile = new Set<string>()
      for (const o of free) {
        const key = o.line.canonicalKey as string
        votes.set(key, (votes.get(key) ?? new Set()).add(o.stored.documentId ?? o.slot.id))
        if (o.slot.sourceColumn === 'primary') ownFile.add(key)
      }
      voted = [...votes.entries()].sort(
        (a, b) =>
          b[1].size - a[1].size ||
          Number(ownFile.has(b[0])) - Number(ownFile.has(a[0])) ||
          a[0].localeCompare(b[0]),
      )[0][0]
    }

    // Moves, reported once per destination.
    const moves = new Map<string, { reason: string; was: Map<string, string[]>; documentIds: Set<string>; statements: Set<object> }>()
    for (const { o, rule } of decided) {
      const target = rule?.key ?? voted
      const key = o.line.canonicalKey as string
      if (!target || key === target) continue
      const statements: Statements =
        o.half === 'income_statement'
          ? { incomeStatement: o.data as ExtractedIncomeStatement, balanceSheet: emptyBalanceSheet() }
          : { incomeStatement: emptyIncomeStatement(), balanceSheet: o.data as ExtractedBalanceSheet }
      if (!moveLine(statements, o.line, target, rule?.absolute ?? false)) continue
      const reason = rule ? (rule.source === 'loan' ? 'the loan rule' : 'the label dictionary') : 'what most files used'
      const entry = moves.get(target) ?? { reason, was: new Map<string, string[]>(), documentIds: new Set<string>(), statements: new Set<object>() }
      entry.statements.add(o.data)
      entry.was.set(key, [...(entry.was.get(key) ?? []), o.stored.sourceFilename ?? 'a file'])
      if (o.stored.documentId) entry.documentIds.add(o.stored.documentId)
      moves.set(target, entry)
    }

    const first = occurrences[0].line
    for (const target of [...moves.keys()].sort()) {
      const { reason, was, documentIds, statements } = moves.get(target)!
      const previously = [...was.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, files]) => `${readableKey(key)} in ${[...new Set(files)].sort().join(', ')}`)
        .join('; ')
      checks.push({
        kind: 'mapping_consistency',
        severity: 'info',
        group: 'mapping_consistency',
        financialYear: null,
        statement: isIncomeStatementSection(first.section) ? 'income_statement' : 'balance_sheet',
        message: `"${first.rawLabel}" was read as ${previously}. It is treated as ${readableKey(target)} in every file (${reason}).`,
        documentIds: [...documentIds].sort(),
      })
      movedIn.set(checks[checks.length - 1], statements)
    }
  }

  // Paired interest lines, after their loans have their final keys.
  const pairedMoves = new Map<string, { label: string; documentIds: Set<string>; statements: Set<object> }>()
  for (const o of paired.sort((a, b) => occurrenceOrder(a).localeCompare(occurrenceOrder(b)))) {
    const target = effectiveKey(o.line, ctx, o.data.lines ?? []).key
    if (!target || o.line.canonicalKey === target) continue
    const statements: Statements =
      o.half === 'income_statement'
        ? { incomeStatement: o.data as ExtractedIncomeStatement, balanceSheet: emptyBalanceSheet() }
        : { incomeStatement: emptyIncomeStatement(), balanceSheet: o.data as ExtractedBalanceSheet }
    if (!moveLine(statements, o.line, target)) continue
    const entry = pairedMoves.get(target) ?? { label: o.line.rawLabel, documentIds: new Set<string>(), statements: new Set<object>() }
    if (o.stored.documentId) entry.documentIds.add(o.stored.documentId)
    entry.statements.add(o.data)
    pairedMoves.set(target, entry)
  }
  for (const target of [...pairedMoves.keys()].sort()) {
    const { label, documentIds, statements } = pairedMoves.get(target)!
    checks.push({
      kind: 'mapping_consistency',
      severity: 'info',
      group: 'mapping_consistency',
      financialYear: null,
      statement: 'balance_sheet',
      message: `"${label}" follows the loan it belongs to: treated as ${readableKey(target)}.`,
      documentIds: [...documentIds].sort(),
    })
    movedIn.set(checks[checks.length - 1], statements)
  }

  // The invariant: a statement the pass broke goes back to its mapping before it.
  const reverted = new Set<object>()
  for (const [data, { half, slot, stored, copy }] of before) {
    const now = invariantBreaches(half, data as ExtractedIncomeStatement | ExtractedBalanceSheet)
    if (now.length === 0) continue
    const previous = JSON.parse(copy) as Record<string, unknown>
    const was = invariantBreaches(half, previous as unknown as ExtractedIncomeStatement | ExtractedBalanceSheet)
    const statementLabel = half === 'income_statement' ? 'Profit & Loss' : 'Balance Sheet'
    const where = `${stored.sourceFilename ?? 'a file'} (${slot.sourceColumn === 'current_period' ? 'current period' : `FY${slot.financialYear}`} column)`
    if (was.length < now.length || JSON.stringify(was) !== JSON.stringify(now)) {
      const target = data as Record<string, unknown>
      for (const k of Object.keys(target)) delete target[k]
      Object.assign(target, previous)
      reverted.add(data)
      checks.push({
        kind: 'mapping_consistency',
        severity: 'warning',
        group: 'mapping_reverted',
        financialYear: slot.financialYear,
        currentPeriod: slot.sourceColumn === 'current_period' || undefined,
        statement: half,
        message: `Mapping this ${statementLabel} the same way as the other files would have left ${now.join('; ')}, so its own mapping (${where}) was kept. Check its lines.`,
        documentIds: stored.documentId ? [stored.documentId] : [],
      })
    } else {
      checks.push({
        kind: 'mapping_consistency',
        severity: 'warning',
        group: 'invariant',
        financialYear: slot.financialYear,
        currentPeriod: slot.sourceColumn === 'current_period' || undefined,
        statement: half,
        message: `As extracted, ${now.join('; ')} (${where}). Check its lines.`,
        documentIds: stored.documentId ? [stored.documentId] : [],
      })
    }
  }
  // A note whose every move was undone no longer describes anything.
  return checks.filter((c) => {
    const statements = movedIn.get(c)
    return !statements || [...statements].some((d) => !reverted.has(d))
  })
}
