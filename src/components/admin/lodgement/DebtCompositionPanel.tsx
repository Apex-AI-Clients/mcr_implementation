'use client'

import { cn } from '@/lib/utils'
import type { DebtBreakdown } from '@/lib/analysis/types'

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

function fmt(value: number): string {
  return AUD.format(value)
}

function fmtParen(value: number): string {
  return `(${AUD.format(value)})`
}

interface RowProps {
  label: string
  display: string
  bold?: boolean
  indent?: boolean
  separator?: boolean
  colorClass?: string
}

function Row({ label, display, bold, indent, separator, colorClass }: RowProps) {
  return (
    <tr className={cn('border-b border-border/30 last:border-0', separator && 'border-t border-border/60')}>
      <td
        className={cn(
          'py-1.5 pr-4 text-xs pl-4',
          indent ? 'pl-4 text-foreground/50' : bold ? 'font-semibold text-foreground' : 'text-foreground/70',
        )}
      >
        {label}
      </td>
      <td
        className={cn(
          'py-1.5 text-right text-xs tabular-nums pr-4',
          bold ? 'font-bold' : '',
          colorClass ?? (indent ? 'text-success' : 'text-foreground/80'),
        )}
      >
        {display}
      </td>
    </tr>
  )
}

export function DebtCompositionPanel({ debtBreakdown: db }: { debtBreakdown: DebtBreakdown }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Debt Composition</h3>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface/50">
        <table className="w-full">
          <tbody>
            {/* Principal */}
            <Row label="Principal (gross debits)" display={fmt(db.principalDebits)} />
            {db.principalCredits > 0 && (
              <Row label="Less: amendment credits" display={fmtParen(db.principalCredits)} indent />
            )}
            <Row label="Principal (net)" display={fmt(db.principalNet)} bold />

            {/* Interest */}
            {(db.interestDebits > 0 || db.interestNet !== 0) && (
              <Row label="Interest / GIC (gross)" display={fmt(db.interestDebits)} />
            )}
            {db.interestCredits > 0 && (
              <Row label="Less: GIC remissions" display={fmtParen(db.interestCredits)} indent />
            )}
            {db.interestDebits > 0 && (
              <Row label="Interest (net)" display={fmt(db.interestNet)} bold />
            )}

            {/* Penalties */}
            {db.penaltyDebits > 0 && (
              <Row label="Penalties (gross)" display={fmt(db.penaltyDebits)} />
            )}
            {db.penaltyCredits > 0 && (
              <Row label="Less: penalty credits" display={fmtParen(db.penaltyCredits)} indent />
            )}
            {db.penaltyDebits > 0 && (
              <Row label="Penalties (net)" display={fmt(db.penaltyNet)} bold />
            )}

            {/* Total ATO debt — always shown */}
            <Row
              label="Total ATO debt accrued"
              display={fmt(db.totalAtoDebt)}
              bold
              separator
            />

            {/* Reductions */}
            {db.paymentsReceived > 0 && (
              <Row label="Less: payments received" display={fmtParen(db.paymentsReceived)} indent />
            )}
            {db.governmentCredits > 0 && (
              <Row label="Less: government credits (Cash Flow Boost etc)" display={fmtParen(db.governmentCredits)} indent />
            )}
            {db.otherCredits > 0 && (
              <Row label="Less: other credits" display={fmtParen(db.otherCredits)} indent />
            )}

            {/* Current balance — always shown */}
            <Row
              label="Current balance owing"
              display={fmt(db.currentBalance)}
              bold
              separator
              colorClass={db.currentBalance === 0 ? 'text-success font-bold' : 'text-warning font-bold'}
            />
          </tbody>
        </table>
      </div>

      <p className="text-xs text-foreground/40 italic">
        Sub-line rows and ATO-initiated amendments excluded to avoid double-counting.
      </p>
    </div>
  )
}
