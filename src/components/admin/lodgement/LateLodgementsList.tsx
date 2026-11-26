'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/admin/ica/IcaParts'
import type { EnrichedRow } from '@/lib/analysis/types'
import {
  LATE_LODGEMENT_HEADERS,
  lateLodgementCells,
  lateLodgementRows,
  lateLodgementsTitle,
  lateLodgementsTsv,
  lateLodgementTsv,
  type LateLodgementRow,
} from '@/lib/analysis/lateLodgementRows'

/**
 * The late lodgements the "Number of Late Lodgements" card counts, directly
 * under the two top cards (Gabby, 24 Nov 2026, item 10): a dropdown with
 * Copy per row, Copy all and an Excel download. The PDF export prints the
 * whole list in the same place (a print-only copy), open or closed.
 */

async function downloadLateXlsx(rows: LateLodgementRow[], amendments: LateLodgementRow[], fileName: string) {
  const XLSX = await import('xlsx')
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[...LATE_LODGEMENT_HEADERS], ...rows.map(lateLodgementCells)]), 'Late lodgements')
  if (amendments.length) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[...LATE_LODGEMENT_HEADERS], ...amendments.map(lateLodgementCells)]), 'Amendments (not counted)')
  }
  XLSX.writeFile(book, `${fileName}.xlsx`)
}

function LateTable({ rows, copy }: { rows: LateLodgementRow[]; copy: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-foreground/50">
            <th className="pb-2 pr-4 font-medium">Period</th>
            <th className="pb-2 pr-4 font-medium">Lodged</th>
            <th className="pb-2 pr-4 font-medium">Due</th>
            <th className="pb-2 pr-4 text-right font-medium">Days late</th>
            <th className="pb-2 pr-4 font-medium">Original / amended</th>
            {copy && <th className="no-print pb-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowIndex} className="border-b border-white/8 last:border-0">
              <td className="py-1.5 pr-4 whitespace-nowrap tabular-nums text-foreground/70" title={r.description}>
                {r.period}
              </td>
              <td className="py-1.5 pr-4 whitespace-nowrap tabular-nums text-foreground/70">{r.lodged}</td>
              <td className="py-1.5 pr-4 whitespace-nowrap tabular-nums text-foreground/70">{r.due}</td>
              <td className="py-1.5 pr-4 text-right font-semibold tabular-nums text-warning">{r.daysLate}</td>
              <td className="py-1.5 pr-4 whitespace-nowrap">
                <span className={r.kind === 'Original' ? 'text-foreground/70' : 'text-warning'}>{r.kind}</span>
              </td>
              {copy && (
                <td className="no-print py-1.5 text-right">
                  <CopyButton text={lateLodgementTsv(r)} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LateLodgementsList({ late, amendments, fileName }: { late: EnrichedRow[]; amendments: EnrichedRow[]; fileName: string }) {
  const [open, setOpen] = useState(false)
  const rows = lateLodgementRows(late)
  const amended = lateLodgementRows(amendments)
  if (rows.length === 0 && amended.length === 0) return null

  const amendmentsNote = (
    <p className="mb-2 text-xs font-medium text-foreground/60">
      Amendments ({amended.length}), listed separately: corrections to statements already lodged, not counted as late
      lodgements. Days are from the original period&apos;s due date.
    </p>
  )

  return (
    <div data-testid="late-lodgements">
      <div className="no-print flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {lateLodgementsTitle(rows, open)}
        </button>
        {open && (
          <>
            <CopyButton text={lateLodgementsTsv(rows)} label="Copy all" />
            <Button variant="ghost" size="sm" onClick={() => void downloadLateXlsx(rows, amended, `${fileName} — Late lodgements`)}>
              <Download className="h-3.5 w-3.5" />
              Excel
            </Button>
          </>
        )}
      </div>
      {open && (
        <div className="print:hidden mt-3 space-y-4">
          <LateTable rows={rows} copy />
          {amended.length > 0 && (
            <div>
              {amendmentsNote}
              <LateTable rows={amended} copy />
            </div>
          )}
        </div>
      )}
      {/* The PDF export: the whole list in this place, whether open on screen or not. */}
      <div className="hidden print:block space-y-4">
        <p className="text-xs font-medium text-foreground/70">{lateLodgementsTitle(rows, false).replace(/^Show the /, 'The ')}</p>
        <LateTable rows={rows} copy={false} />
        {amended.length > 0 && (
          <div>
            {amendmentsNote}
            <LateTable rows={amended} copy={false} />
          </div>
        )}
      </div>
    </div>
  )
}
