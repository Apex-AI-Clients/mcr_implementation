import { Check, CornerDownLeft, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CoverageCell, StatementCoverage } from '@/lib/financials/coverage'
import type { StatementHalfKey } from '@/lib/financials/types'

/**
 * Which statement each year has, and where it came from. Rows are the Profit
 * & Loss and the Balance Sheet; columns the financial years plus the current
 * period. A cell is the year's own file, a later file's comparative column,
 * or missing — the filename is on hover.
 *
 * Presentational only (no hooks), so the client page renders it on the
 * server and the comparison page inside its client component.
 */

interface Props {
  coverage: StatementCoverage
  className?: string
}

const ROWS: Array<{ half: StatementHalfKey; label: string }> = [
  { half: 'income_statement', label: 'Profit & Loss' },
  { half: 'balance_sheet', label: 'Balance Sheet' },
]

function CellContent({ cell }: { cell: CoverageCell }) {
  if (cell.status === 'own') {
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <Check className="h-3.5 w-3.5" aria-hidden />
        <span>Own file</span>
      </span>
    )
  }
  if (cell.status === 'comparative') {
    return (
      <span className="inline-flex items-center gap-1 text-accent">
        <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
        <span>Comparative</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-destructive">
      <Minus className="h-3.5 w-3.5" aria-hidden />
      <span>Missing</span>
    </span>
  )
}

function hoverText(cell: CoverageCell): string | undefined {
  if (!cell.filename) return undefined
  return cell.status === 'comparative'
    ? `From the prior-year column of ${cell.filename}`
    : cell.filename
}

export function StatementCoverageTable({ coverage, className }: Props) {
  if (coverage.columns.length === 0) return null

  return (
    <div className={cn('space-y-2', className)}>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/8 bg-surface/40">
              <th scope="col" className="py-2 pl-3 pr-4 text-left font-medium text-foreground/60">
                Statement
              </th>
              {coverage.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2 text-left font-medium whitespace-nowrap',
                    column.extra ? 'text-foreground/40' : 'text-foreground/80',
                  )}
                  title={column.periodLabel}
                >
                  {column.label}
                  {column.extra && <span className="font-normal"> (older)</span>}
                  {column.periodLabel && (
                    <span className="block font-normal text-foreground/40"> {column.periodLabel}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {ROWS.map(({ half, label }) => (
              <tr key={half}>
                <th scope="row" className="py-2 pl-3 pr-4 text-left font-medium text-foreground/80 whitespace-nowrap">
                  {label}
                </th>
                {coverage.rows[half].map((cell, i) => {
                  const column = coverage.columns[i]
                  const hover = hoverText(cell)
                  return (
                    <td
                      key={column.key}
                      className={cn('px-3 py-2 whitespace-nowrap', column.extra && 'opacity-60')}
                      title={hover}
                    >
                      <CellContent cell={cell} />
                      {hover && <span className="sr-only">: {hover}</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-foreground/50">
        <span className="text-success">Own file</span> — read from that year&apos;s statements.{' '}
        <span className="text-accent">Comparative</span> — read from the prior-year column of the next
        year&apos;s statements. Hover a cell for the file. Years marked older are kept but not compared.
      </p>
    </div>
  )
}
