'use client'

import { AlertTriangle, ScanLine } from 'lucide-react'
import { cn } from '@/lib/utils'
import { columnTitle, formatPrinted } from '@/lib/printed/csv'
import type { ComparisonCell, ComparisonColumn, ComparisonRow, ComparisonTable } from '@/lib/printed/compare'

export interface SelectedFigure {
  row: ComparisonRow
  column: ComparisonColumn
  cell: ComparisonCell
}

interface Props {
  table: ComparisonTable
  columns: ComparisonColumn[]
  selected: SelectedFigure | null
  onSelect: (figure: SelectedFigure) => void
}

/**
 * One statement as printed, years side by side: the printed lines under their
 * printed headings, each figure exactly as printed. Click a figure for the
 * file, page and line it came from. Nothing here is calculated.
 *
 * A year read from a scan says so in its header ("Scanned PDF", with what
 * that means on hover); a scanned figure staff corrected is marked so.
 */
export function PrintedComparisonTable({ table, columns, selected, onSelect }: Props) {
  const scanned = columns.map((_, i) => table.rows.some((r) => r.cells[i]?.scan))
  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-3">{table.title}</h2>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-primary/30 text-left text-foreground/45">
              <th className="py-2 pl-3 pr-4 font-medium">Line, as printed</th>
              {columns.map((c) => {
                const t = columnTitle(c)
                return (
                  <th key={c.key} className={cn('py-2 pr-4 font-medium text-right', c.kind === 'current_period' && 'pl-4 border-l border-border/40')}>
                    <span className="block text-foreground/70">{t.title}</span>
                    <span className="block text-[10px] font-normal text-foreground/40">{t.period}</span>
                    {scanned[columns.indexOf(c)] && (
                      <span
                        title="This year came as a scanned PDF (pictures of the pages, no text inside), so Claude read each figure from the page image. Every printed total is checked to add up, as for any statement; click a figure to see its line on the scan and correct it if needed. A digital PDF from the accountant is always exact."
                        className="mt-0.5 inline-flex cursor-help items-center gap-1 rounded bg-accent/15 px-1.5 py-px text-[10px] font-medium text-accent"
                      >
                        <ScanLine className="h-3 w-3" aria-hidden />
                        Scanned PDF
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr
                key={row.key}
                className={cn(
                  'border-b border-border/40 last:border-b-0',
                  row.style === 'subtotal' && 'bg-primary/20',
                  row.style === 'total' && 'border-t-2 border-t-foreground/40 bg-primary/30',
                )}
              >
                <td
                  className={cn(
                    'py-1.5 pr-4',
                    row.style === 'heading' && 'pt-3 text-[11px] font-semibold uppercase tracking-wide text-foreground/55',
                    row.style === 'subtotal' && 'font-semibold text-foreground',
                    row.style === 'total' && 'font-bold text-foreground',
                    (row.style === 'line' || row.style === 'ratio') && 'text-foreground/80',
                  )}
                  style={{ paddingLeft: `${12 + row.path.length * 14}px` }}
                >
                  {row.label || <span className="text-foreground/30">(no label)</span>}
                </td>
                {row.cells.map((cell, i) => (
                  <td
                    key={columns[i].key}
                    className={cn('py-1.5 pr-4 text-right tabular-nums align-top', columns[i].kind === 'current_period' && 'pl-4 border-l border-border/40')}
                  >
                    {row.style !== 'heading' && (
                      <Figure
                        cell={cell}
                        emphasis={row.style === 'subtotal' || row.style === 'total'}
                        active={selected?.row.key === row.key && selected.column.key === columns[i].key}
                        onClick={() => onSelect({ row, column: columns[i], cell })}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Figure({ cell, emphasis, active, onClick }: { cell: ComparisonCell; emphasis: boolean; active: boolean; onClick: () => void }) {
  const failed = cell.check === 'mismatch' || cell.check === 'wrong_column'
  const corrected = cell.scan?.status === 'chosen'
  if (!cell.printed && cell.restated.length === 0) return null
  return (
    <span className="inline-flex flex-col items-end">
      {cell.printed ? (
        <button
          type="button"
          onClick={onClick}
          title={corrected ? `Corrected by ${cell.scan!.chosenBy}` : 'Where this figure is printed'}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-surface/60 focus:outline-none focus:ring-1 focus:ring-accent',
            emphasis && 'font-semibold',
            failed && 'text-destructive',
            corrected && 'underline decoration-dotted decoration-accent underline-offset-2',
            active && 'ring-1 ring-accent',
          )}
        >
          {failed && <AlertTriangle className="h-3 w-3" aria-label="Does not add up" />}
          {formatPrinted(cell.value)}
        </button>
      ) : null}
      {cell.restated.map((r, i) => (
        <span key={i} className="mt-0.5 max-w-[11rem] text-[10px] leading-tight text-warning">
          Restated in {r.report.replace(/^the /, '')}: {formatPrinted(r.value)}
        </span>
      ))}
    </span>
  )
}
