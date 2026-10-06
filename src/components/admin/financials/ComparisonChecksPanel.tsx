'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FinancialCheck, StatementHalfKey } from '@/lib/financials/types'

/**
 * The checks run when the comparison was built.
 *
 * Warnings — only what needs staff action — are listed one by one, grouped by
 * year and statement ("FY2025 · Balance Sheet", "Documents").
 *
 * Notes — what we corrected or explained ourselves — collapse into one line
 * per sort ("12 lines kept under other expenses", "4 signs corrected"), each
 * expandable to its items.
 *
 * Open by default when there is a warning.
 */

interface Props {
  checks: FinancialCheck[]
}

const STATEMENT_LABEL: Record<StatementHalfKey, string> = {
  income_statement: 'Profit & Loss',
  balance_sheet: 'Balance Sheet',
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/** One line for a sort of note. */
export function noteSummary(group: string, n: number): string {
  if (group.startsWith('unmapped:')) return `${plural(n, 'line', 'lines')} kept under other ${group.slice('unmapped:'.length)}`
  switch (group) {
    case 'sign_corrected':
      return `${plural(n, 'sign', 'signs')} corrected from the printed statement`
    case 'value_corrected':
      return `${plural(n, 'figure', 'figures')} corrected from the printed statement`
    case 'mapping_consistency':
      return `${plural(n, 'label', 'labels')} mapped the same way across files`
    case 'mapping_corrected':
      return `${plural(n, 'line', 'lines')} moved to their standard place`
    case 'profit_corrected':
      return `${plural(n, 'profit figure', 'profit figures')} corrected`
    case 'sign_differs':
      return `${plural(n, 'sign difference', 'sign differences')} between files`
    case 'distributions_implied':
      return `${plural(n, 'year', 'years')} with distributions implied by retained earnings`
    case 'lines_incomplete':
      return `${plural(n, 'statement', 'statements')} whose lines did not add up (figures kept as read)`
    case 'swapped_totals':
      return `${plural(n, 'file', 'files')} with totals printed in the wrong column`
    case 'year_mismatch':
      return `${plural(n, 'column', 'columns')} moved to the year the heading names`
    case 'presence_mismatch':
      return `${plural(n, 'statement', 'statements')} the document does not hold, ignored`
    case 'filename_year_conflict':
      return `${plural(n, 'filename', 'filenames')} naming a different year (headings used)`
    default:
      return plural(n, 'other note', 'other notes')
  }
}

function warningGroups(checks: FinancialCheck[]) {
  const groups = new Map<string, { label: string; order: number; checks: FinancialCheck[] }>()
  for (const check of checks) {
    const period =
      check.financialYear === null ? null : check.currentPeriod ? 'Current period' : `FY${check.financialYear}`
    const statement = check.statement ? STATEMENT_LABEL[check.statement] : null
    const label = period ? [period, statement ?? 'General'].join(' · ') : 'Documents'
    const order =
      check.financialYear === null
        ? 0
        : check.currentPeriod
          ? 99_999
          : check.financialYear * 10 + (check.statement === 'balance_sheet' ? 2 : 1)
    const group = groups.get(label) ?? { label, order, checks: [] }
    group.checks.push(check)
    groups.set(label, group)
  }
  return [...groups.values()].sort((a, b) => a.order - b.order)
}

function noteGroups(checks: FinancialCheck[]) {
  const groups = new Map<string, FinancialCheck[]>()
  for (const check of checks) {
    const key = check.group ?? check.kind
    groups.set(key, [...(groups.get(key) ?? []), check])
  }
  return [...groups.entries()]
    .map(([group, items]) => ({ group, items, label: noteSummary(group, items.length) }))
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label))
}

function where(check: FinancialCheck): string {
  if (check.financialYear === null) return ''
  const period = check.currentPeriod ? 'Current period' : `FY${check.financialYear}`
  return check.statement ? `${period} ${STATEMENT_LABEL[check.statement]}: ` : `${period}: `
}

function NoteGroup({ label, items }: { label: string; items: FinancialCheck[] }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-left text-xs text-foreground/60 hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" aria-hidden /> : <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
        {label}
      </button>
      {open && (
        <ul className="mt-1 ml-4 space-y-0.5">
          {items.map((check, i) => (
            <li key={i} className="text-xs text-foreground/50">
              {where(check)}
              {check.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function ComparisonChecksPanel({ checks }: Props) {
  const warnings = checks.filter((c) => c.severity === 'warning')
  const notes = checks.filter((c) => c.severity !== 'warning')
  const [open, setOpen] = useState(warnings.length > 0)
  if (checks.length === 0) return null

  const summary = [
    warnings.length > 0 ? plural(warnings.length, 'warning', 'warnings') : null,
    notes.length > 0 ? plural(notes.length, 'note', 'notes') : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        warnings.length > 0 ? 'border-warning/30 bg-warning/10' : 'border-border bg-surface/40',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          {warnings.length > 0 ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          ) : (
            <Info className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden />
          )}
          Statement checks{' '}
          <span className="font-normal text-foreground/60">{summary}</span>
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden />
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {warningGroups(warnings).map((group) => (
            <div key={group.label}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.checks.map((check, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-label="Warning" />
                    <span className="text-foreground/80">{check.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {notes.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/50">Notes</p>
              <ul className="space-y-1">
                {noteGroups(notes).map((g) => (
                  <NoteGroup key={g.group} label={g.label} items={g.items} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
