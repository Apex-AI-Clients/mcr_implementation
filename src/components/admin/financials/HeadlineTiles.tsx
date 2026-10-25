'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertCircle, CheckCircle2, ClipboardCheck, HelpCircle } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import { columnTitle, formatPrinted } from '@/lib/printed/csv'
import { KEY_FIGURES, MEANINGS, type Meaning } from '@/lib/printed/meanings'
import { resolveMeaning, type MappingEntry } from '@/lib/printed/mapping'
import type { ComparisonRow, PrintedComparison } from '@/lib/printed/compare'
import { describeLine } from '@/lib/printed/picker'
import type { Suggestions } from '@/lib/printed/dictionary'
import { KeyFigureCard, keyFigureStatus, type KeyFigureStatus } from './keyFigures/KeyFigureCard'

interface Props {
  clientId: string
  comparison: PrintedComparison
  mapping: MappingEntry[]
  suggestions: Suggestions
}

/** Per status: the tile's top edge, its corner icon, and the review bar's segment. */
const LOOK: Record<KeyFigureStatus, { edge: string; segment: string; icon: typeof CheckCircle2; iconClass: string; label: string }> = {
  confirmed: { edge: 'border-t-success', segment: 'bg-success', icon: CheckCircle2, iconClass: 'text-success', label: 'Confirmed' },
  suggested: { edge: 'border-t-warning', segment: 'bg-warning', icon: AlertCircle, iconClass: 'text-warning', label: 'Suggested — check' },
  not_found: { edge: 'border-t-destructive border-dashed', segment: 'bg-destructive', icon: HelpCircle, iconClass: 'text-destructive', label: 'Not found — choose the line' },
}

/**
 * The headline figures. A confirmed figure is its printed line (or lines,
 * added up, each named). A suggested one shows the suggested line's figure,
 * marked amber until staff check it; one not found is marked red. While any
 * key figure is unconfirmed, a review bar shows each one's state at a glance
 * and leads to "Confirm key figures". The SBR prediction uses only confirmed
 * lines.
 */
export function HeadlineTiles({ clientId, comparison, mapping, suggestions }: Props) {
  const [open, setOpen] = useState<Meaning | null>(null)
  const tiles = MEANINGS.filter((m) => m.tile)
  const keyFigures = `/clients/${clientId}/financials-comparison/mapping`
  const entriesOf = (m: Meaning) => mapping.filter((e) => e.meaning === m)
  const statusOf = (m: Meaning) => keyFigureStatus(entriesOf(m), suggestions[m])
  const confirmed = KEY_FIGURES.filter((m) => statusOf(m.key) === 'confirmed').length
  const allConfirmed = confirmed === KEY_FIGURES.length
  const allRows = comparison.tables.flatMap((t) => t.rows)

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Headline figures</h2>
        {allConfirmed && (
          <Link href={keyFigures} className="no-print inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success hover:bg-success/25">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            All key figures confirmed
          </Link>
        )}
      </div>

      {!allConfirmed && (
        <div role="status" aria-label="Key figures to review" className="no-print mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning">
            <ClipboardCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-[14rem] flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {confirmed}
                <span className="text-base text-foreground/45">/{KEY_FIGURES.length}</span>
              </span>
              <span className="text-xs font-medium text-foreground/70">key figures confirmed</span>
            </div>
            {/* One segment per key figure, coloured by its state; click one to check it. */}
            <div className="mt-2 flex gap-1" aria-hidden>
              {KEY_FIGURES.map((m) => {
                const s = statusOf(m.key)
                return (
                  <button
                    key={m.key}
                    type="button"
                    tabIndex={-1}
                    title={`${m.label}: ${LOOK[s].label}`}
                    onClick={() => setOpen(m.key)}
                    className={cn('h-2 flex-1 rounded-full transition-opacity hover:opacity-80', LOOK[s].segment, s !== 'confirmed' && 'opacity-90')}
                  />
                )
              })}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-foreground/55">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> Confirmed
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-warning" aria-hidden /> To check
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden /> Not found
              </span>
            </div>
          </div>
          <Link
            href={keyFigures}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent/90"
          >
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
            Review key figures
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((info) => {
          const entries = entriesOf(info.key)
          const status = statusOf(info.key)
          const look = LOOK[status]
          const Icon = look.icon
          const used: MappingEntry[] =
            status === 'confirmed'
              ? entries
              : suggestions[info.key].map((rowKey) => ({ meaning: info.key, rowKey, label: null, nonePrinted: false, confirmedBy: '', confirmedAt: '' }))
          const resolved = resolveMeaning(comparison, used, info.key)
          const shown = resolved.years.filter((y) => y.value !== null)
          const latest = shown[shown.length - 1]
          // The printed line(s) the figure is taken from: named first, so nobody wonders where it came from.
          const sources = used
            .filter((e) => !e.nonePrinted)
            .map((e) => allRows.find((r) => r.key === e.rowKey))
            .filter((r): r is ComparisonRow => !!r)
            .map((r) => describeLine(r, info.key))
          return (
            <div
              key={info.key}
              data-status={status}
              className={cn('relative rounded-lg border border-border/60 border-t-4 bg-card p-3', look.edge)}
            >
              <button
                type="button"
                onClick={() => setOpen(info.key)}
                title={look.label}
                aria-label={`${info.label}: ${look.label}`}
                className="no-print absolute right-2 top-2 rounded-full p-0.5 hover:bg-surface/60"
              >
                <Icon className={cn('h-4 w-4', look.iconClass)} aria-hidden />
              </button>
              <p className="pr-6 text-[11px] font-semibold uppercase tracking-wide text-foreground/55">{info.label}</p>

              {/* Where the figure comes from, before the figure. */}
              {status === 'not_found' ? (
                <div className="mt-2 rounded-md border border-dashed border-destructive/50 bg-destructive/5 p-2 text-xs">
                  <p className="font-medium text-destructive">No printed line matched this figure.</p>
                  <p className="mt-0.5 text-foreground/60">The statements don&apos;t print a line with this name. Pick the line that holds it, or say it isn&apos;t printed.</p>
                  <button type="button" onClick={() => setOpen(info.key)} className="no-print mt-1.5 font-medium text-accent hover:underline">
                    Choose the line
                  </button>
                </div>
              ) : status === 'suggested' ? (
                <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                  <p className="font-medium text-warning">Not confirmed yet — suggested match:</p>
                  <SourceLines sources={sources} />
                  <button
                    type="button"
                    onClick={() => setOpen(info.key)}
                    className="no-print mt-1.5 inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-warning hover:bg-warning/30"
                  >
                    <AlertCircle className="h-3 w-3" aria-hidden />
                    Check this match
                  </button>
                </div>
              ) : resolved.status === 'none' ? (
                <p className="mt-2 text-xs text-foreground/60">Confirmed: the statements don&apos;t print this.</p>
              ) : (
                <div className="mt-2 text-xs">
                  <p className="text-success">{sources.length > 1 ? `From ${sources.length} printed lines, added up:` : 'From the printed line:'}</p>
                  <SourceLines sources={sources} />
                </div>
              )}

              {status !== 'not_found' && resolved.status !== 'none' && (
                latest ? (
                  <>
                    <p className="mt-3 text-[10px] uppercase tracking-wide text-foreground/45">
                      {status === 'suggested' ? (sources.length > 1 ? 'Amount on those lines' : 'Amount on that line') : 'Amount'}, {columnTitle(latest.column).title}
                    </p>
                    <p className={cn('text-lg font-semibold tabular-nums', status === 'confirmed' ? 'text-foreground' : 'text-foreground/70')}>{formatPrinted(latest.value)}</p>
                    <ul className="mt-2 space-y-0.5 text-[11px] tabular-nums text-foreground/65">
                      {resolved.years.map((y) => (
                        <li key={y.column.key} className="flex justify-between gap-2">
                          <span>{columnTitle(y.column).title}</span>
                          <span>{y.value === null ? '—' : formatPrinted(y.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-foreground/60">That line has no amount printed for these years.</p>
                )
              )}
            </div>
          )
        })}
      </div>

      <Dialog open={open !== null} onClose={() => setOpen(null)} title="Check this key figure" className="max-w-2xl">
        {open && (
          <ul>
            <KeyFigureCard
              clientId={clientId}
              comparison={comparison}
              meaning={open}
              entries={entriesOf(open)}
              suggestion={suggestions[open]}
              choosing
              onDone={() => setOpen(null)}
            />
          </ul>
        )}
      </Dialog>
    </section>
  )
}

/** The printed line(s) a figure is taken from: “label”, and where it sits. */
function SourceLines({ sources }: { sources: { label: string; where: string }[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {sources.map((s, i) => (
        <li key={i}>
          <span className="font-medium text-foreground">“{s.label}”</span>
          <span className="block text-[10px] text-foreground/50">{s.where}</span>
        </li>
      ))}
    </ul>
  )
}
