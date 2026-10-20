'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { cn, formatDate } from '@/lib/utils'
import type { FileUsage, FinancialFileRow } from '@/lib/financials/financialFiles'
import type { PeriodKind } from '@/lib/financials/periodOverride'

interface FinancialFilesTableProps {
  clientId: string
  files: FinancialFileRow[]
  yearOptions: number[]
  /** Read these files again (and rebuild the comparison), after an override. */
  onReread: (documentIds: string[]) => void
  /** A comparison is running: overrides wait for it. */
  running: boolean
}

const USAGE_BADGE: Record<FileUsage, { label: string; variant: 'success' | 'muted' | 'warning' | 'accent' }> = {
  used: { label: 'Used', variant: 'success' },
  older: { label: 'Older, shown only', variant: 'muted' },
  superseded: { label: 'Superseded', variant: 'warning' },
  later_current_on_file: { label: 'Not used', variant: 'muted' },
  not_financial: { label: 'Not statements', variant: 'warning' },
  tax_return_only: { label: 'Tax return only', variant: 'warning' },
  not_read: { label: 'Not read yet', variant: 'muted' },
  nothing_read: { label: 'Nothing read', variant: 'warning' },
}

const KIND_OPTIONS = [
  { value: 'annual', label: 'Annual' },
  { value: 'current_period', label: 'Current period' },
]

function readAs(file: FinancialFileRow): string {
  const parts: string[] = []
  if (file.annualYears.length > 0) parts.push(`Annual ${file.annualYears.map((y) => `FY${y}`).join(', ')}`)
  if (file.comparativeYears.length > 0) {
    parts.push(`${file.comparativeYears.map((y) => `FY${y}`).join(', ')} prior-year column`)
  }
  if (file.currentPeriodYear !== null) parts.push(`Current period, FY${file.currentPeriodYear}`)
  return parts.join(' · ') || '—'
}

/**
 * Every financial statement file, what it was read as, and whether it is
 * used. "Change" sets a file's year and type by hand when its headings
 * mislead; the file is then read again on its own and the comparison rebuilt.
 */
export function FinancialFilesTable({ clientId, files, yearOptions, onReread, running }: FinancialFilesTableProps) {
  const [editing, setEditing] = useState<string | null>(null)

  if (files.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] text-xs">
        <thead>
          <tr className="border-b border-white/8 bg-surface/40 text-left text-foreground/60">
            <th scope="col" className="py-2 pl-3 pr-4 font-medium">File</th>
            <th scope="col" className="py-2 pr-4 font-medium">Read as</th>
            <th scope="col" className="py-2 pr-4 font-medium">In the comparison</th>
            <th scope="col" className="py-2 pr-3 font-medium">
              <span className="sr-only">Year and type</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.documentId} className="border-b border-white/8 align-top last:border-0">
              <td className="max-w-[220px] py-2.5 pl-3 pr-4 break-words text-foreground/80">{file.filename}</td>
              <td className="py-2.5 pr-4 text-foreground/80">
                {readAs(file)}
                {file.override && (
                  <p className="mt-1 text-foreground/40">
                    Set by {file.override.by ?? 'staff'}
                    {file.override.at ? `, ${formatDate(file.override.at)}` : ''}
                  </p>
                )}
              </td>
              <td className="py-2.5 pr-4">
                <Badge variant={USAGE_BADGE[file.usage].variant}>{USAGE_BADGE[file.usage].label}</Badge>
                <p className="mt-1 max-w-[320px] text-foreground/60">{file.note}</p>
              </td>
              <td className="py-2.5 pr-3 text-right">
                {editing === file.documentId ? (
                  <OverrideForm
                    clientId={clientId}
                    file={file}
                    yearOptions={yearOptions}
                    running={running}
                    onDone={(changed) => {
                      setEditing(null)
                      if (changed) onReread([file.documentId])
                    }}
                  />
                ) : (
                  <div className="flex justify-end gap-1.5">
                    {file.overridePending && (
                      <Button type="button" size="sm" variant="accent" disabled={running} onClick={() => onReread([file.documentId])}>
                        Read again
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(file.documentId)}>
                      Change
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * What a file was read as, in a few words: "FY2026 annual" or "FY2026 current
 * period". The file's own year (not a prior-year column it also prints).
 */
export function periodSummary(file: FinancialFileRow): string | null {
  const annual = file.annualYears.at(-1)
  if (annual !== undefined) return `FY${annual} annual`
  if (file.currentPeriodYear !== null) return `FY${file.currentPeriodYear} current period`
  const comparative = file.comparativeYears.at(-1)
  return comparative !== undefined ? `FY${comparative} prior-year column only` : null
}

/** Year and type set by hand, or cleared back to the headings; then the file is read again. */
export function OverrideForm({
  clientId,
  file,
  yearOptions,
  running,
  onDone,
  align = 'end',
}: {
  clientId: string
  file: FinancialFileRow
  yearOptions: number[]
  running: boolean
  onDone: (changed: boolean) => void
  /** Right-aligned in the files table; left-aligned in the coverage table's panel. */
  align?: 'start' | 'end'
}) {
  const router = useRouter()
  const startKind: PeriodKind = file.override?.kind ?? (file.currentPeriodYear !== null && file.annualYears.length === 0 ? 'current_period' : 'annual')
  const startYear = file.override?.financialYear ?? file.annualYears.at(-1) ?? file.currentPeriodYear ?? yearOptions[1]
  const [kind, setKind] = useState<PeriodKind>(startKind)
  const [year, setYear] = useState(String(startYear))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(body: object) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/financial-statements/${file.documentId}/period`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error ?? 'That did not save.')
        return
      }
      router.refresh()
      onDone(true)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn('flex max-w-[300px] flex-col gap-1.5 text-left', align === 'end' ? 'ml-auto items-end' : 'items-start')}>
      <div className="flex gap-1.5">
        <Select
          aria-label={`Type for ${file.filename}`}
          selectSize="sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as PeriodKind)}
          options={KIND_OPTIONS}
        />
        <Select
          aria-label={`Financial year for ${file.filename}`}
          selectSize="sm"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          options={yearOptions.map((y) => ({ value: String(y), label: kind === 'annual' ? `FY${y}` : `Within FY${y}` }))}
        />
      </div>
      {running && <p className="text-foreground/50">A comparison is running. Save now; read the file again once it finishes.</p>}
      {error && <p className="text-destructive">{error}</p>}
      <div className="flex gap-1.5">
        {file.override && (
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => save({ clear: true })}>
            Use the headings
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          loading={saving}
          onClick={() => save({ kind, financialYear: Number(year) })}
        >
          Save and read again
        </Button>
      </div>
    </div>
  )
}
