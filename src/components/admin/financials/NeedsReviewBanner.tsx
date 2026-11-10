'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { hardChecksFingerprint, reviewLine, type FiguresChecked } from '@/lib/financials/hardChecks'
import type { FinancialCheck } from '@/lib/financials/types'

interface Props {
  clientId: string
  /** The failed hard checks (hardCheckFailures). Nothing shows without one. */
  failures: FinancialCheck[]
  generatedAt: string | null
  checked: FiguresChecked | null
  onChecked: (checked: FiguresChecked) => void
}

/**
 * "Totals that don't add up", at the bottom of the comparison page, when a
 * hard check fails — a total, the balance-sheet equation, a profit identity
 * (±$5) or the retained-earnings roll-forward. It never stops the SBR
 * prediction (Gabby, 10 Nov 2026). The PDF and CSV export wait for a staff
 * member to tick that they checked the figures against the source documents;
 * the tick covers this build only. Once ticked, "Reviewed by X on <date>"
 * prints on the PDF.
 */
export function NeedsReviewBanner({ clientId, failures, generatedAt, checked, onChecked }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fingerprint = hardChecksFingerprint(generatedAt, failures)
  if (!fingerprint) return null
  const done = reviewLine(failures, generatedAt, checked)

  async function tick() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/financials-comparison/figures-checked`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.checked) throw new Error(body.error ?? 'Failed to save')
      onChecked(body.checked as FiguresChecked)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="Totals that don't add up" className="rounded-lg border border-warning/40 bg-warning/5 p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        {failures.length === 1 ? '1 total does' : `${failures.length} totals do`} not add up
      </h2>
      <p className="mt-1 text-xs text-foreground/65">
        A printed total does not match the lines above it, as read from the file. Worth a look against the PDF; it does not stop the SBR prediction.
      </p>
      <ul className="mt-2 ml-6 list-disc space-y-1 text-xs text-foreground/75">
        {failures.map((c, i) => (
          <li key={i}>
            {c.financialYear !== null && <span className="font-medium">{c.currentPeriod ? 'Current period' : `FY${c.financialYear}`}: </span>}
            {c.message}
          </li>
        ))}
      </ul>
      {/* The reviewed line prints on the PDF; the tick itself does not. */}
      <div className={`mt-3 border-t border-warning/20 pt-2 ${done ? '' : 'no-print'}`}>
        {done ? (
          <p className="flex items-center gap-1.5 text-xs text-foreground/70">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
            {done}: checked against the source documents.
          </p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
              <input type="checkbox" checked={false} disabled={saving} onChange={tick} className="accent-accent" />
              I&apos;ve checked these figures against the source documents
            </label>
            <p className="mt-1 text-[11px] text-foreground/55">Needed only to export the PDF or CSV.</p>
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </>
        )}
      </div>
    </section>
  )
}
