import { cn } from '@/lib/utils'
import { formatPrinted } from '@/lib/printed/csv'
import type { ComparisonColumn, ComparisonRow } from '@/lib/printed/compare'

const short = (c: ComparisonColumn) => (c.kind === 'annual' ? c.key : 'Current')

/** Sum of the printed figures of several lines, per year; null where none prints. */
export function totalsPerYear(rows: ComparisonRow[], columns: ComparisonColumn[]): (number | null)[] {
  return columns.map((_, i) => {
    const values = rows.flatMap((r) => (r.cells[i]?.printed && typeof r.cells[i].value === 'number' ? [r.cells[i].value as number] : []))
    return values.length ? values.reduce((a, b) => a + b, 0) : null
  })
}

/** One line's (or a total's) figure for every year, in a row: "FY2023 1,234 · FY2024 —". */
export function YearValues({ columns, values, className }: { columns: ComparisonColumn[]; values: (number | string | null | undefined)[]; className?: string }) {
  return (
    <dl className={cn('flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] tabular-nums', className)}>
      {columns.map((c, i) => (
        <div key={c.key} className="flex gap-1.5">
          <dt className="text-foreground/45">{short(c)}</dt>
          <dd className="text-foreground/80">{values[i] === undefined || values[i] === null ? '—' : formatPrinted(values[i] as number | string)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A row's printed figures per year ("—" where that year does not print it). */
export function rowValues(row: ComparisonRow): (number | string | null | undefined)[] {
  return row.cells.map((c) => (c.printed ? c.value : undefined))
}
