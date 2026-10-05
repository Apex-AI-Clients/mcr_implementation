'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FinancialCheck, StatementHalfKey } from '@/lib/financials/types'

/**
 * The checks run when the comparison was built, grouped by year and statement:
 * "FY2025 · Balance Sheet", "Current period · Profit & Loss", "Documents".
 * Warnings need a look; information explains something that is probably fine.
 * Open by default when there is a warning.
 */

interface Props {
  checks: FinancialCheck[]
}

const STATEMENT_LABEL: Record<StatementHalfKey, string> = {
  income_statement: 'Profit & Loss',
  balance_sheet: 'Balance Sheet',
}

interface Group {
  key: string
  label: string
  order: number
  checks: FinancialCheck[]
}

function groupChecks(checks: FinancialCheck[]): Group[] {
  const groups = new Map<string, Group>()
  for (const check of checks) {
    const period =
      check.financialYear === null ? null : check.currentPeriod ? 'Current period' : `FY${check.financialYear}`
    const statement = check.statement ? STATEMENT_LABEL[check.statement] : null
    const label = period ? [period, statement ?? 'General'].join(' · ') : 'Documents'
    // Documents first, then years oldest to newest, the current period last.
    const order =
      check.financialYear === null ? 0 : check.currentPeriod ? 99_999 : check.financialYear * 10 + (check.statement === 'balance_sheet' ? 2 : 1)
    const group = groups.get(label) ?? { key: label, label, order, checks: [] }
    group.checks.push(check)
    groups.set(label, group)
  }
  return [...groups.values()].sort((a, b) => a.order - b.order)
}

export function ComparisonChecksPanel({ checks }: Props) {
  const warnings = checks.filter((c) => c.severity === 'warning').length
  const infos = checks.length - warnings
  const [open, setOpen] = useState(warnings > 0)
  if (checks.length === 0) return null

  const summary = [
    warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : null,
    infos > 0 ? `${infos} note${infos === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        warnings > 0 ? 'border-warning/30 bg-warning/10' : 'border-border bg-surface/40',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          {warnings > 0 ? (
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
          {groupChecks(checks).map((group) => (
            <div key={group.key}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.checks.map((check, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    {check.severity === 'warning' ? (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-label="Warning" />
                    ) : (
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/40" aria-label="Note" />
                    )}
                    <span className={check.severity === 'warning' ? 'text-foreground/80' : 'text-foreground/60'}>
                      {check.message}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
