'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { rowAddsUp } from '@/lib/dpn/checks'
import { ManualNoticeSchema, centsToTyped, parseTypedAmount } from '@/lib/dpn/manualEntry'
import { formatCents } from '@/lib/dpn/view'
import { amountHeadings, columnHeading } from '@/lib/dpn/summary'
import { DPN_TYPE_LABEL, type DpnType } from '@/lib/dpn/types'
import type { StoredNotice } from '@/lib/dpn/stored'

interface DpnManualFormProps {
  clientId: string
  documentId: string
  /** What the parser did read, to start from. Null for a file never read. */
  notice: StoredNotice | null
  onClose: () => void
}

const COLUMNS = ['column2', 'column3', 'column4', 'column5'] as const
type Column = (typeof COLUMNS)[number]


interface RowDraft {
  key: number
  periodFrom: string
  periodTo: string
  column2: string
  column3: string
  column4: string
  column5: string
}

const TYPE_OPTIONS = (Object.keys(DPN_TYPE_LABEL) as DpnType[]).map((type) => ({
  value: type,
  label: DPN_TYPE_LABEL[type],
}))

let nextKey = 1
function emptyRow(): RowDraft {
  return { key: nextKey++, periodFrom: '', periodTo: '', column2: '', column3: '', column4: '', column5: '' }
}

function initialRows(notice: StoredNotice | null): RowDraft[] {
  if (!notice || notice.rows.length === 0) return [emptyRow()]
  return notice.rows.map((row) => ({
    key: nextKey++,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    column2: centsToTyped(row.column2),
    column3: centsToTyped(row.column3),
    column4: centsToTyped(row.column4),
    column5: centsToTyped(row.column5),
  }))
}

/**
 * Enter a notice by hand, or correct one that was read. Prefilled with
 * whatever the parser read. Saved as "entered manually", with who and when;
 * an automatic re-read never overwrites it.
 *
 * The director field takes their name only. The notice also prints their home
 * address, which has no field here and is never stored.
 */
export function DpnManualForm({ clientId, documentId, notice, onClose }: DpnManualFormProps) {
  const router = useRouter()
  const [reference, setReference] = useState(notice?.reference ?? '')
  const [issuedOn, setIssuedOn] = useState(notice?.issuedOn ?? '')
  const [type, setType] = useState<string>(notice?.type ?? '')
  // The table's headings as this notice prints them, so the figures can be
  // copied across column by column. They follow the type chosen above.
  const noticeType = type ? (type as DpnType) : null
  const headings = amountHeadings([noticeType])
  const period = columnHeading('column1', [noticeType])
  const [companyName, setCompanyName] = useState(notice?.companyName ?? '')
  const [acn, setAcn] = useState(notice?.acn ?? '')
  const [directorName, setDirectorName] = useState(notice?.directorName ?? '')
  const [rows, setRows] = useState<RowDraft[]>(() => initialRows(notice))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function setCell(key: number, field: keyof Omit<RowDraft, 'key'>, value: string) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
    setError(null)
  }

  const parsedRows = rows.map((row) => ({
    row,
    amounts: Object.fromEntries(COLUMNS.map((c) => [c, parseTypedAmount(row[c])])) as Record<Column, number | null>,
  }))
  const totals = Object.fromEntries(
    COLUMNS.map((c) => [c, parsedRows.reduce((sum, { amounts }) => sum + (amounts[c] ?? 0), 0)]),
  ) as Record<Column, number>

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const badRow = parsedRows.findIndex(({ amounts }) => COLUMNS.some((c) => amounts[c] === null))
    if (badRow >= 0) {
      setError(`Row ${badRow + 1}: enter all four amounts, e.g. 1234.56 (0 if nil).`)
      return
    }
    const body = {
      reference,
      issuedOn,
      type,
      companyName,
      acn,
      directorName,
      rows: parsedRows.map(({ row, amounts }) => ({
        periodFrom: row.periodFrom,
        periodTo: row.periodTo,
        ...(amounts as Record<Column, number>),
      })),
    }
    const checked = ManualNoticeSchema.safeParse(body)
    if (!checked.success) {
      const issue = checked.error.issues[0]
      const rowIndex = issue.path[0] === 'rows' && typeof issue.path[1] === 'number' ? issue.path[1] : null
      setError(rowIndex === null ? issue.message : `Row ${rowIndex + 1}: ${issue.message}`)
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/director-penalty-notices/${documentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error ?? 'The notice could not be saved.')
        return
      }
      router.refresh()
      onClose()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={notice?.source === 'manual' || notice?.status === 'needs_manual' || !notice ? 'Enter notice manually' : 'Correct notice by hand'}
      description="Copy the details from the notice. It will be marked as entered manually, with your name."
      className="max-w-5xl"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="dpn-manual-form" loading={saving}>
            Save as entered manually
          </Button>
        </>
      }
    >
      <form id="dpn-manual-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input id="dpn-reference" label="Our reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          <Input id="dpn-issued" label="Date of issue" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          <Select
            id="dpn-type"
            label="This notice is for"
            placeholder="Select"
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={TYPE_OPTIONS}
          />
          <Input id="dpn-company" label="For this company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          <Input id="dpn-acn" label="With this ACN" inputMode="numeric" value={acn} onChange={(e) => setAcn(e.target.value)} />
          <Input
            id="dpn-director"
            label="Director (the TO: line)"
            value={directorName}
            onChange={(e) => setDirectorName(e.target.value)}
            hint={<p className="text-xs text-foreground/40">Name only. Do not enter their address.</p>}
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-2 py-2 align-bottom font-medium">{period}: from</th>
                <th className="px-2 py-2 align-bottom font-medium">{period}: to</th>
                {COLUMNS.map((c) => (
                  <th key={c} className="min-w-[8rem] px-2 py-2 text-right align-bottom font-medium leading-snug">
                    {headings[c]}
                  </th>
                ))}
                <th className="px-2 py-2 font-medium">
                  <span className="sr-only">Check and remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.map(({ row, amounts }, index) => {
                const complete = COLUMNS.every((c) => amounts[c] !== null)
                const adds = complete && rowAddsUp(amounts as Record<Column, number>)
                return (
                  <tr key={row.key} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        aria-label={`Row ${index + 1} period from`}
                        value={row.periodFrom}
                        onChange={(e) => setCell(row.key, 'periodFrom', e.target.value)}
                        className="h-8 w-full rounded-md border border-border bg-input-bg px-2 text-sm text-foreground focus:border-accent focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        aria-label={`Row ${index + 1} period to`}
                        value={row.periodTo}
                        onChange={(e) => setCell(row.key, 'periodTo', e.target.value)}
                        className="h-8 w-full rounded-md border border-border bg-input-bg px-2 text-sm text-foreground focus:border-accent focus:outline-none"
                      />
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c} className="px-2 py-1.5">
                        <input
                          inputMode="decimal"
                          aria-label={`Row ${index + 1} ${headings[c]}`}
                          value={row[c]}
                          onChange={(e) => setCell(row.key, c, e.target.value)}
                          className={`h-8 w-full rounded-md border bg-input-bg px-2 text-right text-sm tabular-nums text-foreground focus:border-accent focus:outline-none ${
                            row[c].trim() && amounts[c] === null ? 'border-destructive' : 'border-border'
                          }`}
                        />
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span
                        className={`mr-1 text-xs ${complete ? (adds ? 'text-success' : 'text-warning') : 'text-foreground/30'}`}
                        title="The unpaid amount should be the notified and not-notified amounts added together"
                      >
                        {complete ? (adds ? 'Adds up' : 'Does not add up') : '—'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== row.key) : prev))}
                        aria-label={`Remove row ${index + 1}`}
                        disabled={rows.length === 1}
                        className="rounded p-1 text-muted hover:text-destructive disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border text-xs font-medium text-foreground/70">
                <td className="px-2 py-2" colSpan={2}>
                  Totals
                </td>
                {COLUMNS.map((c) => (
                  <td key={c} className="px-2 py-2 text-right tabular-nums">
                    {formatCents(totals[c])}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <Button type="button" variant="ghost" size="sm" onClick={() => setRows((prev) => [...prev, emptyRow()])}>
          <Plus className="h-4 w-4" />
          Add a period
        </Button>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
