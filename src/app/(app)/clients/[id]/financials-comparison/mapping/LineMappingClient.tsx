'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { KeyFigureCard, keyFigureStatus, shortDate, useConfirmKeyFigures } from '@/components/admin/financials/keyFigures/KeyFigureCard'
import { KEY_FIGURES, MEANINGS, type Meaning } from '@/lib/printed/meanings'
import type { PrintedComparison } from '@/lib/printed/compare'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { Suggestions } from '@/lib/printed/dictionary'
import type { MappingChange, MappingSelection } from '@/lib/printed/mappingStore'

interface Props {
  clientId: string
  clientName: string
  comparison: PrintedComparison
  mapping: MappingEntry[]
  suggestions: Suggestions
  changes: MappingChange[]
  /** Ask Claude about the key figures the dictionary found no line for (AI_SUMMARIES_ENABLED). */
  aiEnabled?: boolean
}

/**
 * "Confirm key figures": which printed line is each key figure the tiles and
 * the SBR prediction use. Suggested from the statements; staff check each
 * one, or confirm all the suggestions at once. Each confirmation records who
 * and when.
 */
export function LineMappingClient({ clientId, clientName, comparison, mapping, suggestions, changes, aiEnabled = false }: Props) {
  const { confirm, saving, error } = useConfirmKeyFigures(clientId)
  const entriesOf = (m: Meaning) => mapping.filter((e) => e.meaning === m)
  const confirmedCount = KEY_FIGURES.filter((m) => entriesOf(m.key).length > 0).length
  // Confirm all takes the dictionary's suggestions only: an AI suggestion is confirmed on its own card.
  const toConfirm = MEANINGS.filter((m) => keyFigureStatus(entriesOf(m.key), suggestions[m.key]) === 'suggested')
  const unknown = MEANINGS.filter((m) => keyFigureStatus(entriesOf(m.key), suggestions[m.key]) === 'not_found').length
  const [aiSuggestions, setAiSuggestions] = useState<Partial<Record<Meaning, string[]>>>({})

  useEffect(() => {
    if (!aiEnabled || unknown === 0) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/admin/clients/${clientId}/line-mapping/ai-suggestions`, { method: 'POST' })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { suggestions?: Partial<Record<Meaning, string[]>> }
        if (!cancelled) setAiSuggestions(data.suggestions ?? {})
      } catch {
        // Staff choose the line themselves, as without AI.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [aiEnabled, clientId, unknown])
  const optional = MEANINGS.filter((m) => !m.required)

  function confirmAll() {
    const selection: MappingSelection = Object.fromEntries(toConfirm.map((m) => [m.key, { rowKeys: suggestions[m.key] }]))
    void confirm(selection)
  }

  const card = (m: Meaning) => {
    const ai = suggestions[m].length === 0 ? (aiSuggestions[m] ?? []) : []
    return (
      <KeyFigureCard
        key={m}
        clientId={clientId}
        comparison={comparison}
        meaning={m}
        entries={entriesOf(m)}
        suggestion={ai.length ? ai : suggestions[m]}
        aiSuggested={ai.length > 0}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href={`/clients/${clientId}/financials-comparison`} className="inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the statements
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Confirm key figures</h1>
        <p className="text-sm text-foreground/60">{clientName}</p>
        <p className="text-sm text-foreground/70">We matched these from the statements. Check each one, or confirm all at once.</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="text-sm font-medium text-foreground" aria-live="polite">
            {confirmedCount} of {KEY_FIGURES.length} confirmed
          </span>
          <Button size="sm" variant="primary" onClick={confirmAll} loading={saving} disabled={saving || toConfirm.length === 0}>
            Confirm all suggestions
          </Button>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
        <p className="text-xs text-foreground/50">The SBR prediction is available once all {KEY_FIGURES.length} are confirmed.</p>
      </div>

      <ul className="space-y-3">{KEY_FIGURES.map((m) => card(m.key))}</ul>

      <details className="rounded-lg border border-border/60 p-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground">Other creditors for the SBR (optional)</summary>
        <p className="mt-1 text-xs text-foreground/55">These pre-fill the creditor rows on the prediction page. They are not needed to run the prediction.</p>
        <ul className="mt-3 space-y-3">{optional.map((m) => card(m.key))}</ul>
      </details>

      {changes.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Changes</h2>
          <ul className="space-y-1 text-xs text-foreground/70">
            {changes.map((c, i) => (
              <li key={i}>
                {shortDate(c.changedAt)}, {c.changedBy}: {MEANINGS.find((m) => m.key === c.meaning)?.label} —{' '}
                {c.action === 'none_printed' ? 'not printed' : `${c.action} “${c.label ?? ''}”`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
