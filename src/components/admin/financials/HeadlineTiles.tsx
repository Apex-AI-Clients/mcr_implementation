'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Dialog } from '@/components/ui/Dialog'
import { columnTitle, formatPrinted } from '@/lib/printed/csv'
import { MEANING, MEANINGS, type Meaning } from '@/lib/printed/meanings'
import { resolveMeaning, type MappingEntry } from '@/lib/printed/mapping'
import type { PrintedComparison } from '@/lib/printed/compare'
import type { Suggestions } from '@/lib/printed/dictionary'
import { KeyFigureCard, keyFigureStatus } from './keyFigures/KeyFigureCard'

interface Props {
  clientId: string
  comparison: PrintedComparison
  mapping: MappingEntry[]
  suggestions: Suggestions
}

/**
 * The headline figures. A confirmed figure is its printed line (or lines,
 * added up, each named). A suggested one shows the suggested line's figure
 * with "Suggested — check", which opens the same card as "Confirm key
 * figures"; confirming there saves the mapping. The SBR prediction uses only
 * confirmed lines.
 */
export function HeadlineTiles({ clientId, comparison, mapping, suggestions }: Props) {
  const [open, setOpen] = useState<Meaning | null>(null)
  const tiles = MEANINGS.filter((m) => m.tile)
  const keyFigures = `/clients/${clientId}/financials-comparison/mapping`
  const entriesOf = (m: Meaning) => mapping.filter((e) => e.meaning === m)

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Headline figures</h2>
        <Link href={keyFigures} className="no-print text-xs text-accent hover:underline">
          Confirm key figures
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((info) => {
          const entries = entriesOf(info.key)
          const status = keyFigureStatus(entries, suggestions[info.key])
          const used: MappingEntry[] =
            status === 'confirmed'
              ? entries
              : suggestions[info.key].map((rowKey) => ({ meaning: info.key, rowKey, label: null, nonePrinted: false, confirmedBy: '', confirmedAt: '' }))
          const resolved = resolveMeaning(comparison, used, info.key)
          const shown = resolved.years.filter((y) => y.value !== null)
          const latest = shown[shown.length - 1]
          return (
            <div key={info.key} className="rounded-lg border border-border/60 bg-card p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">{info.label}</p>
              {status === 'not_found' ? (
                <p className="mt-2 text-xs text-foreground/60">
                  Not identified —{' '}
                  <button type="button" onClick={() => setOpen(info.key)} className="no-print text-accent hover:underline">
                    choose the line
                  </button>
                </p>
              ) : resolved.status === 'none' ? (
                <p className="mt-2 text-xs text-foreground/60">Not printed in the statements.</p>
              ) : !latest ? (
                <p className="mt-2 text-xs text-foreground/60">The chosen line is not printed for these years.</p>
              ) : (
                <>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatPrinted(latest.value)}</p>
                  <p className="text-[10px] text-foreground/45">{columnTitle(latest.column).title}</p>
                  <ul className="mt-2 space-y-0.5 text-[11px] tabular-nums text-foreground/65">
                    {resolved.years.map((y) => (
                      <li key={y.column.key} className="flex justify-between gap-2">
                        <span>{columnTitle(y.column).title}</span>
                        <span>{y.value === null ? '' : formatPrinted(y.value)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10px] leading-snug text-foreground/45">
                    {latest.lines.length === 1 ? 'Printed as' : 'Printed lines added up'}: {latest.lines.map((l) => `“${l.label}”`).join(' + ')}
                  </p>
                </>
              )}
              {status === 'suggested' && (
                <button type="button" onClick={() => setOpen(info.key)} className="no-print mt-2 text-[11px] font-medium text-warning hover:underline">
                  Suggested — check
                </button>
              )}
            </div>
          )
        })}
      </div>

      <Dialog open={open !== null} onClose={() => setOpen(null)} title={open ? MEANING[open].label : ''} className="max-w-2xl">
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
