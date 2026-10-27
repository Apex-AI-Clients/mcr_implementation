'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RowsTable, UncountedTable } from '@/components/admin/lodgement/DebtCompositionPanel'
import type { AccountComposition, AccountCompositionLine } from '@/lib/analysis/atoAccount/engine'
import { drCr } from '@/components/admin/AtoAccountsPanel'
import { SourcedAmount } from '@/components/ui/SourcedAmount'
import type { AmountSource } from '@/lib/sources'

/** A composition line's source: what it is (its sentence) and the ATO rows behind it. */
export function lineSource(line: AccountCompositionLine, account: string): AmountSource {
  const rows = line.rows.length
  return {
    from: [
      line.label,
      rows > 0
        ? `${account}: ${rows === 1 ? '1 row' : `${rows} rows`} of the ATO account, as printed in its CSV.`
        : `${account}: worked out from the lines above.`,
    ],
    calculation: line.explanation || null,
    link: { kind: 'href', href: '#account-composition', label: 'Show the ATO rows' },
  }
}

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

/** Lines that reduce the balance: shown in brackets. */
const REDUCES = new Set(['payments', 'otherCredits'])
/** Lines that are sums of the lines above them, and the ATO's own balance. */
const STRONG = new Set(['totalDebt', 'composed', 'atoBalance'])

function display(line: AccountCompositionLine): (n: number) => string {
  if (REDUCES.has(line.key)) return (n) => (n === 0 ? AUD.format(0) : `(${AUD.format(n)})`)
  if (line.key === 'unexplained') return (n) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${AUD.format(Math.abs(n))}`
  if (line.key === 'atoBalance' || line.key === 'opening') return drCr
  return (n) => AUD.format(n)
}

function LineRow({ line, uncounted, account }: { line: AccountCompositionLine; uncounted: AccountComposition['uncounted']; account: string }) {
  const [open, setOpen] = useState(false)
  const strong = STRONG.has(line.key)
  const id = `account-composition-${line.key}`
  return (
    <li className={cn('border-b border-border/30 last:border-0', strong && 'border-t border-border/60')}>
      <div className="flex items-start justify-between gap-3 px-4 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex min-w-0 items-start gap-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            strong ? 'font-semibold text-foreground' : 'text-foreground/70 hover:text-foreground',
          )}
        >
          {open ? (
            <ChevronDown className="no-print mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="no-print mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          <span>
            {line.label}
            {line.rows.length > 0 && (
              <span className="font-normal text-foreground/40"> · {line.rows.length} ATO row{line.rows.length === 1 ? '' : 's'}</span>
            )}
          </span>
        </button>
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            strong && 'font-bold',
            line.key === 'atoBalance' ? (line.amount > 0 ? 'text-warning' : 'text-success') : REDUCES.has(line.key) ? 'text-success' : 'text-foreground/80',
          )}
        >
          <SourcedAmount value={line.amount} format={display(line)} source={lineSource(line, account)} />
        </span>
      </div>
      {/* The sentence and the rows not counted are in the PDF; the row lists are screen only. */}
      <div id={id} className={cn('px-4 pb-2 pl-8', open ? 'block' : 'hidden print:block')}>
        <p className="text-xs text-foreground/50">{line.explanation}</p>
        {line.key === 'unexplained' && (
          <div className="mt-1.5">
            <UncountedTable groups={uncounted} />
          </div>
        )}
        {open && line.rows.length > 0 && (
          <div className="print:hidden">
            <RowsTable line={line} />
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * The composition of an income tax or super guarantee account, line by line
 * (atoAccount/engine.ts): each line opens to what it is and the ATO rows
 * behind it, and the unexplained difference to the rows no line counts. The
 * ATO's own balance closes the table.
 */
export function AccountCompositionPanel({ composition, account }: { composition: AccountComposition; account: string }) {
  const lines = [
    ...composition.lines.filter((l) => l.key !== 'atoBalance'),
    ...composition.lines.filter((l) => l.key === 'atoBalance'),
  ]
  return (
    <div id="account-composition" className="scroll-mt-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Debt composition</h3>
      <p className="no-print text-xs text-foreground/40">Open a line to see what it is and the ATO rows behind it.</p>
      <ul className="overflow-x-auto rounded-lg border border-border bg-surface/50">
        {lines.map((line) => (
          <LineRow key={line.key} line={line} uncounted={composition.uncounted} account={account} />
        ))}
      </ul>
    </div>
  )
}
