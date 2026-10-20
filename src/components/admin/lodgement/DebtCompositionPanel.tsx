'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { debtComposition, type CompositionKey, type CompositionLine, type UncountedGroup } from '@/lib/analysis/debtComposition'
import type { DebtBreakdown, EnrichedRow } from '@/lib/analysis/types'

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})
const AUD_CENTS = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

function fmt(value: number): string {
  return AUD.format(value)
}

/** The balance owing; a credit (ATO owes the client) shows as "$X CR". */
function fmtBalance(value: number): string {
  return value < 0 ? `${AUD.format(-value)} CR` : AUD.format(value)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const longDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** Rows shown under a line before "Show all": interest alone can run to thousands. */
export const ROWS_SHOWN = 50

/** Lines that reduce the balance: shown in brackets. */
const REDUCES: CompositionKey[] = ['payments', 'government', 'otherCredits']
/** Lines that are sums of the lines above them. */
const SUBTOTALS: CompositionKey[] = ['totalDebt', 'composed']

/**
 * Rows from the server carry dates as ISO strings; the composition reads
 * calendar days from Date objects.
 */
export function withDates(rows: readonly EnrichedRow[]): EnrichedRow[] {
  return rows.map((r) => ({
    ...r,
    processedDate: r.processedDate ? new Date(r.processedDate as unknown as string) : null,
    effectiveDate: r.effectiveDate ? new Date(r.effectiveDate as unknown as string) : null,
    periodEnding: r.periodEnding ? new Date(r.periodEnding as unknown as string) : null,
  }))
}

/** What the line shows: brackets for a reduction, a sign for the unexplained difference. */
function display(line: CompositionLine): string {
  if (REDUCES.includes(line.key)) return line.amount === 0 ? fmt(0) : `(${fmt(line.amount)})`
  if (line.key === 'unexplained') return `${line.amount < 0 ? '−' : line.amount > 0 ? '+' : ''}${fmt(Math.abs(line.amount))}`
  if (line.key === 'atoBalance' || line.key === 'opening') return fmtBalance(line.amount)
  return fmt(line.amount)
}

function RowsTable({ line }: { line: CompositionLine }) {
  const [all, setAll] = useState(false)
  const shown = all ? line.rows : line.rows.slice(0, ROWS_SHOWN)
  return (
    <div className="mt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-foreground/40">
            <th className="pb-1.5 pr-3 font-medium">Date</th>
            <th className="pb-1.5 pr-3 font-medium">Description</th>
            <th className="pb-1.5 pr-3 text-right font-medium">Debit</th>
            <th className="pb-1.5 text-right font-medium">Credit</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.rowIndex} className="border-b border-border/40 last:border-0">
              <td className="whitespace-nowrap py-1 pr-3 text-foreground/70">{r.processedDate ? longDate(r.processedDate) : '—'}</td>
              <td className="max-w-xs truncate py-1 pr-3 text-foreground/60" title={r.description}>
                {r.description}
              </td>
              <td className="py-1 pr-3 text-right tabular-nums text-foreground/70">{r.debit ? AUD_CENTS.format(r.debit) : ''}</td>
              <td className="py-1 text-right tabular-nums text-foreground/70">{r.credit ? AUD_CENTS.format(r.credit) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {line.rows.length > ROWS_SHOWN && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1.5 text-xs text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {all ? `Show the first ${ROWS_SHOWN}` : `Show all ${line.rows.length} rows`}
        </button>
      )}
    </div>
  )
}

export function UncountedTable({ groups }: { groups: UncountedGroup[] }) {
  if (groups.length === 0) {
    return <p className="text-xs text-foreground/50">Every row is counted in a line above.</p>
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border text-left text-foreground/40">
          <th className="pb-1.5 pr-3 font-medium">Rows not counted</th>
          <th className="pb-1.5 pr-3 text-right font-medium">Rows</th>
          <th className="pb-1.5 pr-3 text-right font-medium">Debits</th>
          <th className="pb-1.5 text-right font-medium">Credits</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.kind} className="border-b border-border/40 align-top last:border-0">
            <td className="py-1 pr-3 text-foreground/70">
              {g.label}
              <span className="block text-foreground/45">{g.reason}</span>
            </td>
            <td className="py-1 pr-3 text-right tabular-nums text-foreground/70">{g.count}</td>
            <td className="py-1 pr-3 text-right tabular-nums text-foreground/70">{g.debits ? AUD_CENTS.format(g.debits) : ''}</td>
            <td className="py-1 text-right tabular-nums text-foreground/70">{g.credits ? AUD_CENTS.format(g.credits) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LineRow({
  line,
  uncounted,
  atoBalanceDate,
}: {
  line: CompositionLine
  uncounted: UncountedGroup[]
  atoBalanceDate: string | null
}) {
  const [open, setOpen] = useState(false)
  const subtotal = SUBTOTALS.includes(line.key)
  const isBalance = line.key === 'atoBalance'
  const expandable = line.rows.length > 0 || line.key === 'unexplained' || line.explanation !== ''
  const id = `composition-${line.key}`
  const label = isBalance
    ? atoBalanceDate
      ? `Current balance owing (ATO, as at ${longDate(atoBalanceDate)})`
      : 'Current balance owing (ATO)'
    : line.label

  return (
    <li className={cn('border-b border-border/30 last:border-0', (subtotal || isBalance) && 'border-t border-border/60')}>
      <div className="flex items-start justify-between gap-3 px-4 py-1.5">
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((v) => !v)}
            className={cn(
              'flex min-w-0 items-start gap-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              subtotal || isBalance ? 'font-semibold text-foreground' : 'text-foreground/70 hover:text-foreground',
            )}
          >
            {open ? (
              <ChevronDown className="no-print mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="no-print mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <span>
              {label}
              {line.rows.length > 0 && (
                <span className="font-normal text-foreground/40"> · {line.rows.length} ATO row{line.rows.length === 1 ? '' : 's'}</span>
              )}
            </span>
          </button>
        ) : (
          <span className="text-xs text-foreground/70">{label}</span>
        )}
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            subtotal || isBalance ? 'font-bold' : '',
            isBalance
              ? line.amount === 0
                ? 'text-success'
                : 'text-warning'
              : REDUCES.includes(line.key)
                ? 'text-success'
                : 'text-foreground/80',
          )}
        >
          {display(line)}
        </span>
      </div>

      {/* The sentence (and, for the difference, the rows not counted) is always
          in the PDF; on screen it shows when the line is opened. The row list is
          screen only. */}
      <div id={id} className={cn('px-4 pb-2 pl-8', open ? 'block' : 'hidden print:block')}>
        <p className="text-xs text-foreground/50">{line.explanation}</p>
        {line.key === 'unexplained' && (
          <div className="mt-1.5">
            <UncountedTable groups={uncounted} />
          </div>
        )}
        {open && line.rows.length > 0 && (
          <div className="print:hidden">
            <RowsTable line={line} />
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * The debt composition, line by line (debtComposition.ts). Each line opens to
 * what it is and the ATO rows behind it; "Other adjustments / unexplained
 * difference" opens to the rows no line counts. In the PDF every line's
 * sentence and the rows not counted are shown; the row lists are not (their
 * counts are).
 */
export function DebtCompositionPanel({ debtBreakdown, rows }: { debtBreakdown: DebtBreakdown; rows: EnrichedRow[] }) {
  const composition = useMemo(() => debtComposition(withDates(rows), debtBreakdown), [rows, debtBreakdown])
  // The ATO's balance closes the table, after the line that reconciles to it.
  const lines = [
    ...composition.lines.filter((l) => l.key !== 'atoBalance'),
    ...composition.lines.filter((l) => l.key === 'atoBalance'),
  ]
  const hasAtoBalance = lines.some((l) => l.key === 'atoBalance')

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Debt Composition</h3>
      <p className="no-print text-xs text-foreground/40">Open a line to see what it is and the ATO rows behind it.</p>

      <ul className="overflow-x-auto rounded-lg border border-border bg-surface/50">
        {lines.map((line) => (
          <LineRow key={line.key} line={line} uncounted={composition.uncounted} atoBalanceDate={debtBreakdown.atoBalanceDate} />
        ))}
        {!hasAtoBalance && (
          <li className="flex items-start justify-between gap-3 border-t border-border/60 px-4 py-1.5">
            <span className="text-xs font-semibold text-foreground">Current balance owing</span>
            <span className={cn('text-xs font-bold tabular-nums', debtBreakdown.currentBalance === 0 ? 'text-success' : 'text-warning')}>
              {fmtBalance(debtBreakdown.currentBalance)}
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}
