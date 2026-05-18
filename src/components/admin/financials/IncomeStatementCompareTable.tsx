'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { YoYBadge } from './YoYBadge'
import type { DiffTableSection, FinancialsComparison } from '@/lib/financials/types'

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

  const incomeDiffs = comparison.incomeStatementDiffs
  const totalsSection = incomeDiffs.find((s) => s.category === 'Totals')
  const detailSections = incomeDiffs.filter((s) => s.category !== 'Totals')

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
          <TableHeader years={years} />
          <tbody>
            {(tab === 'summary' ? summarySections : detailSections).map((section) => (
              <SectionRows key={section.category} section={section} years={years} />
            ))}
            {totalsSection && totalsSection.rows.length > 0 && (
              <TotalsRows section={totalsSection} years={years} />
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

function TableHeader({ years }: { years: number[] }) {
  return (
    <thead>
      <tr className="border-b border-border bg-primary/30 text-left text-foreground/45">
        <th className="py-2 pl-3 pr-4 font-medium">Line item</th>
        {years.map((fy, i) => (
          <th key={fy} className="py-2 pr-4 font-medium text-right">
            <div className="inline-flex flex-col items-end">
              <span>FY{fy}</span>
              {i > 0 && <span className="text-[10px] text-foreground/30">vs FY{years[i - 1]}</span>}
            </div>
          </th>
        ))}
        <th className="py-2 pr-3 font-medium text-right">Change (oldest → latest)</th>
      </tr>
    </thead>
  )
}

function SectionRows({ section, years }: { section: { category: string; rows: import('@/lib/financials/types').DiffTableSection['rows'] }; years: number[] }) {
  if (section.rows.length === 0) return null
  return (
    <>
      <tr className="bg-primary/20">
        <td colSpan={years.length + 2} className="py-1.5 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
          {section.category}
        </td>
      </tr>
      {section.rows.map((row) => (
        <DiffRowEl key={row.canonicalKey} row={row} years={years} />
      ))}
    </>
  )
}

function TotalsRows({ section, years }: { section: DiffTableSection; years: number[] }) {
  return (
    <>
      <tr className="bg-primary/30">
        <td colSpan={years.length + 2} className="py-1.5 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-foreground/55">
          Totals
        </td>
      </tr>
      {section.rows.map((row) => (
        <DiffRowEl key={row.canonicalKey} row={row} years={years} isBold isTopBordered={row.canonicalKey === 'netProfitAfterTax'} />
      ))}
    </>
  )
}

function DiffRowEl({
  row,
  years,
  isBold,
  isTopBordered,
}: {
  row: import('@/lib/financials/types').DiffRow
  years: number[]
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
      {years.map((fy, i) => {
        const v = row.valuesByYear[fy]
        const yoy = row.yoyPercentByYear[fy]
        return (
          <td key={fy} className={cn('py-1.5 pr-4 text-right tabular-nums', { 'font-semibold': bold })}>
            <div className="inline-flex items-center justify-end gap-1.5">
              <span>{formatAud(v)}</span>
              {i > 0 && <YoYBadge percent={yoy} />}
            </div>
          </td>
        )
      })}
      <td className={cn('py-1.5 pr-3 text-right tabular-nums text-foreground/70', { 'font-semibold': bold })}>
        {formatAud(row.absoluteChangeOldestToLatest)}
      </td>
    </tr>
  )
}

/** Summary tab: keep totals + top-5 expense lines by absolute change. */
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
    const topFive = [...expensesSection.rows]
      .sort((a, b) => Math.abs(b.absoluteChangeOldestToLatest ?? 0) - Math.abs(a.absoluteChangeOldestToLatest ?? 0))
      .slice(0, 5)
    sections.push({ category: 'Top 5 Expense Changes', rows: topFive })
  }

  // totalsSection is rendered separately by the parent, regardless of tab
  void totalsSection
  return sections
}
