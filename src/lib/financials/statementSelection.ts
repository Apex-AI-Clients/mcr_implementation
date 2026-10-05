import type {
  ExtractedBalanceSheet,
  ExtractedFinancialStatement,
  ExtractedIncomeStatement,
  FinancialStatementSourceColumn,
  StatementHalfKey,
  StoredHalf,
  StoredStatementSlot,
} from './types'

/**
 * Stored slots -> the statements the comparison and the prediction read. Pure.
 *
 * Per annual FY, each half is taken on its own: the primary column's half if
 * there is one (the year's own file), else the comparative column's (the next
 * year's file). So one year can take its P&L from its own file and its
 * balance sheet from the next year's comparative column.
 *
 * The current period stays separate: the latest FY's current_period slot.
 */

export interface HalfSource {
  sourceColumn: FinancialStatementSourceColumn
  documentId: string | null
  sourceFilename: string | null
}

export interface MergedStatement {
  statement: ExtractedFinancialStatement
  /** Where each half came from; null when the year has no such half. */
  sources: Record<StatementHalfKey, HalfSource | null>
}

export function emptyIncomeStatement(): ExtractedIncomeStatement {
  return { income: {}, cogs: {}, expenses: {}, totals: {} }
}

export function emptyBalanceSheet(): ExtractedBalanceSheet {
  return {
    currentAssets: {},
    nonCurrentAssets: {},
    currentLiabilities: {},
    nonCurrentLiabilities: {},
    equity: {},
    totals: {},
  }
}

const COLUMN_RANK: Record<FinancialStatementSourceColumn, number> = {
  primary: 0,
  comparative: 1,
  current_period: 2,
}

function pickHalf<T>(
  slots: StoredStatementSlot[],
  get: (slot: StoredStatementSlot) => StoredHalf<T> | null,
): { slot: StoredStatementSlot; half: StoredHalf<T> } | null {
  const ranked = [...slots].sort((a, b) => COLUMN_RANK[a.sourceColumn] - COLUMN_RANK[b.sourceColumn])
  for (const slot of ranked) {
    const half = get(slot)
    if (half) return { slot, half }
  }
  return null
}

function merge(slots: StoredStatementSlot[]): MergedStatement | null {
  const is = pickHalf(slots, (s) => s.incomeStatement)
  const bs = pickHalf(slots, (s) => s.balanceSheet)
  if (!is && !bs) return null

  // The slot that leads: the P&L's (it names the period), else the balance sheet's.
  const lead = (is ?? bs)!.slot
  const source = (pick: { slot: StoredStatementSlot; half: StoredHalf<unknown> } | null): HalfSource | null =>
    pick
      ? {
          sourceColumn: pick.slot.sourceColumn,
          documentId: pick.half.documentId,
          sourceFilename: pick.half.sourceFilename,
        }
      : null

  const statement: ExtractedFinancialStatement = {
    financialYear: lead.financialYear,
    periodEndDate: (bs ?? is)!.slot.periodEndDate,
    sourceFilename: is?.half.sourceFilename ?? bs?.half.sourceFilename ?? '',
    sourceColumn: lead.sourceColumn,
    incomeStatement: is?.half.data ?? emptyIncomeStatement(),
    balanceSheet: bs?.half.data ?? emptyBalanceSheet(),
    rawExtraction: [],
    warnings: [
      ...(is?.half.warnings ?? []),
      ...(bs?.half.warnings ?? []),
      ...new Set([...(is ? is.slot.slotWarnings : []), ...(bs ? bs.slot.slotWarnings : [])]),
    ],
    extractionModel: lead.extractionModel ?? undefined,
    present: { income_statement: is !== null, balance_sheet: bs !== null },
    ...(lead.periodLabel ? { periodLabel: lead.periodLabel } : {}),
    ...(lead.periodStartDate ? { periodStartDate: lead.periodStartDate } : {}),
  }
  return { statement, sources: { income_statement: source(is), balance_sheet: source(bs) } }
}

/** One merged statement per annual FY that has either half, FY ascending. */
export function mergeAnnualYears(slots: StoredStatementSlot[]): MergedStatement[] {
  const byYear = new Map<number, StoredStatementSlot[]>()
  for (const slot of slots) {
    if (slot.sourceColumn === 'current_period') continue
    byYear.set(slot.financialYear, [...(byYear.get(slot.financialYear) ?? []), slot])
  }
  return [...byYear.keys()]
    .sort((a, b) => a - b)
    .map((year) => merge(byYear.get(year)!))
    .filter((m): m is MergedStatement => m !== null)
}

/** The latest FY's current-period statement, its halves merged. */
export function mergeCurrentPeriod(slots: StoredStatementSlot[]): MergedStatement | null {
  const current = slots.filter((s) => s.sourceColumn === 'current_period')
  if (current.length === 0) return null
  const latest = Math.max(...current.map((s) => s.financialYear))
  return merge(current.filter((s) => s.financialYear === latest))
}

/**
 * The most recent balance sheet: highest FY first; within a FY the year's own
 * file (primary), then a current-period export, then a comparative column.
 * With `preferCurrentPeriod`, a current-period balance sheet wins outright.
 */
export function latestBalanceSheet(
  slots: StoredStatementSlot[],
  { preferCurrentPeriod = false } = {},
): { slot: StoredStatementSlot; balanceSheet: ExtractedBalanceSheet } | null {
  const rank: Record<FinancialStatementSourceColumn, number> = { primary: 0, current_period: 1, comparative: 2 }
  const withBs = slots.filter((s) => s.balanceSheet !== null)
  if (withBs.length === 0) return null
  const ordered = [...withBs].sort((a, b) => {
    if (preferCurrentPeriod) {
      const cp = Number(b.sourceColumn === 'current_period') - Number(a.sourceColumn === 'current_period')
      if (cp !== 0) return cp
    }
    return b.financialYear - a.financialYear || rank[a.sourceColumn] - rank[b.sourceColumn]
  })
  const slot = ordered[0]
  return { slot, balanceSheet: slot.balanceSheet!.data }
}
