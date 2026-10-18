'use client'

import { useState } from 'react'
import { Download, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { downloadBlob, downloadCsv } from '@/lib/csv'
import { buildDpnCsv, type DpnExportMeta } from '@/lib/dpn/exportCsv'
import type { DpnSummary } from '@/lib/dpn/summary'

interface DpnExportButtonsProps {
  summary: DpnSummary
  meta: DpnExportMeta
}

/** "dpn-summary-example-trading-2026-10-17". */
function baseName(meta: DpnExportMeta): string {
  const slug = meta.clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `dpn-summary-${slug || 'client'}-${meta.asAtIso}`
}

/**
 * CSV and PDF of the summary, built in the browser from the same summary the
 * page shows. pdf-lib is loaded only when a PDF is asked for.
 */
export function DpnExportButtons({ summary, meta }: DpnExportButtonsProps) {
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function exportPdf() {
    setBuilding(true)
    setError(null)
    try {
      const { buildDpnPdf } = await import('@/lib/dpn/exportPdf')
      const bytes = await buildDpnPdf(summary, meta)
      downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${baseName(meta)}.pdf`)
    } catch {
      setError('The PDF could not be built.')
    } finally {
      setBuilding(false)
    }
  }

  // The same buttons, words and order as the comparison and prediction pages.
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={exportPdf} disabled={building}>
          {building ? (
            'Exporting…'
          ) : (
            <>
              <FileDown className="h-3.5 w-3.5" />
              Export PDF
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => downloadCsv(buildDpnCsv(summary, meta), `${baseName(meta)}.csv`)}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
