'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { describeLine, matchesSearch, pickerRows } from '@/lib/printed/picker'
import { MEANING, type Meaning } from '@/lib/printed/meanings'
import type { PrintedComparison } from '@/lib/printed/compare'
import type { MappingSelection } from '@/lib/printed/mappingStore'
import { YearValues, rowValues, totalsPerYear } from './YearValues'

interface Props {
  comparison: PrintedComparison
  meaning: Meaning
  /** The lines chosen now (confirmed or suggested): listed first, marked "current". */
  current: string[]
  /** Whether "the statements don't print this" is the current answer. */
  currentNone?: boolean
  saving?: boolean
  onSave: (answer: NonNullable<MappingSelection[Meaning]>) => void
  onCancel: () => void
}

const NONE = '__none__'

/**
 * "Choose another": the plausible printed lines for one key figure, each with
 * its headings and its figure for every year, searchable; "Show all lines"
 * offers the whole statement. One line (radio) for a single figure; several
 * (checkboxes, with a running total per year) for one made of several lines.
 */
export function KeyFigurePicker({ comparison, meaning, current, currentNone = false, saving = false, onSave, onCancel }: Props) {
  const info = MEANING[meaning]
  const [all, setAll] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>(currentNone ? [NONE] : current)
  const rows = useMemo(() => pickerRows(comparison, meaning, current, { all }), [comparison, meaning, current, all])
  const shown = rows.filter((r) => matchesSearch(r, query))
  const none = picked.includes(NONE)
  const chosenRows = rows.filter((r) => picked.includes(r.key))

  function toggle(key: string) {
    if (key === NONE) return setPicked(none ? [] : [NONE])
    if (!info.multiple) return setPicked([key])
    setPicked((p) => {
      const rest = p.filter((k) => k !== NONE)
      return rest.includes(key) ? rest.filter((k) => k !== key) : [...rest, key]
    })
  }

  const inputType = info.multiple ? 'checkbox' : 'radio'
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border/60 bg-primary/30 p-3" role="group" aria-label={`Choose the line for ${info.label}`}>
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-foreground/40" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the printed lines"
          aria-label="Search the printed lines"
          className="w-full rounded border border-border/60 bg-input-bg px-2 py-1 text-xs text-foreground"
        />
      </div>

      <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
        {shown.map((row) => {
          const { label, where } = describeLine(row, meaning)
          const isCurrent = current.includes(row.key)
          return (
            <li key={row.key}>
              <label className={cn('flex cursor-pointer gap-2 rounded border px-2 py-1.5', picked.includes(row.key) ? 'border-accent/60 bg-accent/5' : 'border-border/40 hover:bg-surface/60')}>
                <input type={inputType} name={`pick-${meaning}`} checked={picked.includes(row.key)} onChange={() => toggle(row.key)} className="mt-0.5 accent-accent" />
                <span className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-foreground">“{label}”</span>
                  {isCurrent && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">current</span>}
                  <span className="block text-[11px] text-foreground/50">{where}</span>
                  <YearValues columns={comparison.columns} values={rowValues(row)} className="mt-0.5" />
                </span>
              </label>
            </li>
          )
        })}
        {shown.length === 0 && <li className="px-2 py-1.5 text-xs text-foreground/55">No printed line matches. Try “Show all lines”.</li>}
        <li>
          <label className={cn('flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs', none ? 'border-accent/60 bg-accent/5' : 'border-border/40 hover:bg-surface/60')}>
            <input type={inputType} name={`pick-${meaning}`} checked={none} onChange={() => toggle(NONE)} className="accent-accent" />
            The statements don&apos;t print this
          </label>
        </li>
      </ul>

      {!all && (
        <button type="button" onClick={() => setAll(true)} className="text-xs text-accent hover:underline">
          Show all lines
        </button>
      )}

      {info.multiple && chosenRows.length > 1 && (
        <div className="rounded border border-border/40 px-2 py-1.5">
          <p className="text-[11px] font-medium text-foreground/70">Total of the {chosenRows.length} lines ticked</p>
          <YearValues columns={comparison.columns} values={totalsPerYear(chosenRows, comparison.columns)} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          variant="primary"
          loading={saving}
          disabled={saving || picked.length === 0}
          onClick={() => onSave(none ? { none: true } : { rowKeys: picked })}
        >
          {none ? 'Confirm: not printed' : picked.length > 1 ? 'Use these lines' : 'Use this line'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
