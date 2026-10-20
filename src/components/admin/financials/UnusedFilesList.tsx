'use client'

import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { FileUsage, FinancialFileRow } from '@/lib/financials/financialFiles'
import type { StatementCoverage } from '@/lib/financials/coverage'

/** Why a file is in no cell of the coverage table, in a word or two. */
const REASON: Partial<Record<FileUsage, string>> = {
  superseded: 'Superseded',
  later_current_on_file: 'Later period on file',
  not_financial: 'Not a statement',
  tax_return_only: 'Tax return only',
  nothing_read: 'Nothing read',
  not_read: 'Not read yet',
  older: 'Older year',
  used: 'Not in the table',
}

/** The files no cell of the coverage table names: they cannot be clicked there. */
export function filesNotInCoverage(files: readonly FinancialFileRow[], coverage: StatementCoverage): FinancialFileRow[] {
  const shown = new Set<string>()
  for (const cells of Object.values(coverage.rows)) {
    for (const c of cells) if (c.documentId) shown.add(c.documentId)
  }
  return files.filter((f) => !shown.has(f.documentId))
}

interface UnusedFilesListProps {
  files: FinancialFileRow[]
  selectedDocumentId: string | null
  onSelect: (documentId: string) => void
  /** The year-and-type panel for the selected file, shown under its row. */
  panel: ReactNode
}

/**
 * "Files not used in the comparison": superseded current periods, files read
 * as nothing, files that are not statements. Each with its reason and the
 * same Change as the coverage table.
 */
export function UnusedFilesList({ files, selectedDocumentId, onSelect, panel }: UnusedFilesListProps) {
  if (files.length === 0) return null
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-foreground/70">Files not used in the comparison</h4>
      <ul className="divide-y divide-border rounded-lg border border-border text-xs">
        {files.map((file) => {
          const selected = file.documentId === selectedDocumentId
          return (
            <li key={file.documentId} className={cn('p-3', selected && 'bg-surface/40')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="break-words font-medium text-foreground/80">{file.filename}</span>
                    <Badge variant="warning">{REASON[file.usage] ?? 'Not used'}</Badge>
                  </p>
                  <p className="text-foreground/60">{file.note}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={selected}
                  aria-label={`Change the year and type of ${file.filename}`}
                  onClick={() => onSelect(file.documentId)}
                >
                  Change
                </Button>
              </div>
              {selected && <div className="mt-2">{panel}</div>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
