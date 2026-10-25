import Link from 'next/link'
import { columnTitle, formatPrinted } from '@/lib/printed/csv'
import { MEANING } from '@/lib/printed/meanings'
import type { ResolvedMeaning } from '@/lib/printed/mapping'

interface Props {
  clientId: string
  meanings: ResolvedMeaning[]
}

/**
 * The headline figures: revenue, net profit, net assets, ATO-related debt,
 * income tax payable and the loan accounts. Each is the printed line staff
 * confirmed it to be (or those lines added up, each named); with no
 * confirmed line it says so. Never guessed.
 */
export function HeadlineTiles({ clientId, meanings }: Props) {
  const tiles = meanings.filter((m) => MEANING[m.meaning].tile)
  const choose = `/clients/${clientId}/financials-comparison/mapping`
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Headline figures</h2>
        <Link href={choose} className="no-print text-xs text-accent hover:underline">
          Which lines mean what
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((m) => {
          const info = MEANING[m.meaning]
          const shown = m.years.filter((y) => y.value !== null)
          const latest = shown[shown.length - 1]
          return (
            <div key={m.meaning} className="rounded-lg border border-border/60 bg-card p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/55">{info.label}</p>
              {m.status === 'not_identified' ? (
                <p className="mt-2 text-xs text-foreground/60">
                  Not identified —{' '}
                  <Link href={choose} className="text-accent hover:underline">
                    choose the line
                  </Link>
                </p>
              ) : m.status === 'none' ? (
                <p className="mt-2 text-xs text-foreground/60">Not printed in the statements.</p>
              ) : !latest ? (
                <p className="mt-2 text-xs text-foreground/60">The chosen line is not printed for these years.</p>
              ) : (
                <>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatPrinted(latest.value)}</p>
                  <p className="text-[10px] text-foreground/45">{columnTitle(latest.column).title}</p>
                  <ul className="mt-2 space-y-0.5 text-[11px] tabular-nums text-foreground/65">
                    {m.years.map((y) => (
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
              {m.missing.length > 0 && <p className="mt-1 text-[10px] text-warning">No longer printed: {m.missing.join(', ')}. Choose again.</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
