'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { columnTitle, formatPrinted } from '@/lib/printed/csv'
import { MEANINGS, type Meaning } from '@/lib/printed/meanings'
import type { ComparisonRow, PrintedComparison } from '@/lib/printed/compare'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { Suggestions } from '@/lib/printed/dictionary'
import type { MappingChange } from '@/lib/printed/mappingStore'

interface Props {
  clientId: string
  clientName: string
  comparison: PrintedComparison
  mapping: MappingEntry[]
  suggestions: Suggestions
  changes: MappingChange[]
}

type Answer = { rowKeys: string[]; none: boolean; suggested: boolean }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** The latest figure a row prints, for choosing: "FY2025: 1,234". */
function latestPrinted(row: ComparisonRow, comparison: PrintedComparison): string {
  for (let i = row.cells.length - 1; i >= 0; i--) {
    const cell = row.cells[i]
    if (cell.printed) return `${columnTitle(comparison.columns[i]).title}: ${formatPrinted(cell.value)}`
  }
  return 'not printed'
}

/**
 * Staff confirm, once per client, which printed lines mean what. Starts from
 * the saved mapping, else the dictionary's suggestions (marked as such).
 * Every meaning is answered: lines, or "not printed".
 */
export function LineMappingClient({ clientId, clientName, comparison, mapping, suggestions, changes }: Props) {
  const router = useRouter()
  const rowsByKind = useMemo(
    () => Object.fromEntries(comparison.tables.map((t) => [t.kind, t.rows.filter((r) => r.style !== 'heading')])) as Record<string, ComparisonRow[]>,
    [comparison],
  )
  const rowByKey = useMemo(() => new Map(comparison.tables.flatMap((t) => t.rows.map((r) => [r.key, r]))), [comparison])
  const [answers, setAnswers] = useState<Record<Meaning, Answer>>(() => {
    const out = {} as Record<Meaning, Answer>
    for (const m of MEANINGS) {
      const saved = mapping.filter((e) => e.meaning === m.key)
      out[m.key] = saved.length
        ? { rowKeys: saved.filter((e) => !e.nonePrinted).map((e) => e.rowKey), none: saved.some((e) => e.nonePrinted), suggested: false }
        : { rowKeys: suggestions[m.key], none: false, suggested: suggestions[m.key].length > 0 }
    }
    return out
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmed = mapping.length > 0 ? mapping.reduce((a, b) => (a.confirmedAt > b.confirmedAt ? a : b)) : null
  const unanswered = MEANINGS.filter((m) => !answers[m.key].none && answers[m.key].rowKeys.length === 0)

  const update = (meaning: Meaning, change: Partial<Answer>) => setAnswers((a) => ({ ...a, [meaning]: { ...a[meaning], ...change, suggested: false } }))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const selection = Object.fromEntries(MEANINGS.map((m) => [m.key, answers[m.key].none ? { none: true } : { rowKeys: answers[m.key].rowKeys }]))
      const res = await fetch(`/api/admin/clients/${clientId}/line-mapping`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selection }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to save')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href={`/clients/${clientId}/financials-comparison`} className="inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the statements
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Which printed lines mean what</h1>
        <p className="text-sm text-foreground/60">{clientName}</p>
        <p className="text-xs text-foreground/50">
          The headline tiles and the SBR prediction use only the lines confirmed here. Suggestions come from the printed labels; check each one.
        </p>
        {confirmed && (
          <p className="flex items-center gap-1.5 text-xs text-foreground/70">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
            Confirmed by {confirmed.confirmedBy} on {when(confirmed.confirmedAt)}.
          </p>
        )}
      </div>

      <ul className="space-y-3">
        {MEANINGS.map((m) => {
          const answer = answers[m.key]
          const options = (rowsByKind[m.statement] ?? []).filter((r) => !answer.rowKeys.includes(r.key))
          return (
            <li key={m.key} className="rounded-lg border border-border/60 bg-surface/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{m.label}</span>
                {answer.suggested && <Badge variant="warning">Suggested</Badge>}
                {!answer.none && answer.rowKeys.length === 0 && <Badge variant="destructive">Not identified</Badge>}
              </div>
              <p className="mt-0.5 text-[11px] text-foreground/50">{m.hint}</p>
              {!answer.none && (
                <div className="mt-2 space-y-1">
                  {answer.rowKeys.map((key) => {
                    const row = rowByKey.get(key)
                    return (
                      <div key={key} className="flex items-center justify-between gap-2 rounded border border-border/40 px-2 py-1 text-xs">
                        <span>
                          <span className="text-foreground/45">{row?.path.join(' › ') || '—'} › </span>
                          <span className="text-foreground">{row?.label || '(no label)'}</span>
                          <span className="ml-2 text-foreground/45">{row ? latestPrinted(row, comparison) : 'no longer printed'}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => update(m.key, { rowKeys: answer.rowKeys.filter((k) => k !== key) })}
                          className="rounded p-0.5 text-foreground/40 hover:text-foreground"
                          aria-label={`Remove ${row?.label ?? 'line'}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                  <select
                    value=""
                    onChange={(e) => e.target.value && update(m.key, { rowKeys: [...answer.rowKeys, e.target.value] })}
                    className="w-full rounded border border-border/60 bg-input-bg px-2 py-1 text-xs text-foreground"
                    aria-label={`Add a line for ${m.label}`}
                  >
                    <option value="">{answer.rowKeys.length ? 'Add another printed line…' : 'Choose the printed line…'}</option>
                    {options.map((r) => (
                      <option key={r.key} value={r.key}>
                        {[...r.path, r.label || '(no label)'].join(' › ')} — {latestPrinted(r, comparison)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className="mt-2 flex items-center gap-2 text-xs text-foreground/70">
                <input type="checkbox" checked={answer.none} onChange={(e) => update(m.key, { none: e.target.checked })} className="accent-accent" />
                The statements print no such line
              </label>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={save} loading={saving} disabled={saving || unanswered.length > 0}>
          Confirm the mapping
        </Button>
        {unanswered.length > 0 && <span className="text-xs text-foreground/60">Still to answer: {unanswered.map((m) => m.label).join(', ')}.</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      {changes.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Changes</h2>
          <ul className="space-y-1 text-xs text-foreground/70">
            {changes.map((c, i) => (
              <li key={i}>
                {when(c.changedAt)}, {c.changedBy}: {MEANINGS.find((m) => m.key === c.meaning)?.label} —{' '}
                {c.action === 'none_printed' ? 'not printed' : `${c.action} “${c.label ?? ''}”`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
