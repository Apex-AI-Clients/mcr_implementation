'use client'

import { useState, useEffect } from 'react'
import { ShieldAlert, ChevronDown, ChevronUp, Wallet, X, FileDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DpnRiskBreakdown, EnrichedRow } from '@/lib/analysis/types'

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

function formatAud(value: number): string {
  return AUD.format(value)
}

function formatIso(iso: string | Date | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatMonthYear(d: Date | string | null): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
}

function netColorClass(net: number): string {
  if (net === 0) return 'text-success'
  if (net > 10000) return 'text-destructive'
  return 'text-warning'
}

function netBgClass(net: number): string {
  if (net === 0) return 'bg-success/10 border-success/20'
  if (net > 10000) return 'bg-destructive/10 border-destructive/20'
  return 'bg-warning/10 border-warning/20'
}

interface TileProps {
  label: string
  value: number
  colorClass?: string
  bgClass?: string
}

function MetricTile({ label, value, colorClass, bgClass }: TileProps) {
  return (
    <div className={cn('rounded-lg border p-4 text-center', bgClass ?? 'bg-surface/50 border-border/40')}>
      <p className={cn('text-2xl font-bold tabular-nums', colorClass ?? 'text-foreground')}>
        {formatAud(value)}
      </p>
      <p className="mt-1 text-xs text-foreground/50">{label}</p>
    </div>
  )
}

interface Props {
  dpnRisk: DpnRiskBreakdown
  paymentRows?: EnrichedRow[]
}

export function DpnRiskPanel({ dpnRisk, paymentRows = [] }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showPaymentsModal, setShowPaymentsModal] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const hasDebits = dpnRisk.contributingDebits.length > 0

  useEffect(() => {
    if (!showPaymentsModal) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowPaymentsModal(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [showPaymentsModal])

  const cashPayments = paymentRows
    .filter((r) => r.lodgementType === 'Payment' && (r.credit ?? 0) > 0)
    .sort((a, b) => {
      const da = a.processedDate ? new Date(a.processedDate as unknown as string).getTime() : 0
      const db = b.processedDate ? new Date(b.processedDate as unknown as string).getTime() : 0
      return da - db
    })
  const totalReceived = cashPayments.reduce((s, r) => s + (r.credit ?? 0), 0)

  async function handleExportPdf() {
    if (exportingPdf) return
    setExportingPdf(true)
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
      const doc = await PDFDocument.create()
      const font = await doc.embedFont(StandardFonts.Helvetica)
      const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

      const pageWidth = 595
      const pageHeight = 842
      const margin = 50
      const rowHeight = 16
      const successColor = rgb(0, 0.55, 0.35)
      const mutedColor = rgb(0.4, 0.4, 0.4)
      const ruleColor = rgb(0.75, 0.75, 0.75)

      const dateX = margin
      const descX = margin + 90
      const amountRightX = pageWidth - margin

      let page = doc.addPage([pageWidth, pageHeight])
      let y = pageHeight - margin

      function drawHeaderRow() {
        page.drawText('Date', { x: dateX, y, size: 10, font: fontBold })
        page.drawText('Description', { x: descX, y, size: 10, font: fontBold })
        const amountHeader = 'Amount'
        const amountHeaderWidth = fontBold.widthOfTextAtSize(amountHeader, 10)
        page.drawText(amountHeader, {
          x: amountRightX - amountHeaderWidth,
          y,
          size: 10,
          font: fontBold,
        })
        y -= 6
        page.drawLine({
          start: { x: margin, y },
          end: { x: pageWidth - margin, y },
          thickness: 0.5,
          color: ruleColor,
        })
        y -= 14
      }

      // Title + subtitle
      page.drawText('Payments Received', { x: margin, y, size: 16, font: fontBold })
      y -= 22
      page.drawText(
        `${cashPayments.length} payment${cashPayments.length !== 1 ? 's' : ''} recorded on the Activity Statement Account.`,
        { x: margin, y, size: 10, font, color: mutedColor },
      )
      y -= 24

      drawHeaderRow()

      const maxDescWidth = amountRightX - descX - 90

      function truncateToWidth(text: string, maxWidth: number): string {
        if (font.widthOfTextAtSize(text, 10) <= maxWidth) return text
        let truncated = text
        while (
          truncated.length > 0 &&
          font.widthOfTextAtSize(truncated + '…', 10) > maxWidth
        ) {
          truncated = truncated.slice(0, -1)
        }
        return truncated + '…'
      }

      for (const r of cashPayments) {
        if (y < margin + 60) {
          page = doc.addPage([pageWidth, pageHeight])
          y = pageHeight - margin
          drawHeaderRow()
        }

        const dateStr = formatIso(r.processedDate)
        const descStr = truncateToWidth(r.description || '—', maxDescWidth)
        const amountStr = formatAud(r.credit ?? 0)
        const amountWidth = font.widthOfTextAtSize(amountStr, 10)

        page.drawText(dateStr, { x: dateX, y, size: 10, font })
        page.drawText(descStr, { x: descX, y, size: 10, font, color: mutedColor })
        page.drawText(amountStr, {
          x: amountRightX - amountWidth,
          y,
          size: 10,
          font,
          color: successColor,
        })
        y -= rowHeight
      }

      // Total — ensure room for the separator + the row itself
      if (y < margin + 40) {
        page = doc.addPage([pageWidth, pageHeight])
        y = pageHeight - margin
      }
      y -= 4
      page.drawLine({
        start: { x: margin, y },
        end: { x: pageWidth - margin, y },
        thickness: 1,
        color: rgb(0.35, 0.35, 0.35),
      })
      y -= 20
      page.drawText('Total Received', { x: margin, y, size: 12, font: fontBold })
      const totalStr = formatAud(totalReceived)
      const totalWidth = fontBold.widthOfTextAtSize(totalStr, 12)
      page.drawText(totalStr, {
        x: amountRightX - totalWidth,
        y,
        size: 12,
        font: fontBold,
        color: successColor,
      })

      const bytes = await doc.save()
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'payments-received.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-foreground/50" />
        <h3 className="text-sm font-semibold text-foreground">DPN Risk (&gt;90 days late)</h3>
      </div>

      {/* Three metric tiles */}
      <div className="grid grid-cols-3 gap-3">
        <MetricTile
          label="Gross debt >90 days late"
          value={dpnRisk.totalGrossLate}
          colorClass="text-foreground/80"
          bgClass="bg-surface/50 border-border/40"
        />
        <MetricTile
          label="Paid since lodged"
          value={dpnRisk.totalPaidSince}
          colorClass="text-success"
          bgClass="bg-success/10 border-success/20"
        />
        <MetricTile
          label="Net at risk"
          value={dpnRisk.totalNetAtRisk}
          colorClass={netColorClass(dpnRisk.totalNetAtRisk)}
          bgClass={`border ${netBgClass(dpnRisk.totalNetAtRisk)}`}
        />
      </div>

      {/* Payments received — compact summary card */}
      {cashPayments.length > 0 && (() => {
        const firstMonth = formatMonthYear(cashPayments[0].processedDate)
        const lastMonth = formatMonthYear(cashPayments[cashPayments.length - 1].processedDate)
        const sameMonth = firstMonth === lastMonth
        const countLabel = `${cashPayments.length} payment${cashPayments.length !== 1 ? 's' : ''}`
        const periodLabel = sameMonth ? `in ${firstMonth}` : `from ${firstMonth} to ${lastMonth}`

        return (
          <button
            type="button"
            onClick={() => setShowPaymentsModal(true)}
            className="flex w-full items-center justify-between gap-4 rounded-lg border border-success/20 bg-success/5 p-4 text-left hover:bg-success/10 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-success/15">
                <Wallet className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="text-xs font-medium text-foreground/50">Payments Received</p>
                <p className="text-xs text-foreground/45 mt-0.5">
                  {countLabel} {periodLabel} · click for breakdown
                </p>
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums text-success">
              {formatAud(totalReceived)}
            </p>
          </button>
        )
      })()}

      {showPaymentsModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowPaymentsModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-border bg-surface shadow-2xl"
          >
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={exportingPdf || cashPayments.length === 0}
                aria-label="Export payments as PDF"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground/70 hover:bg-primary/40 hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileDown className="h-3.5 w-3.5" />
                {exportingPdf ? 'Exporting…' : 'Export PDF'}
              </button>
              <button
                type="button"
                onClick={() => setShowPaymentsModal(false)}
                aria-label="Close payments breakdown"
                className="rounded-md p-1.5 text-foreground/50 hover:bg-primary/40 hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Header — fixed at top */}
            <div className="shrink-0 px-5 pt-5 pb-3 space-y-2">
              <div className="flex items-center gap-2 pr-36">
                <Wallet className="h-4 w-4 text-success" />
                <h4 className="text-sm font-semibold text-foreground">Payments Received</h4>
              </div>
              <p className="text-xs text-foreground/50">
                {cashPayments.length} payment{cashPayments.length !== 1 ? 's' : ''} recorded on the Activity Statement Account.
              </p>
            </div>

            {/* Scrollable list */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface z-10">
                  <tr className="border-b border-border text-left text-foreground/40">
                    <th className="pb-2 pr-4 font-medium">Date</th>
                    <th className="pb-2 pr-4 font-medium">Description</th>
                    <th className="pb-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {cashPayments.map((r) => (
                    <tr key={r.rowIndex} className="border-b border-border/40 last:border-0">
                      <td className="py-1.5 pr-4 text-foreground/70 whitespace-nowrap">
                        {formatIso(r.processedDate)}
                      </td>
                      <td className="py-1.5 pr-4 text-foreground/60 max-w-[14rem] truncate" title={r.description}>
                        {r.description || '—'}
                      </td>
                      <td className="py-1.5 text-right font-semibold text-success tabular-nums">
                        {formatAud(r.credit ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Sticky total — pinned at bottom */}
            <div className="shrink-0 border-t-2 border-border bg-surface px-5 py-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-semibold text-foreground">Total Received</span>
                <span className="text-base font-bold text-success tabular-nums">
                  {formatAud(totalReceived)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expandable contributing debits */}
      {hasDebits && (
        <div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? 'Hide' : 'Show'} contributing rows ({dpnRisk.contributingDebits.length})
          </button>

          {expanded && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-foreground/40">
                    <th className="pb-2 pr-4 font-medium">Processed</th>
                    <th className="pb-2 pr-4 font-medium">Period Ending</th>
                    <th className="pb-2 pr-4 font-medium text-right">Days Late</th>
                    <th className="pb-2 pr-4 font-medium text-right">Gross</th>
                    <th className="pb-2 pr-4 font-medium text-right">Paid since</th>
                    <th className="pb-2 font-medium text-right">Net at risk</th>
                  </tr>
                </thead>
                <tbody>
                  {dpnRisk.contributingDebits.map((r) => (
                    <tr key={r.rowIndex} className="border-b border-border/40 last:border-0">
                      <td className="py-1.5 pr-4 text-foreground/70 whitespace-nowrap">
                        {formatIso(r.processedDate)}
                      </td>
                      <td className="py-1.5 pr-4 text-foreground/70 whitespace-nowrap">
                        {formatIso(r.periodEnding)}
                      </td>
                      <td className={cn('py-1.5 pr-4 text-right font-semibold', {
                        'text-destructive': r.daysLate > 365,
                        'text-warning': r.daysLate > 0 && r.daysLate <= 365,
                      })}>
                        {r.daysLate}
                      </td>
                      <td className="py-1.5 pr-4 text-right text-foreground/70">
                        {r.debit > 0 ? formatAud(r.debit) : '—'}
                      </td>
                      <td className="py-1.5 pr-4 text-right text-success">
                        {r.paymentsSinceLodged > 0 ? formatAud(r.paymentsSinceLodged) : '—'}
                      </td>
                      <td className={cn('py-1.5 text-right font-semibold', {
                        'text-destructive': r.netAtRisk > 0,
                        'text-success': r.netAtRisk === 0,
                      })}>
                        {formatAud(r.netAtRisk)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
