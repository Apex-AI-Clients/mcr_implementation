'use client'

import { useState } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  CurrentPeriodSnapshot,
  DiffTableSection,
  FinancialsComparison,
} from '@/lib/financials/types'
import {
  formatCurrentPeriodHeaderDate,
  formatCurrentPeriodHeaderName,
  formatCurrentPeriodTooltip,
} from './currentPeriodLabels'

interface Props {
  comparison: FinancialsComparison
}

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

function formatAud(v: number | null): string {
  if (v === null) return '—'
  return AUD.format(v)
}

const BOLD_KEYS = new Set([
  'totalIncome',
  'totalCogs',
  'grossProfit',
  'totalExpenses',
  'profitBeforeTax',
  'netProfitAfterTax',
])

export function IncomeStatementCompareTable({ comparison }: Props) {
  const [tab, setTab] = useState<'summary' | 'detail'>('summary')
  const { years } = comparison
  const cp = comparison.currentPeriod ?? null

  const incomeDiffs = comparison.incomeStatementDiffs
  const totalsSection = incomeDiffs.find((s) => s.category === 'Totals')
  // A trust's profit before distributions, distributions and net profit after.
  const distributionsSection = incomeDiffs.find((s) => s.category === 'Distributions')
  const detailSections = incomeDiffs.filter((s) => s.category !== 'Totals' && s.category !== 'Distributions')

  const summarySections = buildSummarySections(detailSections, totalsSection)

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-foreground">Income Statement</h3>
        <div className="inline-flex rounded-md bg-primary/40 p-0.5">
          <TabButton active={tab === 'summary'} onClick={() => setTab('summary')}>
            Summary
          </TabButton>
          <TabButton active={tab === 'detail'} onClick={() => setTab('detail')}>
            Detail
          </TabButton>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-xs">
          <TableHeader years={years} currentPeriod={cp} />
          <tbody>
            {(tab === 'summary' ? summarySections : detailSections).map((section) => (
              <SectionRows key={section.category} section={section} years={years} currentPeriod={cp} />
            ))}
            {totalsSection && totalsSection.rows.length > 0 && (
              <TotalsRows section={totalsSection} years={years} currentPeriod={cp} />
            )}
            {distributionsSection && distributionsSection.rows.length > 0 && (
              <TotalsRows section={distributionsSection} years={years} currentPeriod={cp} />
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1 text-xs font-medium transition-colors',
        active ? 'bg-surface text-foreground' : 'text-foreground/50 hover:text-foreground/80',
      )}
    >
      {children}
    </button>
  )
}

function TableHeader({
  years,
  currentPeriod,
}: {
  years: number[]
  currentPeriod: CurrentPeriodSnapshot | null
}) {
  return (
    <thead>
      <tr className="border-b border-border bg-primary/30 text-left text-foreground/45">
        <th className="py-2 pl-3 pr-4 font-medium">Line item</th>
        {years.map((fy) => (
          <th key={fy} className="py-2 pr-4 font-medium text-right">
            FY{fy}
          </th>
        ))}
        {currentPeriod && <CurrentPeriodHeaderCell currentPeriod={currentPeriod} />}
      </tr>
    </thead>
  )
}

function CurrentPeriodHeaderCell({ currentPeriod }: { currentPeriod: CurrentPeriodSnapshot }) {
  return (
    <th
      className="py-2 pr-4 pl-4 font-medium text-right border-l border-border/40"
      title={formatCurrentPeriodTooltip(currentPeriod)}
    >
      <div className="inline-flex flex-col items-end">
        <span className="inline-flex items-center gap-1">
          {formatCurrentPeriodHeaderName(currentPeriod)}
          <Info className="h-3 w-3 text-foreground/40" aria-label="Partial period — not directly comparable" />
        </span>
        <span className="text-[10px] text-foreground/30">
          {formatCurrentPeriodHeaderDate(currentPeriod)}
        </span>
      </div>
    </th>
  )
}

function SectionRows({
  section,
  years,
  currentPeriod,
}: {
  section: { category: string; rows: import('@/lib/financials/types').DiffTableSection['rows'] }
  years: number[]
  currentPeriod: CurrentPeriodSnapshot | null
}) {
  if (section.rows.length === 0) return null
  const colSpan = years.length + 1 + (currentPeriod ? 1 : 0)
  return (
    <>
      <tr className="bg-primary/20">
        <td colSpan={colSpan} className="py-1.5 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
          {section.category}
        </td>
      </tr>
      {section.rows.map((row) => (
        <DiffRowEl key={row.canonicalKey} row={row} years={years} hasCurrentPeriod={Boolean(currentPeriod)} />
      ))}
    </>
  )
}

function TotalsRows({
  section,
  years,
  currentPeriod,
}: {
  section: DiffTableSection
  years: number[]
  currentPeriod: CurrentPeriodSnapshot | null
}) {
  const colSpan = years.length + 1 + (currentPeriod ? 1 : 0)
  return (
    <>
      <tr className="bg-primary/30">
        <td colSpan={colSpan} className="py-1.5 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
          {section.category}
        </td>
      </tr>
      {section.rows.map((row) => (
        <DiffRowEl
          key={row.canonicalKey}
          row={row}
          years={years}
          hasCurrentPeriod={Boolean(currentPeriod)}
          isBold
          isTopBordered={row.canonicalKey === 'netProfitAfterTax' || row.canonicalKey === 'netProfitAfterDistributions'}
        />
      ))}
    </>
  )
}

function DiffRowEl({
  row,
  years,
  hasCurrentPeriod,
  isBold,
  isTopBordered,
}: {
  row: import('@/lib/financials/types').DiffRow
  years: number[]
  hasCurrentPeriod: boolean
  isBold?: boolean
  isTopBordered?: boolean
}) {
  const bold = isBold || BOLD_KEYS.has(row.canonicalKey)
  return (
    <tr
      className={cn('border-b border-border/30 last:border-0', {
        'border-t-2 border-t-foreground/40': isTopBordered,
        'bg-primary/15': bold,
      })}
    >
      <td className={cn('py-1.5 pl-3 pr-4 text-foreground/80', { 'font-semibold text-foreground': bold })}>
        {row.label}
      </td>
      {years.map((fy) => {
        const v = row.valuesByYear[fy]
        return (
          <td key={fy} className={cn('py-1.5 pr-4 text-right tabular-nums', { 'font-semibold': bold })}>
            {formatAud(v)}
          </td>
        )
      })}
      {hasCurrentPeriod && (
        <td
          className={cn(
            'py-1.5 pr-4 pl-4 text-right tabular-nums border-l border-border/40 text-foreground/70',
            { 'font-semibold': bold },
          )}
        >
          {formatAud(row.currentPeriodValue ?? null)}
        </td>
      )}
    </tr>
  )
}

/** Summary tab: keep totals + the five largest expense lines of the latest year. */
function buildSummarySections(
  detailSections: DiffTableSection[],
  totalsSection: DiffTableSection | undefined,
): DiffTableSection[] {
  const expensesSection = detailSections.find((s) => s.category === 'Expenses')
  const incomeSection = detailSections.find((s) => s.category === 'Income')
  const cogsSection = detailSections.find((s) => s.category === 'Cost of Goods Sold')

  const sections: DiffTableSection[] = []
  if (incomeSection) sections.push(incomeSection)
  if (cogsSection) sections.push(cogsSection)

  if (expensesSection) {
    const latest = (r: DiffTableSection['rows'][number]) => {
      const values = Object.entries(r.valuesByYear).sort((a, b) => Number(a[0]) - Number(b[0]))
      return Math.abs(values[values.length - 1]?.[1] ?? 0)
    }
    const topFive = [...expensesSection.rows].sort((a, b) => latest(b) - latest(a)).slice(0, 5)
    sections.push({ category: 'Top 5 Expenses', rows: topFive })
  }

  // totalsSection is rendered separately by the parent, regardless of tab
  void totalsSection
  return sections
}
