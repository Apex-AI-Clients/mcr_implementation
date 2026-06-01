'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ATO_LIABILITY_KEYS } from '@/lib/financials/schema'
import type { FinancialsComparison } from '@/lib/financials/types'

interface Props {
  comparison: FinancialsComparison
  aiSummary: string | null
  clientName: string
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

function fmtPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return `${v.toFixed(2)}%`
}

function buildCsv(comparison: FinancialsComparison, aiSummary: string | null, clientName: string): string {
  const lines: string[] = []
  const years = comparison.years
  const cp = comparison.currentPeriod ?? null
  const ytdHeader = cp ? `Current YTD (to ${cp.periodEndDate})` : null

  lines.push(csvRow('Financial Statements Comparison', clientName))
  lines.push(csvRow('Generated', new Date().toISOString()))
  lines.push(csvRow('Period', `${comparison.periodRange.start} to ${comparison.periodRange.end}`))
  if (cp) {
    lines.push(csvRow('Current period', cp.periodLabel))
  }
  lines.push('')

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
    'directorLoansReceivable',
  ] as const) {
    const m = comparison.headlines[key]
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

  // Ratios — leave the Current YTD column blank (ratios are full-year only).
  lines.push(csvRow('KEY RATIOS'))
  const ratioHeader: string[] = ['Ratio', ...years.map((y) => `FY${y}`)]
  if (ytdHeader) ratioHeader.push(ytdHeader)
  lines.push(csvRow(...ratioHeader))
  const ratioKeys: Array<keyof (typeof comparison.ratiosByYear)[number]> = [
    'grossMarginPercent',
    'atoDebtAsPercentOfRevenue',
    'atoDebtAsPercentOfTotalLiabilities',
    'directorLoansAsPercentOfAssets',
    'currentRatio',
    'debtToAssetRatio',
    'daysRevenueInAtoDebt',
    'netAssetsToTotalLiabilities',
  ]
  for (const rk of ratioKeys) {
    const cells: Array<string | number | null | undefined> = [
      rk,
      ...years.map((y) => {
        const v = comparison.ratiosByYear[y]?.[rk] ?? null
        if (v === null) return ''
        return rk.includes('Percent') || rk.includes('Revenue')
          ? fmtPercent(v)
          : v.toFixed(2)
      }),
    ]
    if (ytdHeader) cells.push('')
    lines.push(csvRow(...cells))
  }
  if (ytdHeader) {
    lines.push(
      csvRow(
        'Note: Ratios are calculated on a full-year basis from the 4 annual financial statements only. Current YTD figures are shown for raw line items only.',
      ),
    )
  }

  // Methodology footer
  lines.push('')
  lines.push(csvRow('METHODOLOGY'))
  lines.push(
    csvRow(
      'Severities, sparklines and year-over-year ratios are computed exclusively from the 4 annual financial statements. The current-period (Current YTD) column is shown alongside for trend awareness only.',
    ),
  )
  if (cp) {
    lines.push(
      csvRow(
        `Current YTD column shows partial-period figures from the client's accounting software (${cp.periodLabel}). Year-over-year comparisons exclude this column because it represents a partial period only.`,
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

export function ExportButton({ comparison, aiSummary, clientName }: Props) {
  function handleExport() {
    const csv = buildCsv(comparison, aiSummary, clientName)
    const safeName = clientName.replace(/[^a-z0-9-]+/gi, '_')
    downloadCsv(csv, `${safeName}_financials_comparison.csv`)
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleExport}>
      <Download className="h-3.5 w-3.5" />
      Export CSV
    </Button>
  )
}
