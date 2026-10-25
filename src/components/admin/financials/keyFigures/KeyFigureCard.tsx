'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { describeLine } from '@/lib/printed/picker'
import { MEANING, type Meaning } from '@/lib/printed/meanings'
import type { ComparisonRow, PrintedComparison } from '@/lib/printed/compare'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { MappingSelection } from '@/lib/printed/mappingStore'
import { KeyFigurePicker } from './KeyFigurePicker'
import { YearValues, rowValues, totalsPerYear } from './YearValues'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const shortDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Saves one or more meanings (mappingStore.ts), then reloads the page's data. */
export function useConfirmKeyFigures(clientId: string) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirm(selection: MappingSelection): Promise<boolean> {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/line-mapping`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selection }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to save')
      router.refresh()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      return false
    } finally {
      setSaving(false)
    }
  }
  return { confirm, saving, error }
}

export type KeyFigureStatus = 'confirmed' | 'suggested' | 'not_found'

export function keyFigureStatus(entries: MappingEntry[], suggestion: string[]): KeyFigureStatus {
  return entries.length ? 'confirmed' : suggestion.length ? 'suggested' : 'not_found'
}

interface Props {
  clientId: string
  comparison: PrintedComparison
  meaning: Meaning
  /** What staff confirmed for this meaning (empty: nothing yet). */
  entries: MappingEntry[]
  /** The dictionary's suggestion, used until staff confirm. */
  suggestion: string[]
  /** The suggestion is Claude's, from the label only (labelSuggestions.ts), not the dictionary's. */
  aiSuggested?: boolean
  /** Open with the picker showing (from a tile's "Suggested — check"). */
  choosing?: boolean
  onDone?: () => void
}

/**
 * One key figure: what it is, the printed line it is (or the lines adding up
 * to it), that line's figure for every year, and its status: Suggested until
 * staff say "Yes, that's right" or choose another; then Confirmed, by whom
 * and when, with "Change".
 */
export function KeyFigureCard({ clientId, comparison, meaning, entries, suggestion, aiSuggested = false, choosing = false, onDone }: Props) {
  const info = MEANING[meaning]
  const { confirm, saving, error } = useConfirmKeyFigures(clientId)
  const [picking, setPicking] = useState(choosing)
  const status = keyFigureStatus(entries, suggestion)
  const nonePrinted = entries.some((e) => e.nonePrinted)
  const keys = status === 'confirmed' ? entries.filter((e) => !e.nonePrinted).map((e) => e.rowKey) : suggestion
  const rows = comparison.tables.flatMap((t) => t.rows)
  const lines = keys.map((k) => rows.find((r) => r.key === k)).filter((r): r is ComparisonRow => !!r)
  const missing = keys.length - lines.length
  const confirmedBy = entries[0]

  async function save(answer: NonNullable<MappingSelection[Meaning]>) {
    if (await confirm({ [meaning]: answer })) {
      setPicking(false)
      onDone?.()
    }
  }

  return (
    <li className="rounded-lg border border-border/60 bg-card p-4" aria-label={info.label}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{info.label}</h3>
            {info.prediction && <Badge variant="accent">Used in the SBR prediction</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-foreground/60">{info.hint}</p>
        </div>
        {/* The status stays top-right, beside the title, however long the explanation. */}
        <div className="shrink-0">
          {status === 'confirmed' ? (
            <Badge variant="success">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              Confirmed by {confirmedBy.confirmedBy}, {shortDate(confirmedBy.confirmedAt)}
            </Badge>
          ) : status === 'suggested' ? (
            <Badge variant="warning">{aiSuggested ? 'Suggested by AI' : 'Suggested'}</Badge>
          ) : (
            <Badge variant="destructive">Not found</Badge>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {nonePrinted ? (
          <p className="text-xs text-foreground/70">The statements don&apos;t print this.</p>
        ) : lines.length === 0 ? (
          <p className="text-xs text-foreground/60">No printed line was matched. Choose the line, or say the statements don&apos;t print it.</p>
        ) : (
          lines.map((row) => {
            const { label, where } = describeLine(row, meaning)
            return (
              <div key={row.key} className="rounded border border-border/40 px-3 py-2">
                <p className="text-xs">
                  <span className="font-medium text-foreground">“{label}”</span>
                  <span className="text-foreground/50"> — {where}</span>
                </p>
                <YearValues columns={comparison.columns} values={rowValues(row)} className="mt-1" />
              </div>
            )
          })
        )}
        {lines.length > 1 && (
          <div className="px-3">
            <p className="text-[11px] font-medium text-foreground/70">Added up</p>
            <YearValues columns={comparison.columns} values={totalsPerYear(lines, comparison.columns)} />
          </div>
        )}
        {missing > 0 && <p className="text-xs text-warning">A chosen line is no longer printed. Choose again.</p>}
        {status === 'suggested' && aiSuggested && (
          <p className="text-xs text-foreground/60">Suggested by Claude from the printed label and headings only. Check the figures before confirming.</p>
        )}
      </div>

      {!picking && (
        <div className="mt-3 flex flex-wrap gap-2">
          {status === 'suggested' && (
            <Button size="sm" variant="primary" loading={saving} disabled={saving} onClick={() => save({ rowKeys: suggestion })}>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Yes, that&apos;s right
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPicking(true)} disabled={saving}>
            {status === 'confirmed' ? 'Change' : status === 'suggested' ? 'Choose another' : 'Choose the line'}
          </Button>
        </div>
      )}
      {picking && (
        <KeyFigurePicker
          comparison={comparison}
          meaning={meaning}
          current={keys}
          currentNone={nonePrinted}
          saving={saving}
          onSave={save}
          onCancel={() => {
            setPicking(false)
            onDone?.()
          }}
        />
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </li>
  )
}
