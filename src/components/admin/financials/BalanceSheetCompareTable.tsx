import { AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { YoYBadge } from './YoYBadge'
import { ATO_LIABILITY_KEYS } from '@/lib/financials/schema'
import type {
  CurrentPeriodSnapshot,
  DiffRow,
  DiffTableSection,
  FinancialsComparison,
} from '@/lib/financials/types'
import {
  formatCurrentPeriodHeaderDate,
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

const BS_BOLD_KEYS = new Set([
  'totalCurrentAssets',
  'totalNonCurrentAssets',
  'totalAssets',
  'totalCurrentLiabilities',
  'totalNonCurrentLiabilities',
  'totalLiabilities',
  'netAssets',
  'totalEquity',
])

export function BalanceSheetCompareTable({ comparison }: Props) {
  const { years, balanceSheetDiffs, atoLiabilityByYear } = comparison
  const cp = comparison.currentPeriod ?? null

  const sections = balanceSheetDiffs.filter((s) => s.category !== 'Totals')
  const totalsSection = balanceSheetDiffs.find((s) => s.category === 'Totals')

  // Pull the director loans row out of nonCurrentAssets so it can be rendered
  // in its own highlighted block above the section.
  const nonCurrentAssetsSection = sections.find((s) => s.category === 'Non-Current Assets')
  const directorLoansRow = nonCurrentAssetsSection?.rows.find(
    (r) => r.canonicalKey === 'directorRelatedLoansReceivable',
  )
  const nonCurrentAssetsWithoutDirectorLoans = nonCurrentAssetsSection
    ? {
        ...nonCurrentAssetsSection,
        rows: nonCurrentAssetsSection.rows.filter(
          (r) => r.canonicalKey !== 'directorRelatedLoansReceivable',
        ),
      }
    : undefined

  const sectionsWithoutNCA = sections.filter((s) => s.category !== 'Non-Current Assets')

  // Build a synthetic "ATO-related liabilities" diff row showing the SUM of
  // the four ATO-related current-liability lines per year.
  const atoDiffRow = buildAtoAggregateRow(years, atoLiabilityByYear, cp)

  // Pull netAssets out of totals so it can be rendered as a bold highlighted row.
  const netAssetsRow = totalsSection?.rows.find((r) => r.canonicalKey === 'netAssets')
  const otherTotalsRows = totalsSection?.rows.filter((r) => r.canonicalKey !== 'netAssets') ?? []

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3">Balance Sheet</h3>

      {/* Director Loans highlighted block */}
      {directorLoansRow && (
        <HighlightBlock
          tone="danger"
          icon={<AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
          title="Director / Related Party Loans Receivable"
          subtitle="The ATO will scrutinise growth in related-party loans as evidence of funds being withdrawn from the business."
        >
          <SingleRowTable row={directorLoansRow} years={years} currentPeriod={cp} />
        </HighlightBlock>
      )}

      {/* ATO-related liabilities group */}
      {atoDiffRow && (
        <HighlightBlock
          tone="danger"
          icon={<AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
          title="ATO-related Current Liabilities (combined)"
          subtitle="Sum of ATO Liability, GST, Superannuation Payable, and PAYG Withholding Payable. The strongest indicator of accumulated tax debt."
        >
          <SingleRowTable row={atoDiffRow} years={years} currentPeriod={cp} />
        </HighlightBlock>
      )}

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-xs">
          <TableHeader years={years} currentPeriod={cp} />
          <tbody>
            {nonCurrentAssetsWithoutDirectorLoans && (
              <SectionRows section={nonCurrentAssetsWithoutDirectorLoans} years={years} currentPeriod={cp} />
            )}
            {sectionsWithoutNCA.map((section) => (
              <SectionRows key={section.category} section={section} years={years} currentPeriod={cp} />
            ))}
            {otherTotalsRows.length > 0 && (
              <>
                <tr className="bg-primary/30">
                  <td
                    colSpan={years.length + 1 + (cp ? 1 : 0)}
                    className="py-1.5 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-foreground/55"
                  >
                    Totals
                  </td>
                </tr>
                {otherTotalsRows.map((row) => (
                  <DiffRowEl key={row.canonicalKey} row={row} years={years} hasCurrentPeriod={Boolean(cp)} isBold />
                ))}
              </>
            )}
            {netAssetsRow && <NetAssetsRow row={netAssetsRow} years={years} currentPeriod={cp} />}
          </tbody>
        </table>
      </div>
    </div>
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
        {years.map((fy, i) => (
          <th key={fy} className="py-2 pr-4 font-medium text-right">
            <div className="inline-flex flex-col items-end">
              <span>FY{fy}</span>
              {i > 0 && <span className="text-[10px] text-foreground/30">vs FY{years[i - 1]}</span>}
            </div>
          </th>
        ))}
        {currentPeriod && (
          <th
            className="py-2 pr-4 pl-4 font-medium text-right border-l border-border/40"
            title={formatCurrentPeriodTooltip(currentPeriod)}
          >
            <div className="inline-flex flex-col items-end">
              <span className="inline-flex items-center gap-1">
                Current YTD
                <Info
                  className="h-3 w-3 text-foreground/40"
                  aria-label="Partial period — not directly comparable"
                />
              </span>
              <span className="text-[10px] text-foreground/30">
                to {formatCurrentPeriodHeaderDate(currentPeriod)}
              </span>
            </div>
          </th>
        )}
      </tr>
    </thead>
  )
}

function SectionRows({
  section,
  years,
  currentPeriod,
}: {
  section: DiffTableSection
  years: number[]
  currentPeriod: CurrentPeriodSnapshot | null
}) {
  if (section.rows.length === 0) return null
  const colSpan = years.length + 1 + (currentPeriod ? 1 : 0)
  return (
    <>
      <tr className="bg-primary/20">
        <td
          colSpan={colSpan}
          className="py-1.5 pl-3 pr-4 text-[11px] font-semibold uppercase tracking-wide text-foreground/55"
        >
          {section.category}
        </td>
      </tr>
      {section.rows.map((row) => (
        <DiffRowEl key={row.canonicalKey} row={row} years={years} hasCurrentPeriod={Boolean(currentPeriod)} />
      ))}
    </>
  )
}

function DiffRowEl({
  row,
  years,
  hasCurrentPeriod,
  isBold,
}: {
  row: DiffRow
  years: number[]
  hasCurrentPeriod: boolean
  isBold?: boolean
}) {
  const bold = isBold || BS_BOLD_KEYS.has(row.canonicalKey)
  return (
    <tr className={cn('border-b border-border/30 last:border-0', { 'bg-primary/15': bold })}>
      <td className={cn('py-1.5 pl-3 pr-4 text-foreground/80', { 'font-semibold text-foreground': bold })}>
        {row.label}
      </td>
      {years.map((fy, i) => {
        const v = row.valuesByYear[fy]
        const yoy = row.yoyPercentByYear[fy]
        return (
          <td
            key={fy}
            className={cn('py-1.5 pr-4 text-right tabular-nums', { 'font-semibold': bold })}
          >
            <div className="inline-flex items-center justify-end gap-1.5">
              <span>{formatAud(v)}</span>
              {i > 0 && (
                <YoYBadge
                  percent={yoy}
                  invertSentiment={shouldInvertSentiment(row.canonicalKey)}
                />
              )}
            </div>
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

function NetAssetsRow({
  row,
  years,
  currentPeriod,
}: {
  row: DiffRow
  years: number[]
  currentPeriod: CurrentPeriodSnapshot | null
}) {
  const latest = row.valuesByYear[years[years.length - 1]]
  const tone: 'good' | 'bad' = (latest ?? 0) >= 0 ? 'good' : 'bad'
  return (
    <tr className="border-t-2 border-t-foreground/40 bg-primary/20">
      <td className="py-2.5 pl-3 pr-4 text-sm font-bold text-foreground">{row.label}</td>
      {years.map((fy, i) => {
        const v = row.valuesByYear[fy]
        const yoy = row.yoyPercentByYear[fy]
        return (
          <td
            key={fy}
            className={cn('py-2.5 pr-4 text-right text-sm font-bold tabular-nums', {
              'text-success': tone === 'good' && i === years.length - 1,
              'text-destructive': tone === 'bad' && i === years.length - 1,
            })}
          >
            <div className="inline-flex items-center justify-end gap-1.5">
              <span>{formatAud(v)}</span>
              {i > 0 && <YoYBadge percent={yoy} />}
            </div>
          </td>
        )
      })}
      {currentPeriod && (
        <td className="py-2.5 pr-4 pl-4 text-right text-sm font-bold tabular-nums border-l border-border/40 text-foreground/70">
          {formatAud(row.currentPeriodValue ?? null)}
        </td>
      )}
    </tr>
  )
}

function SingleRowTable({
  row,
  years,
  currentPeriod,
}: {
  row: DiffRow
  years: number[]
  currentPeriod: CurrentPeriodSnapshot | null
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/40 bg-primary/10">
      <table className="w-full text-xs">
        <TableHeader years={years} currentPeriod={currentPeriod} />
        <tbody>
          <DiffRowEl row={row} years={years} hasCurrentPeriod={Boolean(currentPeriod)} isBold />
        </tbody>
      </table>
    </div>
  )
}

interface HighlightBlockProps {
  tone: 'danger' | 'warning'
  icon: React.ReactNode
  title: string
  subtitle: string
  children: React.ReactNode
}

function HighlightBlock({ tone, icon, title, subtitle, children }: HighlightBlockProps) {
  return (
    <div
      className={cn(
        'mb-4 rounded-xl border-l-4 p-4',
        tone === 'danger' && 'border-l-destructive border-r border-y border-r-destructive/20 border-y-destructive/20 bg-destructive/5',
        tone === 'warning' && 'border-l-warning border-r border-y border-r-warning/20 border-y-warning/20 bg-warning/5',
      )}
    >
      <div className="mb-3 flex items-start gap-2">
        {icon}
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
          <p className="text-xs text-foreground/55 leading-relaxed mt-0.5">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function buildAtoAggregateRow(
  years: number[],
  atoByYear: FinancialsComparison['atoLiabilityByYear'],
  currentPeriod: CurrentPeriodSnapshot | null,
): DiffRow | null {
  const valuesByYear: Record<number, number | null> = {}
  let hasAny = false
  for (const fy of years) {
    const total = atoByYear[fy]?.total ?? 0
    valuesByYear[fy] = total
    if (total !== 0) hasAny = true
  }
  if (!hasAny) return null

  const yoyByYear: Record<number, number | null> = {}
  for (let i = 0; i < years.length; i++) {
    const fy = years[i]
    if (i === 0) {
      yoyByYear[fy] = null
      continue
    }
    const prev = valuesByYear[years[i - 1]]
    const curr = valuesByYear[fy]
    if (prev === null || curr === null || prev === 0) {
      yoyByYear[fy] = null
    } else {
      yoyByYear[fy] = ((curr - prev) / Math.abs(prev)) * 100
    }
  }

  const first = valuesByYear[years[0]]
  const last = valuesByYear[years[years.length - 1]]
  const absoluteChange = first !== null && last !== null ? last - first : null

  return {
    canonicalKey: '__atoLiabilityAggregate__',
    label: `ATO + GST + Super + PAYG (sum of ${ATO_LIABILITY_KEYS.length} lines)`,
    valuesByYear,
    yoyPercentByYear: yoyByYear,
    absoluteChangeOldestToLatest: absoluteChange,
    direction: last !== null && first !== null && last > first ? 'up' : last !== null && first !== null && last < first ? 'down' : 'flat',
    ...(currentPeriod ? { currentPeriodValue: currentPeriod.atoLiabilityTotal } : {}),
  }
}

function shouldInvertSentiment(canonicalKey: string): boolean {
  // Liabilities growing = bad. Director loans receivable growing = bad.
  return (
    canonicalKey === 'directorRelatedLoansReceivable' ||
    canonicalKey.toLowerCase().includes('liability') ||
    canonicalKey.toLowerCase().includes('payable') ||
    canonicalKey === 'atoLiability' ||
    canonicalKey === 'gstPayable' ||
    canonicalKey === 'paygWithholdingPayable' ||
    canonicalKey === 'superannuationPayable' ||
    canonicalKey === 'totalLiabilities' ||
    canonicalKey === 'totalCurrentLiabilities' ||
    canonicalKey === 'totalNonCurrentLiabilities'
  )
}
