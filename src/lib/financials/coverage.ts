import { YEAR_WINDOW, applyYearWindow } from './checks'
import { mergeAnnualYears, mergeCurrentPeriod, type MergedStatement } from './statementSelection'
import { currentPeriodName, currentPeriodRange, yearNotUploadedNote } from './periodLabels'
import type { FinancialStatementSourceColumn, StatementHalfKey, StoredStatementSlot } from './types'

/**
 * Which statement each year has, and where it came from — the coverage table
 * on the client page and the comparison page. Pure; built from the stored
 * slots as they are now, so it is never stale.
 *
 * Columns: the four financial years the comparison wants (the latest four up
 * to the newest year stored, gaps included so a missing year shows), any older
 * years that are stored as extras, then the current period if there is one.
 * When the current period's FY is later than the newest annual year + 1, the
 * full years in between are added as missing columns (notUploaded): e.g.
 * FY2022–FY2025 and FY2027 to date leave FY2026, the latest full year, missing.
 * The comparison itself still uses the latest four annual years on file.
 * Each cell is the year's own file, a later file's comparative column,
 * missing (no file supplies it), or failed (a file prints it but it could not
 * be read, even on a retry — re-running may fix it).
 */

export type CoverageStatus = 'own' | 'comparative' | 'missing' | 'failed'

/** A column a document prints but whose extraction failed. */
export interface ColumnFailure {
  financialYear: number
  sourceColumn: FinancialStatementSourceColumn
  half: StatementHalfKey
}

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
  /** Current period only: its dates, e.g. "1 Jul – 15 Oct 2026". */
  periodLabel?: string
  /**
   * A full year after the newest annual statement and before the current
   * period's year: not uploaded, and not in the comparison.
   */
  notUploaded?: true
  /** Shown under the column heading, e.g. "Year ended 30 June 2026 not uploaded". */
  note?: string
}

export interface StatementCoverage {
  columns: CoverageColumn[]
  rows: Record<StatementHalfKey, CoverageCell[]>
  /** The annual years the comparison uses: the latest four on file. */
  comparedYears?: number[]
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

export function buildCoverage(slots: StoredStatementSlot[], failures: ColumnFailure[] = []): StatementCoverage {
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
    // Full years between the newest annual statement and the current period.
    const currentYear = current?.statement.financialYear ?? null
    if (currentYear !== null) {
      for (let year = latest + 1; year < currentYear; year++) {
        columns.push({
          key: `fy${year}`,
          label: `FY${year}`,
          financialYear: year,
          kind: 'annual',
          extra: false,
          notUploaded: true,
          note: yearNotUploadedNote(year),
        })
      }
    }
  }
  if (current) {
    const dates = {
      financialYear: current.statement.financialYear,
      periodStartDate: current.statement.periodStartDate ?? null,
      periodEndDate: current.statement.periodEndDate,
    }
    columns.push({
      key: 'current',
      label: currentPeriodName(dates),
      financialYear: current.statement.financialYear,
      kind: 'current_period',
      extra: false,
      periodLabel: currentPeriodRange(dates),
    })
  }

  const failed = (column: CoverageColumn, half: StatementHalfKey) =>
    failures.some(
      (f) =>
        f.half === half &&
        f.financialYear === column.financialYear &&
        (f.sourceColumn === 'current_period') === (column.kind === 'current_period'),
    )
  const rowFor = (half: StatementHalfKey) =>
    columns.map((column) => {
      const found =
        column.kind === 'current_period' ? cell(current ?? undefined, half) : cell(byYear.get(column.financialYear), half)
      return found.status === 'missing' && failed(column, half) ? { ...found, status: 'failed' as const } : found
    })

  return {
    columns,
    rows: { income_statement: rowFor('income_statement'), balance_sheet: rowFor('balance_sheet') },
    comparedYears: used.map((m) => m.statement.financialYear),
  }
}
