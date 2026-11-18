'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, ClipboardCheck, HelpCircle, Pencil } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { SourcedAmount } from '@/components/ui/SourcedAmount'
import { cn } from '@/lib/utils'
import { columnTitle, formatPrinted } from '@/lib/printed/csv'
import { KEY_FIGURES, MEANING, type Meaning } from '@/lib/printed/meanings'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { PrintedComparison } from '@/lib/printed/compare'
import { STATEMENT_NAME } from '@/lib/printed/picker'
import { BEING_PREPARED, type HeadlineRow, type LineStatus } from '@/lib/printed/headline'
import { printedLinesSource, type AmountSource } from '@/lib/sources'
import type { Suggestions } from '@/lib/printed/dictionary'
import type { PossibleLine } from '@/lib/printed/autoMapping'
import { audBalance } from '@/lib/ica/types'
import { formatBadgeDate } from '@/lib/ica/view'
import { balanceLine, type IcaHeadlineCell } from '@/lib/ica/balanceAt'
import { KeyFigureCard, isAutoSelected, keyFigureStatus } from './keyFigures/KeyFigureCard'

interface Props {
  clientId: string
  basePath?: string
  comparison: PrintedComparison
  /** headlineRows (printed/headline.ts): the same rows the CSV export writes. */
  rows: HeadlineRow[]
  mapping: MappingEntry[]
  suggestions: Suggestions
  possible?: Partial<Record<Meaning, PossibleLine[]>>
}

const LOOK: Record<LineStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  confirmed: { icon: CheckCircle2, className: 'text-success', label: 'Confirmed' },
  suggested: { icon: AlertCircle, className: 'text-warning', label: 'Suggested — check' },
  not_found: { icon: HelpCircle, className: 'text-destructive', label: 'Not found — choose the line' },
}

/**
 * The headline figures (Gabby, 16 Nov 2026): one row each, years side by side with the current
 * period as the last column. Each figure has its ⓘ (file, page, printed line, "Copy this line");
 * each printed line's row says whether it is confirmed and opens the choice; "Confirm key
 * figures" is always one click away.
 */
export function HeadlineFiguresTable({ clientId, basePath = `/clients/${clientId}`, comparison, rows, mapping, suggestions, possible = {} }: Props) {
  const [open, setOpen] = useState<Meaning | null>(null)
  const keyFigures = `${basePath}/financials-comparison/mapping`
  const entriesOf = (m: Meaning) => mapping.filter((e) => e.meaning === m)
  const confirmed = KEY_FIGURES.filter((m) => keyFigureStatus(entriesOf(m.key), suggestions[m.key]) === 'confirmed').length

  return (
    <section data-testid="headline-figures" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Headline figures</h2>
        <div className="no-print flex flex-wrap items-center gap-2 text-xs">
          <span className={cn('rounded-full px-2.5 py-1 font-medium', confirmed === KEY_FIGURES.length ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
            {confirmed}/{KEY_FIGURES.length} key figures confirmed
          </span>
          <Link
            href={keyFigures}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 font-medium text-foreground/80 hover:bg-surface/60 hover:text-foreground"
          >
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
            Confirm key figures
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-foreground/50">
              <th className="px-3 py-2 font-medium">Figure</th>
              {comparison.columns.map((c) => {
                const t = columnTitle(c)
                return (
                  <th key={c.key} scope="col" className="px-3 py-2 text-right font-medium">
                    <span className="block text-foreground/80">{t.title}</span>
                    <span className="block text-[10px] font-normal text-foreground/40">{t.period}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} data-row={row.key} data-status={row.status ?? undefined} className="border-b border-border/40 last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-medium text-foreground/85">
                  {row.meaning ? <LineLabel row={row} meaning={row.meaning} onOpen={setOpen} /> : (
                    <>
                      {row.label}
                      <span className="block text-[10px] font-normal text-foreground/45">The ATO&apos;s own balance at each period&apos;s end, from the verified ATO account</span>
                    </>
                  )}
                </th>
                {row.cells.map((cell, i) => (
                  <td key={comparison.columns[i].key} className={cn('px-3 py-2 text-right tabular-nums', row.status === 'suggested' ? 'text-foreground/70' : 'text-foreground')}>
                    {cell.kind === 'held' ? (
                      <span className="text-xs text-foreground/55" title={cell.reasons.join('; ')}>
                        {BEING_PREPARED}
                      </span>
                    ) : cell.kind === 'blank' ? (
                      <span className="text-foreground/40" title={cell.why ?? undefined}>
                        —
                      </span>
                    ) : cell.kind === 'ica' ? (
                      <SourcedAmount value={cell.cell.value} format={(v) => audBalance(Math.round(v * 100))} source={icaSource(cell.cell, basePath)} />
                    ) : (
                      <SourcedAmount
                        value={cell.value}
                        format={formatPrinted}
                        source={printedLinesSource(
                          `${row.label}${row.status === 'suggested' ? ' (suggested line, not confirmed yet)' : ''}`,
                          `${STATEMENT_NAME[MEANING[row.meaning!].statement]}, ${columnTitle(comparison.columns[i]).title}`,
                          cell.lines,
                          cell.value,
                          { confirmUrl: keyFigures },
                        )}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.key === 'ica' && r.cells.some((c) => c.kind === 'blank' && c.why === 'No ATO account on file')) && (
        <p className="text-xs text-foreground/50">ATO related debt – ICA: no activity statement account has been uploaded.</p>
      )}

      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open && keyFigureStatus(entriesOf(open), suggestions[open]) === 'confirmed' ? 'Change this key figure' : 'Check this key figure'}
        className="max-w-2xl"
      >
        {open && (
          <ul>
            <KeyFigureCard
              clientId={clientId}
              comparison={comparison}
              meaning={open}
              entries={entriesOf(open)}
              suggestion={suggestions[open]}
              possible={possible[open] ?? []}
              choosing={(possible[open] ?? []).length === 0}
              onDone={() => setOpen(null)}
            />
          </ul>
        )}
      </Dialog>
    </section>
  )
}

/** A printed line's row heading: its name, its state, and the choice. */
function LineLabel({ row, meaning, onOpen }: { row: HeadlineRow; meaning: Meaning; onOpen: (m: Meaning) => void }) {
  const look = LOOK[row.status ?? 'not_found']
  const Icon = look.icon
  return (
    <>
      <span className="flex items-center gap-1.5">
        {row.label}
        <button
          type="button"
          onClick={() => onOpen(meaning)}
          title={look.label}
          aria-label={`${row.label}: ${look.label}`}
          className="no-print rounded-full p-0.5 hover:bg-surface/60"
        >
          <Icon className={cn('h-3.5 w-3.5', look.className)} aria-hidden />
        </button>
      </span>
      {row.status === 'not_found' && (
        <button type="button" onClick={() => onOpen(meaning)} className="no-print block text-[11px] font-normal text-destructive hover:underline">
          No printed line matched — choose the line
        </button>
      )}
      {row.status === 'suggested' && (
        <button type="button" onClick={() => onOpen(meaning)} className="no-print block text-[11px] font-normal text-warning hover:underline">
          Suggested line, not confirmed — check it
        </button>
      )}
      {row.notPrinted && <span className="block text-[11px] font-normal text-foreground/50">{isAutoSelected(row.entries) ? 'Auto-selected: not printed' : 'Confirmed: not printed'}</span>}
      {row.status === 'confirmed' && !row.notPrinted && (
        <button type="button" onClick={() => onOpen(meaning)} className="no-print inline-flex items-center gap-1 text-[11px] font-normal text-accent hover:underline">
          <Pencil className="h-3 w-3" aria-hidden />
          {isAutoSelected(row.entries) ? 'Auto-selected — change' : 'Change'}
        </button>
      )}
    </>
  )
}

/** Where an ICA figure comes from: the ATO's own balance on that day, each account's row as printed. */
function icaSource(cell: IcaHeadlineCell, basePath: string): AmountSource {
  return {
    from: ['ATO related debt – ICA', `The ATO's own running balance at ${formatBadgeDate(cell.date)}, from the ATO account verified against it`, ...cell.balances.map(balanceLine)],
    calculation: cell.balances.length > 1 ? `${cell.balances.map((b) => audBalance(b.cents)).join(' + ')} = ${audBalance(Math.round(cell.value * 100))}` : null,
    link: { kind: 'href', href: `${basePath}/lodgement-compliance-analysis`, label: 'Open the ATO account' },
    copy: cell.balances.map((b) => (b.row ? `${b.row.rawProcessed}\t${b.row.description}\t${b.row.rawBalance}` : audBalance(b.cents))).join('\n'),
  }
}
