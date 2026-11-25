'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { columnTitle, formatPrinted } from '@/lib/printed/csv'
import type { PeriodSources as PeriodSourcesData, PrintedComparison, StatementSource } from '@/lib/printed/compare'
import type { PrintedStatementKind } from '@/lib/printed/types'
import { comparisonProof, type YearProof } from '@/lib/printed/proof'
import { STATEMENT_NAME } from '@/lib/printed/picker'
import { alsoInText, sourceLines, sourceName } from '@/lib/printed/periodSourceText'

/**
 * Each period, below the headline figures, for the Cards and Table views alike (Gabby, 25 Nov 2026):
 * its badges ("Every total on the statements adds up", "Profit and loss agrees with balance sheet",
 * "Carries forward from the previous year"), where its figures come from ("Source: …"), every other
 * file printing them ("Also in: … — ✓ same figures / ⚠ differs on N lines", view), "Use this source
 * instead", a failed check's note with "Use the same source for both", and current-period statements
 * ending on different dates. Choices are kept with who and when (comparison-sources).
 *
 * Hidden by default behind its heading's arrow; the heading says how many periods have something to
 * look at, so a note is never hidden silently.
 */
export function PeriodSources({ clientId, comparison, defaultOpen = false }: { clientId: string; comparison: PrintedComparison; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const proofs = comparisonProof(comparison)
  if (proofs.length === 0) return null
  const flagged = proofs.filter((p) => p.status !== 'proven' || comparison.periodSources?.[p.index]?.endsDiffer).length
  return (
    <section data-testid="period-sources" className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="period-sources-list"
        onClick={() => setOpen((o) => !o)}
        className="no-print flex w-full items-center gap-1.5 text-left text-sm font-semibold text-foreground hover:text-foreground/80"
      >
        <ChevronRight className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        Periods: sources and checks
        <span className={cn('ml-1 text-xs font-normal', flagged ? 'text-warning' : 'text-foreground/50')}>
          {flagged ? `${flagged} period${flagged === 1 ? '' : 's'} to look at` : `${proofs.length} period${proofs.length === 1 ? '' : 's'}, nothing to look at`}
        </span>
      </button>
      {open && (
        <ul id="period-sources-list" data-testid="year-proofs" className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
          {proofs.map((p) => (
            <PeriodCard key={p.column} clientId={clientId} comparison={comparison} proof={p} period={comparison.periodSources?.[p.index]} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PeriodCard({ clientId, comparison, proof, period }: { clientId: string; comparison: PrintedComparison; proof: YearProof; period: PeriodSourcesData | undefined }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = columnTitle(comparison.columns[proof.index])
  const failed = proof.crossChecks.filter((c) => c.status === 'failed')

  async function choose(statement: PrintedStatementKind | 'both', documentId: string | null) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/comparison-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column: proof.column, statement, documentId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save the choice')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the choice')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      data-period={proof.column}
      data-status={proof.status}
      className={cn(
        'space-y-1.5 rounded-lg border px-3 py-2',
        proof.status === 'proven' ? 'border-success/35 bg-success/5' : proof.status === 'held' ? 'border-border bg-surface/60' : 'border-warning/40 bg-warning/5',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-foreground">{t.title}</span>
        <span className="text-[10px] text-foreground/45">{t.period}</span>
      </div>

      {proof.status === 'held' ? (
        <p className="text-foreground/70">Being prepared: {proof.reasons.join('; ')}</p>
      ) : (
        proof.badges.length > 0 && (
          <ul className="space-y-0.5">
            {proof.badges.map((b) => (
              <li key={b} className="flex items-center gap-1 text-success">
                <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
                {b}
              </li>
            ))}
          </ul>
        )
      )}

      {period?.endsDiffer && (
        <p data-testid="ends-differ" className="flex gap-1 text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {period.endsDiffer}
        </p>
      )}

      {/* The accountant's own totals that do not add up, and failed cross-checks: shown as printed, named here; never stopping the prediction. */}
      {proof.status === 'printed_error' && (
        <ul data-testid="printed-total-notes" className="space-y-1 text-foreground/75">
          {proof.notes.map((n, i) => (
            <li key={i} className="flex gap-1">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
          {failed.flatMap((c) =>
            (c.sameSourceOffer ?? []).map((o) => (
              <li key={`${c.check}-${o.documentId}`} className="no-print">
                <button type="button" disabled={busy} onClick={() => choose('both', o.documentId)} className="text-accent hover:underline disabled:opacity-50">
                  Use the same source for both: {sourceName(o)}
                </button>
              </li>
            )),
          )}
        </ul>
      )}

      {period && <Sources period={period} busy={busy} onChoose={choose} />}
      {error && <p className="no-print text-destructive">{error}</p>}
    </li>
  )
}

function Sources({ period, busy, onChoose }: { period: PeriodSourcesData; busy: boolean; onChoose: (s: PrintedStatementKind | 'both', id: string | null) => void }) {
  const lines = sourceLines(period)
  const withOthers = period.statements.filter((s) => s.alsoIn.length > 0)
  const chosen = period.statements.filter((s) => s.chosen)
  return (
    <div className="space-y-1 border-t border-border/40 pt-1.5 text-foreground/70">
      {lines.map((l, i) => (
        <p key={i} data-testid="period-source">
          {l.statement && <span className="text-foreground/50">{l.statement}: </span>}
          Source: {l.source}
          {l.chosen && <span className="text-foreground/50"> ({l.chosen})</span>}
        </p>
      ))}
      {withOthers.map((s) => s.alsoIn.map((a) => <AlsoIn key={`${s.statement}-${a.documentId}`} statement={s} also={a} multiple={withOthers.length > 1} busy={busy} onChoose={onChoose} />))}
      {chosen.length > 0 && (
        <button type="button" disabled={busy} onClick={() => onChoose(chosen.length === 2 ? 'both' : chosen[0].statement, null)} className="no-print text-accent hover:underline disabled:opacity-50">
          Back to the automatic choice
        </button>
      )}
    </div>
  )
}

function AlsoIn({
  statement,
  also,
  multiple,
  busy,
  onChoose,
}: {
  statement: StatementSource
  also: StatementSource['alsoIn'][number]
  multiple: boolean
  busy: boolean
  onChoose: (s: PrintedStatementKind | 'both', id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const same = also.differs.length === 0
  return (
    <div data-testid="also-in">
      <p>
        {multiple && <span className="text-foreground/50">{STATEMENT_NAME[statement.statement]}: </span>}
        Also in: <span className={same ? 'text-foreground/70' : 'text-warning'}>{alsoInText(also)}</span>
        {!same && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="no-print ml-1 text-accent hover:underline">
            {open ? 'hide' : 'view'}
          </button>
        )}
      </p>
      {open && (
        <table className="mt-1 w-full text-[11px] tabular-nums">
          <thead>
            <tr className="text-left text-foreground/45">
              <th className="font-normal">Line</th>
              <th className="text-right font-normal">Used</th>
              <th className="text-right font-normal">This file</th>
            </tr>
          </thead>
          <tbody>
            {also.differs.map((d) => (
              <tr key={d.key}>
                <td className="pr-2">{d.label || '(no label)'}</td>
                <td className="text-right">{formatPrinted(d.source)}</td>
                <td className="text-right">{formatPrinted(d.other)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" disabled={busy} onClick={() => onChoose(statement.statement, also.documentId)} className="no-print text-accent hover:underline disabled:opacity-50">
        Use this source instead
      </button>
    </div>
  )
}
