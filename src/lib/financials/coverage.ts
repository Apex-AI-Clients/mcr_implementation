import { YEAR_WINDOW, applyYearWindow } from './checks'
import { mergeAnnualYears, mergeCurrentPeriod, type MergedStatement } from './statementSelection'
import type { StatementHalfKey, StoredStatementSlot } from './types'

/**
 * Which statement each year has, and where it came from — the coverage table
 * on the client page and the comparison page. Pure; built from the stored
 * slots as they are now, so it is never stale.
 *
 * Columns: the four financial years the comparison wants (the latest four up
 * to the newest year stored, gaps included so a missing year shows), any older
 * years that are stored as extras, then the current period if there is one.
 * Each cell is the year's own file, a later file's comparative column, or
 * missing.
 */

export type CoverageStatus = 'own' | 'comparative' | 'missing'

export interface CoverageCell {
  status: CoverageStatus
  filename: string | null
  documentId: string | null
}

export interface CoverageColumn {
  key: string
  label: string
  financialYear: number
  kind: 'annual' | 'current_period'
  /** Older than the four years the comparison uses. */
  extra: boolean
  /** Current period only: the period as printed, e.g. "1 July 2025 to 4 May 2026". */
  periodLabel?: string
}

export interface StatementCoverage {
  columns: CoverageColumn[]
  rows: Record<StatementHalfKey, CoverageCell[]>
}

const MISSING: CoverageCell = { status: 'missing', filename: null, documentId: null }

function cell(m: MergedStatement | undefined, half: StatementHalfKey): CoverageCell {
  const source = m?.sources[half]
  if (!source) return MISSING
  return {
    status: source.sourceColumn === 'comparative' ? 'comparative' : 'own',
    filename: source.sourceFilename,
    documentId: source.documentId,
  }
}

export function buildCoverage(slots: StoredStatementSlot[]): StatementCoverage {
  const annual = mergeAnnualYears(slots)
  const current = mergeCurrentPeriod(slots)
  const { used, extraYears } = applyYearWindow(annual)
  const byYear = new Map(annual.map((m) => [m.statement.financialYear, m]))

  const columns: CoverageColumn[] = []
  if (used.length > 0) {
    const latest = used[used.length - 1].statement.financialYear
    // At least the four years the portal asks for, and every year the
    // comparison uses — so a gap shows as a missing column, not a hidden one.
    const start = Math.min(used[0].statement.financialYear, latest - YEAR_WINDOW + 1)
    for (const year of extraYears) {
      columns.push({ key: `fy${year}`, label: `FY${year}`, financialYear: year, kind: 'annual', extra: true })
    }
    for (let year = start; year <= latest; year++) {
      columns.push({ key: `fy${year}`, label: `FY${year}`, financialYear: year, kind: 'annual', extra: false })
    }
  }
  if (current) {
    columns.push({
      key: 'current',
      label: 'Current period',
      financialYear: current.statement.financialYear,
      kind: 'current_period',
      extra: false,
      ...(current.statement.periodLabel ? { periodLabel: current.statement.periodLabel } : {}),
    })
  }

  const rowFor = (half: StatementHalfKey) =>
    columns.map((column) =>
      column.kind === 'current_period'
        ? cell(current ?? undefined, half)
        : cell(byYear.get(column.financialYear), half),
    )

  return {
    columns,
    rows: { income_statement: rowFor('income_statement'), balance_sheet: rowFor('balance_sheet') },
  }
}
