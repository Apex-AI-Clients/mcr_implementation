'use client'

import { currentPeriodLabel, yearSpan } from '@/lib/financials/periodLabels'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ATO_LIABILITY_KEYS } from '@/lib/financials/schema'
import type { FinancialCheck, FinancialsComparison } from '@/lib/financials/types'

interface Props {
  comparison: FinancialsComparison
  aiSummary: string | null
  clientName: string
  /** Locked, with the reason as its tooltip (a comparison that needs review). */
  lockedReason?: string | null
  /** The failed hard checks (hardChecks.ts), listed under NEEDS REVIEW. */
  failures?: FinancialCheck[]
  /** "Reviewed by X on <date>" once a staff member ticked the failures. */
  reviewedBy?: string | null
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function csvRow(...cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(',')
}

function fmtCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const abs = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  // Accounting convention: parentheses for negatives.
  return v < 0 ? `($${abs})` : `$${abs}`
}

function buildCsv(
  comparison: FinancialsComparison,
  aiSummary: string | null,
  clientName: string,
  failures: FinancialCheck[],
  reviewedBy: string | null,
): string {
  const lines: string[] = []
  const years = comparison.years
  const cp = comparison.currentPeriod ?? null
  const ytdHeader = cp ? currentPeriodLabel(cp) : null

  lines.push(csvRow('Financial Statements Comparison', clientName))
  lines.push(csvRow('Generated', new Date().toISOString()))
  lines.push(csvRow('Period', `${comparison.periodRange.start} to ${comparison.periodRange.end}`))
  if (cp) {
    lines.push(csvRow('Current period', currentPeriodLabel(cp)))
  }
  lines.push('')

  if (failures.length > 0) {
    lines.push(csvRow('NEEDS REVIEW'))
    for (const c of failures) {
      lines.push(csvRow(c.financialYear === null ? '' : c.currentPeriod ? 'Current period' : `FY${c.financialYear}`, c.message))
    }
    if (reviewedBy) lines.push(csvRow(`${reviewedBy}: checked against the source documents`))
    lines.push('')
  }

  // Headlines
  lines.push(csvRow('HEADLINES'))
  const headlineHeader = ['Metric', ...years.map((y) => `FY${y}`)]
  if (ytdHeader) headlineHeader.push(ytdHeader)
  headlineHeader.push('Latest severity')
  lines.push(csvRow(...headlineHeader))
  for (const key of [
    'revenue',
    'netProfit',
    'netAssets',
    'atoDebtTrajectory',
    'directorLoanAccountNet',
  ] as const) {
    // A comparison built before the net loan account has the receivable only.
    const m = comparison.headlines[key] ?? (key === 'directorLoanAccountNet' ? comparison.headlines.directorLoansReceivable : undefined)
    if (!m) continue
    const cells: Array<string | number | null | undefined> = [m.label, ...m.trend.map(fmtCurrency)]
    if (ytdHeader) cells.push(fmtCurrency(m.currentPeriodValue ?? null))
    cells.push(m.severity)
    lines.push(csvRow(...cells))
  }
  lines.push('')

  // AI summary
  if (aiSummary) {
    lines.push(csvRow('AI SUMMARY'))
    lines.push(csvCell(aiSummary))
    lines.push('')
  }

  // Income statement
  lines.push(csvRow('INCOME STATEMENT'))
  const incomeHeader: string[] = ['Line item', ...years.map((y) => `FY${y}`)]
  if (ytdHeader) incomeHeader.push(ytdHeader)
  lines.push(csvRow(...incomeHeader))
  for (const section of comparison.incomeStatementDiffs) {
    lines.push(csvRow(`[${section.category}]`))
    for (const row of section.rows) {
      const cells: Array<string | number | null | undefined> = [
        row.label,
        ...years.map((y) => fmtCurrency(row.valuesByYear[y])),
      ]
      if (ytdHeader) cells.push(fmtCurrency(row.currentPeriodValue ?? null))
      lines.push(csvRow(...cells))
    }
  }
  lines.push('')

  // Balance sheet
  lines.push(csvRow('BALANCE SHEET'))
  const bsHeader: string[] = ['Line item', ...years.map((y) => `FY${y}`)]
  if (ytdHeader) bsHeader.push(ytdHeader)
  lines.push(csvRow(...bsHeader))
  for (const section of comparison.balanceSheetDiffs) {
    lines.push(csvRow(`[${section.category}]`))
    for (const row of section.rows) {
      const cells: Array<string | number | null | undefined> = [
        row.label,
        ...years.map((y) => fmtCurrency(row.valuesByYear[y])),
      ]
      if (ytdHeader) cells.push(fmtCurrency(row.currentPeriodValue ?? null))
      lines.push(csvRow(...cells))
    }
  }
  lines.push('')

  // ATO aggregate
  lines.push(csvRow('ATO-RELATED CURRENT LIABILITIES (combined)'))
  const atoHeader: string[] = ['Component', ...years.map((y) => `FY${y}`)]
  if (ytdHeader) atoHeader.push(ytdHeader)
  lines.push(csvRow(...atoHeader))
  for (const key of ATO_LIABILITY_KEYS) {
    const cells: Array<string | number | null | undefined> = [
      key,
      ...years.map((y) => fmtCurrency(comparison.atoLiabilityByYear[y]?.byKey[key] ?? null)),
    ]
    // Per-line current-period breakdown not exposed on CurrentPeriodSnapshot;
    // leave blank when present.
    if (ytdHeader) cells.push('')
    lines.push(csvRow(...cells))
  }
  const totalCells: Array<string | number | null | undefined> = [
    'Total',
    ...years.map((y) => fmtCurrency(comparison.atoLiabilityByYear[y]?.total ?? null)),
  ]
  if (cp) totalCells.push(fmtCurrency(cp.atoLiabilityTotal))
  lines.push(csvRow(...totalCells))
  lines.push('')

  // Methodology footer
  lines.push('')
  lines.push(csvRow('METHODOLOGY'))
  lines.push(
    csvRow(
      `Severities and sparklines are computed exclusively from the annual financial statements (${yearSpan(years)}).${ytdHeader ? ` The ${ytdHeader} column is shown alongside for trend awareness only.` : ''}`,
    ),
  )
  if (cp) {
    lines.push(
      csvRow(
        `The ${ytdHeader} column shows partial-period figures from the client's accounting software. Severities and sparklines exclude this column because it represents a partial period only.`,
      ),
    )
  }

  return lines.join('\r\n')
}

function downloadCsv(content: string, filename: string) {
  // Prepend a UTF-8 BOM so Excel opens it with correct encoding.
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ExportButton({ comparison, aiSummary, clientName, lockedReason = null, failures = [], reviewedBy = null }: Props) {
  function handleExport() {
    const csv = buildCsv(comparison, aiSummary, clientName, failures, reviewedBy)
    const safeName = clientName.replace(/[^a-z0-9-]+/gi, '_')
    downloadCsv(csv, `${safeName}_financials_comparison.csv`)
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleExport} disabled={lockedReason !== null} title={lockedReason ?? undefined}>
      <Download className="h-3.5 w-3.5" />
      Export CSV
    </Button>
  )
}
