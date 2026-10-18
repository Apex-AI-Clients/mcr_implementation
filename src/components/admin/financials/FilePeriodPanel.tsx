'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { describePeriod } from '@/lib/financials/periodOverride'
import type { FinancialFileRow } from '@/lib/financials/financialFiles'
import { OverrideForm, periodSummary } from './FinancialFilesTable'

interface FilePeriodPanelProps {
  clientId: string
  file: FinancialFileRow
  yearOptions: number[]
  /** A comparison is running: a change is saved, and read again once it finishes. */
  running: boolean
  /** Read the file again (and rebuild the comparison) after a change. */
  onReread: (documentIds: string[]) => void
  onClose: () => void
}

/**
 * One file picked in the "Statements on file" table: what its headings were
 * read as ("Detected: FY2026 annual — Change"), or the year and type staff
 * set by hand ("Overridden"). Changing it, or going back to the headings,
 * saves the override and reads the file again.
 */
export function FilePeriodPanel({ clientId, file, yearOptions, running, onReread, onClose }: FilePeriodPanelProps) {
  const [editing, setEditing] = useState(false)
  const summary = periodSummary(file)

  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3 text-xs" role="region" aria-label={`Year and type for ${file.filename}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="break-words font-medium text-foreground/80">{file.filename}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-0.5 text-foreground/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {editing ? (
        <div className="mt-2">
          <OverrideForm
            clientId={clientId}
            file={file}
            yearOptions={yearOptions}
            running={running}
            align="start"
            onDone={(changed) => {
              setEditing(false)
              if (changed && !running) onReread([file.documentId])
            }}
          />
        </div>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-foreground/70">
            {file.override ? (
              <>
                <Badge variant="accent">Overridden</Badge>
                <span>Set by hand: {describePeriod(file.override)}</span>
              </>
            ) : (
              <span>Detected: {summary ?? 'nothing read yet'}</span>
            )}
            <span aria-hidden>—</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Change
            </Button>
          </p>
          {file.override && (
            <p className="text-foreground/50">
              Set by {file.override.by ?? 'staff'}
              {file.override.at ? `, ${formatDate(file.override.at)}` : ''}. Choose Change, then &ldquo;Use the headings&rdquo;, to go
              back to what the file&apos;s headings say.
            </p>
          )}
          {file.overridePending && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-warning">Not applied yet: the file has not been read again since this was set.</span>
              <Button type="button" size="sm" variant="accent" disabled={running} onClick={() => onReread([file.documentId])}>
                Read again
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
