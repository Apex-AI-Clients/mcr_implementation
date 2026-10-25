import { exportsLocked, hardChecksFingerprint, type FiguresChecked } from '@/lib/financials/hardChecks'
import type { FinancialCheck } from '@/lib/financials/types'
import type { PrintedComparison } from './compare'

/**
 * The as-printed comparison's failed totals as hard checks (hardChecks.ts):
 * the same red "Needs review" banner, export lock, tick and readiness gate as
 * before, now over printed totals that do not add up. Pure.
 */
export function printedHardChecks(comparison: PrintedComparison): FinancialCheck[] {
  return comparison.failures.map((f) => ({
    kind: f.kind,
    severity: 'warning' as const,
    financialYear: f.financialYear,
    statement: f.statement === 'profit_and_loss' ? ('income_statement' as const) : ('balance_sheet' as const),
    ...(f.currentPeriod ? { currentPeriod: true } : {}),
    message: f.message,
    documentIds: [f.documentId],
  }))
}

export function printedFingerprint(comparison: PrintedComparison, builtAt: string | null): string | null {
  return hardChecksFingerprint(builtAt, printedHardChecks(comparison))
}

export function printedExportsLocked(comparison: PrintedComparison, builtAt: string | null, checked: FiguresChecked | null): boolean {
  return exportsLocked(printedHardChecks(comparison), builtAt, checked)
}
