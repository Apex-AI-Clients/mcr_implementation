'use client'

import { useState } from 'react'
import { BadgeCheck, Check, ChevronDown, ChevronUp, Copy, Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { AsPrintedRow, IcaView } from '@/lib/ica/view'
import { TOTALS_HELD_BACK } from '@/lib/ica/status'

/**
 * The ATO account file's verification on the pages (src/lib/ica/view.ts):
 * the badge on a verified file, its composition in the ATO's words, and for
 * any other file the rows exactly as printed, with "Totals being prepared"
 * and no calculated figure.
 */

const aud = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function VerifiedBadge({ text }: { text: string }) {
  return (
    <span
      data-testid="ica-verified-badge"
      className="inline-flex items-center gap-1.5 rounded-full border border-success/35 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success"
    >
      <BadgeCheck className="h-3.5 w-3.5" />
      {text}
    </span>
  )
}

/** Copies the row's description and amount as printed. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          // The browser refused; nothing else to do.
        }
      }}
      className="no-print inline-flex items-center gap-1 rounded border border-accent/30 px-1.5 py-0.5 text-[10.5px] text-accent hover:bg-accent/10"
      aria-label={`${label}: ${text}`}
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {done ? 'Copied' : label}
    </button>
  )
}

const copyText = (r: AsPrintedRow) => `${r.description}\t${r.debit || r.credit}`

/** The rows as an Excel file, exactly as printed. SheetJS is loaded only when asked. */
export async function downloadRowsXlsx(rows: AsPrintedRow[], fileName: string) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Processed date', 'Effective date', 'Description', 'Debit (DR)', 'Credit (CR)', 'Balance'],
    ...rows.map((r) => [r.processed, r.effective, r.description, r.debit, r.credit, r.balance]),
  ])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Rows')
  XLSX.writeFile(book, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`)
}

export function RowsTable({ rows, max }: { rows: AsPrintedRow[]; max?: number }) {
  const shown = max ? rows.slice(0, max) : rows
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-foreground/50">
            <th className="py-1.5 pr-3 font-medium">Processed date</th>
            <th className="py-1.5 pr-3 font-medium">Effective date</th>
            <th className="py-1.5 pr-3 font-medium">Description</th>
            <th className="py-1.5 pr-3 text-right font-medium">Debit (DR)</th>
            <th className="py-1.5 pr-3 text-right font-medium">Credit (CR)</th>
            <th className="py-1.5 pr-3 text-right font-medium">Balance</th>
            <th className="no-print py-1.5" />
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className="border-b border-white/8 align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{r.processed}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{r.effective}</td>
              <td className="py-1.5 pr-3">{r.description}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap tabular-nums">{r.debit}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap tabular-nums">{r.credit}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap tabular-nums">{r.balance}</td>
              <td className="no-print py-1.5 text-right">
                <CopyButton text={copyText(r)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {max !== undefined && rows.length > max && (
        <p className="mt-2 text-xs text-foreground/50">… and {rows.length - max} more rows in the Excel download.</p>
      )}
    </div>
  )
}

/**
 * A file that is not verified (or not checked yet): no calculated figure. The
 * neutral note, and the rows exactly as printed with Copy and an Excel download.
 */
export function HeldBackAccount({ view, fileName, title = 'ATO account, as printed' }: { view: IcaView; fileName: string; title?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-testid="ica-held-back" className="space-y-3">
      <div className="rounded-lg border border-border bg-surface/60 px-4 py-3 text-sm text-foreground/70">{TOTALS_HELD_BACK}</div>
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-accent">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {title} ({view.asPrinted.length} rows)
        </button>
        {view.asPrinted.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => void downloadRowsXlsx(view.asPrinted, fileName)}>
            <Download className="h-3.5 w-3.5" />
            Download these rows (Excel)
          </Button>
        )}
      </div>
      {open && <RowsTable rows={view.asPrinted} max={500} />}
    </div>
  )
}

/** A verified file's composition, every line in the ATO's words, each with its rows. */
export function VerifiedComposition({ view, fileName }: { view: IcaView; fileName: string }) {
  const [openLine, setOpenLine] = useState<string | null>(null)
  if (!view.composition || !view.badge) return null
  const c = view.composition
  const byId = new Map(view.asPrinted.map((r) => [r.id, r]))
  const debtSections = new Set(['tax', 'interest', 'penalties'])
  const debtLines = c.lines.filter((l) => debtSections.has(l.section))
  const otherLines = c.lines.filter((l) => !debtSections.has(l.section))
  const renderLine = (l: (typeof c.lines)[number]) => {
    const rows = l.rowIds.map((id) => byId.get(id)).filter((r): r is AsPrintedRow => !!r)
    const open = openLine === l.key
    return (
      <div key={l.key} className="border-b border-white/8 py-1.5">
        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={() => setOpenLine(open ? null : l.key)}
            className="flex items-center gap-1 text-left text-foreground/80 hover:text-foreground"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
            <span>{l.named ? l.label : `“${l.label}”`}</span>
            <span className="text-xs text-foreground/40">· {l.rows} rows</span>
          </button>
          <span className="tabular-nums font-medium" title={`Rows: ${l.search.join(' | ')}`}>
            {aud(l.net)}
          </span>
        </div>
        {open && (
          <div className="mt-2 space-y-2 pl-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/50">
              <span>Search your spreadsheet for: {l.search.map((s) => `“${s}”`).join(', ')}</span>
              <Button variant="ghost" size="sm" onClick={() => void downloadRowsXlsx(rows, `${fileName} — ${l.label}`)}>
                <Download className="h-3.5 w-3.5" />
                Download these rows (Excel)
              </Button>
            </div>
            <RowsTable rows={rows} max={300} />
          </div>
        )}
      </div>
    )
  }
  return (
    <div data-testid="ica-composition" className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Debt composition</h4>
        <VerifiedBadge text={view.badge} />
      </div>
      <p className="text-xs text-foreground/50">Every line in the ATO&apos;s own words; click a line for its rows exactly as printed.</p>
      <div className="flex items-center justify-between border-b border-white/8 py-1.5 text-sm">
        <span className="text-foreground/80">Balance brought forward</span>
        <span className="tabular-nums font-medium">{aud(c.opening)}</span>
      </div>
      {debtLines.map(renderLine)}
      <div className="flex items-center justify-between border-b border-border py-1.5 text-sm font-semibold">
        <span>= ATO debt</span>
        <span className="tabular-nums">{aud(c.atoDebt)}</span>
      </div>
      {otherLines.map(renderLine)}
      <div className="flex items-center justify-between py-2 text-sm font-semibold">
        <span>= The ATO&apos;s balance{view.balanceDate ? ` at ${view.balanceDate}` : ''}</span>
        <span className="tabular-nums">{aud(c.total)}</span>
      </div>
      {c.notCounted > 0 && (
        <p className="text-xs text-foreground/40">
          {c.notCounted} rows are not counted on their own: each is the total or the breakdown of a counted row.
        </p>
      )}
    </div>
  )
}
