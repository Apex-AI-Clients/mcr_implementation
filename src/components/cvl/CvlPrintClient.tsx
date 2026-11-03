'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Download, Eye, FileCheck2, Pencil, Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'

export interface PrintJob {
  code: string
  subject: string
  label: string
  pages: number
  fromDraft: boolean
  warnings: string[]
}

export interface SavedDocument {
  id: string
  label: string
  versions: string
  warnings: number
  generatedAt: string
  generatedBy: string
}

interface CvlPrintClientProps {
  caseId: string
  clientId: string
  jobs: PrintJob[]
  saved: SavedDocument[]
  open: boolean
}

/**
 * Preview, print and save: each form as it will print, with what to check
 * first; a preview of one form or all of them (never saved); and "Save for
 * printing", which keeps the PDF on the file with who made it and when.
 */
export function CvlPrintClient({ caseId, clientId, jobs, saved, open }: CvlPrintClientProps) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const preview = (form: string, subject?: string) =>
    `/api/admin/cvl/${caseId}/preview?form=${form}${subject ? `&subject=${encodeURIComponent(subject)}` : ''}`
  const totalWarnings = jobs.reduce((s, j) => s + j.warnings.length, 0)

  async function generate(form: string, subject?: string) {
    const key = `${form}:${subject ?? ''}`
    setBusy(key)
    setError(null)
    try {
      const res = await fetch(`/api/admin/cvl/${caseId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, ...(subject ? { subject } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not generate the forms')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">All forms</h2>
            <p className="text-xs text-foreground/50">
              {jobs.length} forms, {jobs.reduce((s, j) => s + j.pages, 0)} pages
              {totalWarnings ? ` · ${totalWarnings} things to check first` : ' · nothing to check'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={preview('all')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-primary">
              <Eye className="h-3.5 w-3.5" /> Preview all
            </a>
            {open && (
              <Button type="button" size="sm" onClick={() => generate('all')} loading={busy === 'all:'} disabled={busy !== null}>
                <Printer className="h-3.5 w-3.5" /> Save all for printing
              </Button>
            )}
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </section>

      <ul className="space-y-3">
        {jobs.map((j) => (
          <li key={`${j.code}-${j.subject}`} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{j.label}</p>
                <p className="text-xs text-foreground/50">
                  {j.pages} {j.pages === 1 ? 'page' : 'pages'} · {j.fromDraft ? 'from the saved draft' : 'from the pre-filled answers (not opened yet)'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/cvl/${clientId}/forms/${j.code}?subject=${encodeURIComponent(j.subject)}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-primary"
                >
                  <Pencil className="h-3.5 w-3.5" /> Fill in
                </Link>
                <a href={preview(j.code, j.subject)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-primary">
                  <Eye className="h-3.5 w-3.5" /> Preview
                </a>
                {open && (
                  <Button type="button" size="sm" variant="accent" onClick={() => generate(j.code, j.subject)} loading={busy === `${j.code}:${j.subject}`} disabled={busy !== null}>
                    Save for printing
                  </Button>
                )}
              </div>
            </div>
            {j.warnings.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs text-foreground/80">
                {j.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Saved for printing</h2>
        {saved.length === 0 ? (
          <p className="text-xs text-foreground/50">Nothing saved yet.</p>
        ) : (
          <ul className="divide-y divide-white/5 text-xs">
            {saved.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2">
                  <FileCheck2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                  <span>
                    <span className="font-medium text-foreground">{d.label}</span>
                    <span className="block text-foreground/50">
                      {formatDate(d.generatedAt)} by {d.generatedBy} · ASIC version {d.versions}
                      {d.warnings ? ` · ${d.warnings} to check` : ''}
                    </span>
                  </span>
                </span>
                <span className="flex gap-3">
                  <a href={`/api/admin/cvl/${caseId}/documents/${d.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    <Eye className="h-3.5 w-3.5" /> Open
                  </a>
                  <a href={`/api/admin/cvl/${caseId}/documents/${d.id}?download=1`} className="inline-flex items-center gap-1 text-accent hover:underline">
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
