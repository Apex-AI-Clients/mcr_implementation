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

  lines.push(csvRow('Financial Statements Comparison', clientName))
  lines.push(csvRow('Generated', new Date().toISOString()))
  lines.push(csvRow('Period', `${comparison.periodRange.start} to ${comparison.periodRange.end}`))
  lines.push('')

  // Headlines
  lines.push(csvRow('HEADLINES'))
  lines.push(csvRow('Metric', ...years.map((y) => `FY${y}`), 'Latest severity'))
  for (const key of [
    'revenue',
    'netProfit',
    'netAssets',
    'atoDebtTrajectory',
    'directorLoansReceivable',
  ] as const) {
    const m = comparison.headlines[key]
    lines.push(csvRow(m.label, ...m.trend.map(fmtCurrency), m.severity))
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
  lines.push(csvRow('Line item', ...years.map((y) => `FY${y}`)))
  for (const section of comparison.incomeStatementDiffs) {
    lines.push(csvRow(`[${section.category}]`))
    for (const row of section.rows) {
      lines.push(
        csvRow(
          row.label,
          ...years.map((y) => fmtCurrency(row.valuesByYear[y])),
        ),
      )
    }
  }
  lines.push('')

  // Balance sheet
  lines.push(csvRow('BALANCE SHEET'))
  lines.push(csvRow('Line item', ...years.map((y) => `FY${y}`)))
  for (const section of comparison.balanceSheetDiffs) {
    lines.push(csvRow(`[${section.category}]`))
    for (const row of section.rows) {
      lines.push(
        csvRow(
          row.label,
          ...years.map((y) => fmtCurrency(row.valuesByYear[y])),
        ),
      )
    }
  }
  lines.push('')

  // ATO aggregate
  lines.push(csvRow('ATO-RELATED CURRENT LIABILITIES (combined)'))
  lines.push(csvRow('Component', ...years.map((y) => `FY${y}`)))
  for (const key of ATO_LIABILITY_KEYS) {
    lines.push(
      csvRow(
        key,
        ...years.map((y) => fmtCurrency(comparison.atoLiabilityByYear[y]?.byKey[key] ?? null)),
      ),
    )
  }
  lines.push(
    csvRow('Total', ...years.map((y) => fmtCurrency(comparison.atoLiabilityByYear[y]?.total ?? null))),
  )
  lines.push('')

  // Ratios
  lines.push(csvRow('KEY RATIOS'))
  lines.push(csvRow('Ratio', ...years.map((y) => `FY${y}`)))
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
    lines.push(
      csvRow(
        rk,
        ...years.map((y) => {
          const v = comparison.ratiosByYear[y]?.[rk] ?? null
          if (v === null) return ''
          return rk.includes('Percent') || rk.includes('Revenue')
            ? fmtPercent(v)
            : v.toFixed(2)
        }),
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
