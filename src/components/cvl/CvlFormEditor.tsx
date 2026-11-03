'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Check, Eye, PenLine, Plus, Printer, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SourceButton } from '@/components/ui/SourcedAmount'
import { aud, type AmountSource } from '@/lib/sources'
import { formatDate } from '@/lib/utils'
import type { FieldValue, TableRow } from '@/lib/forms/types'
import type { EntryField, EntryMap, EntryTable } from '@/lib/cvl/entryMap'
import type { Candidate, Prefill } from '@/lib/cvl/prefill'
import type { EntryState } from '@/lib/cvl/drafts'
import { PLACEMENTS } from '@/lib/cvl/settings'

interface CvlFormEditorProps {
  caseId: string
  clientId: string
  map: EntryMap
  subject: string
  /** Part B: one screen per director. */
  subjects: { subject: string; label: string }[]
  prefill: Prefill
  initial: EntryState
  saved: { at: string; by: string; version: string } | null
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const blank = (v: FieldValue) => v === null || v === undefined || v === ''

/**
 * One ASIC form's entry screen, in the form's own question order and
 * numbering. Every answer can be changed; a pre-filled one carries an ⓘ
 * saying where it came from until staff change it. Every Yes/No starts at
 * "No". Answers written by hand on the printout (signatures, the dates beside
 * them, B6 log-ins, the B1 address) are shown but cannot be typed or saved.
 */
export function CvlFormEditor({ caseId, clientId, map, subject, subjects, prefill, initial, saved: savedAtOpen }: CvlFormEditorProps) {
  const router = useRouter()
  const [state, setState] = useState(initial)
  const [savedState, setSavedState] = useState(initial)
  const [saved, setSaved] = useState(savedAtOpen)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The PDF as it would print now, answers on screen included (not saved).
  const [preview, setPreview] = useState<{ url: string; warnings: string[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)

  // A preview's object URL is let go when it is replaced or closed.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url)
  }, [preview])

  async function showPreview() {
    setPreviewing(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/cvl/${caseId}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form: map.code, subject, answers: { fields: state.fields, tables: state.tables, signedBy: state.signedBy } }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not make the preview')
      }
      let warnings: string[] = []
      try {
        warnings = JSON.parse(decodeURIComponent(res.headers.get('X-Cvl-Warnings') ?? '%5B%5D'))
      } catch {
        warnings = []
      }
      setPreview({ url: URL.createObjectURL(await res.blob()), warnings })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setPreviewing(false)
    }
  }
  const dirty = !same(state, savedState)

  // A warning before leaving with changes not saved.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function markEdited(key: string, edited: boolean, next: EntryState): EntryState {
    const keys = new Set(next.editedKeys)
    if (edited) keys.add(key)
    else keys.delete(key)
    return { ...next, editedKeys: [...keys] }
  }

  function setField(key: string, value: FieldValue) {
    setState((s) => {
      const next = { ...s, fields: { ...s.fields, [key]: value } }
      const pre = prefill.fields[key]
      return markEdited(key, pre ? !same(pre.value, value) : !blank(value), next)
    })
  }

  function setTable(id: string, rows: TableRow[]) {
    setState((s) => markEdited(`table:${id}`, true, { ...s, tables: { ...s.tables, [id]: rows } }))
  }

  function setSignedBy(value: string) {
    setState((s) => markEdited('signedBy', !same(prefill.signedBy?.value ?? null, value || null), { ...s, signedBy: value || null }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/cvl/${caseId}/forms/${map.code}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          answers: { fields: state.fields, tables: state.tables, signedBy: state.signedBy },
          editedKeys: state.editedKeys,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save the draft')
      setSavedState(state)
      setSaved({ at: data.updatedAt, by: data.updatedBy, version: data.formVersion })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    if (!window.confirm('Go back to the pre-filled answers? Everything typed on this form is cleared.')) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/cvl/${caseId}/forms/${map.code}?subject=${encodeURIComponent(subject)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to reset the draft')
      router.refresh()
      setSaved(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const sourceOf = (key: string): AmountSource | null => {
    const pre = prefill.fields[key]
    return pre && !state.editedKeys.includes(key) && same(pre.value, state.fields[key]) ? pre.source : null
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Link href={`/cvl/${clientId}`} className="mb-4 inline-flex items-center gap-1.5 text-xs text-foreground/40 transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to the CVL file
      </Link>

      <div className="sticky top-0 z-10 -mx-4 mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-border bg-primary/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{map.title}</h1>
          <p className="text-xs text-foreground/50">
            ASIC version {map.version}
            {saved ? ` · draft saved ${formatDate(saved.at)} by ${saved.by}` : ' · not saved yet'}
            {saved && saved.version !== map.version ? ` · written against version ${saved.version}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {subjects.length > 1 && (
            <nav className="flex flex-wrap gap-1" aria-label="Director">
              {subjects.map((s) => (
                <Link
                  key={s.subject}
                  href={`/cvl/${clientId}/forms/${map.code}?subject=${encodeURIComponent(s.subject)}`}
                  aria-current={s.subject === subject ? 'page' : undefined}
                  className={`rounded-lg px-2.5 py-1 text-xs ${s.subject === subject ? 'bg-accent/10 font-medium text-foreground' : 'text-foreground/50 hover:text-foreground'}`}
                >
                  {s.label}
                </Link>
              ))}
            </nav>
          )}
          <Link
            href={`/cvl/${clientId}/print`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs text-muted hover:text-foreground"
          >
            <Printer className="h-3.5 w-3.5" />
            Print page
          </Link>
          <Button type="button" size="sm" variant="accent" onClick={showPreview} loading={previewing} disabled={saving}>
            <Eye className="h-3.5 w-3.5" />
            Preview
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={saving}>
            <RotateCcw className="h-3.5 w-3.5" />
            Back to pre-filled
          </Button>
          <Button type="button" size="sm" onClick={save} loading={saving} disabled={!dirty}>
            {dirty ? 'Save draft' : (
              <>
                <Check className="h-3.5 w-3.5" /> Saved
              </>
            )}
          </Button>
        </div>
        {error && <p className="w-full text-xs text-destructive">{error}</p>}
      </div>

      {preview && (
        <section className="mb-6 rounded-xl border border-border bg-card p-3" aria-label="Preview">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-foreground/60">
              As it would print now, with the answers on screen{dirty ? ' (not saved yet)' : ''}. Fill in any blank box above, then preview again.
            </p>
            <button type="button" onClick={() => setPreview(null)} className="inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground">
              <X className="h-3.5 w-3.5" /> Close preview
            </button>
          </div>
          {preview.warnings.length > 0 && (
            <ul className="mb-2 space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs text-foreground/80">
              {preview.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
                  {w}
                </li>
              ))}
            </ul>
          )}
          <iframe title={`Preview of ${map.title}`} src={preview.url} className="h-[80vh] w-full rounded-lg border border-border bg-white" />
        </section>
      )}

      {prefill.warnings.length > 0 && (
        <ul className="mb-6 space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-foreground/80">
          {prefill.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      )}

      <div className={prefill.candidates.length ? 'grid gap-6 lg:grid-cols-[1fr_300px]' : ''}>
        <div className="space-y-6">
          {map.hasTables && (
            <section className="rounded-xl border border-border bg-card p-4">
              <label htmlFor="signed-by" className="text-xs font-medium text-muted">
                Name on the appendix tables (&ldquo;signed by&rdquo;)
              </label>
              <div className="mt-1.5 flex items-center gap-1">
                <input
                  id="signed-by"
                  value={state.signedBy ?? ''}
                  onChange={(e) => setSignedBy(e.target.value)}
                  className="h-9 w-full max-w-sm rounded-lg border border-border bg-input-bg px-3 text-sm text-foreground focus:border-accent focus:outline-none"
                />
                {prefill.signedBy && !state.editedKeys.includes('signedBy') && <SourceButton source={prefill.signedBy.source} label="Name on the tables" />}
              </div>
              <p className="mt-1 text-xs text-foreground/40">The &ldquo;and dated&rdquo; beside it is dated by hand on the day.</p>
            </section>
          )}

          {map.sections.map((s) => (
            <section key={s.q} className="rounded-xl border border-border bg-card p-4" aria-labelledby={`q-${s.q}`}>
              <h2 id={`q-${s.q}`} className="mb-3 text-sm font-semibold text-foreground">
                <span className="mr-2 text-accent">{s.q}</span>{' '}
                {s.text}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {s.fields.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={state.fields[f.key]}
                    source={sourceOf(f.key)}
                    note={prefill.notes[f.key] ?? null}
                    onChange={(v) => setField(f.key, v)}
                  />
                ))}
              </div>
              {s.tables.map((t) => (
                <TableInput
                  key={t.id}
                  table={t}
                  rows={state.tables[t.id] ?? []}
                  sources={state.editedKeys.includes(`table:${t.id}`) ? [] : (prefill.tables[t.id] ?? []).map((r) => r.source)}
                  onChange={(rows) => setTable(t.id, rows)}
                />
              ))}
            </section>
          ))}
        </div>

        {prefill.candidates.length > 0 && <Candidates candidates={prefill.candidates} />}
      </div>
    </div>
  )
}

/* ---------------- one answer ---------------- */

const inputClass =
  'w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50'

function FieldInput({
  field: f,
  value,
  source,
  note,
  onChange,
}: {
  field: EntryField
  value: FieldValue
  source: AmountSource | null
  note: string | null
  onChange: (v: FieldValue) => void
}) {
  const id = `f-${f.key}`
  const wide = f.type === 'lines' || f.type === 'choice' || f.label.length > 60
  const info = source ? <SourceButton source={source} label={f.label} /> : null

  if (f.handwritten) {
    return (
      <div className={wide ? 'sm:col-span-2' : ''}>
        <p className="mb-1.5 text-xs font-medium text-muted">{f.label}</p>
        <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-foreground/50">
          <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
          Written by hand on the printout. Not typed or saved here.
        </p>
      </div>
    )
  }

  let control: React.ReactNode
  if (f.type === 'yesno') {
    control = (
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex gap-4 pt-1 text-sm">
        {(['yes', 'no'] as const).map((v) => (
          <label key={v} className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" name={id} checked={String(value ?? 'no').toLowerCase() === v} onChange={() => onChange(v)} className="accent-accent" />
            {v === 'yes' ? 'Yes' : 'No'}
          </label>
        ))}
        {info}
      </div>
    )
  } else if (f.type === 'choice') {
    control = (
      <div className="flex items-center gap-1">
        <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} className={inputClass}>
          <option value="">—</option>
          {f.options!.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        {info}
      </div>
    )
  } else if (f.type === 'lines') {
    control = (
      <div className="flex items-start gap-1">
        <textarea id={id} rows={Math.min(8, Math.max(2, f.lines ?? 3))} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputClass} />
        {info}
      </div>
    )
  } else {
    const type = f.type === 'date' ? 'date' : 'text'
    control = (
      <div className="flex items-center gap-1">
        <input
          id={id}
          type={type}
          inputMode={f.type === 'money' ? 'decimal' : undefined}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value
            if (f.type === 'money') {
              const n = Number(raw.replace(/[$,\s]/g, ''))
              onChange(raw.trim() === '' ? null : Number.isFinite(n) && /^-?[\d,.\s$]+$/.test(raw) ? n : raw)
            } else onChange(raw === '' ? null : raw)
          }}
          className={`${inputClass} ${f.type === 'money' ? 'text-right tabular-nums' : ''}`}
        />
        {info}
      </div>
    )
  }

  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      {f.type === 'yesno' ? (
        <p id={`${id}-label`} className="text-xs font-medium text-muted">
          {f.label}
        </p>
      ) : (
        <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">
          {f.label}
        </label>
      )}
      {control}
      {note && <p className="mt-1 text-xs text-warning">{note}</p>}
    </div>
  )
}

/* ---------------- appendix tables ---------------- */

function TableInput({ table, rows, sources, onChange }: { table: EntryTable; rows: TableRow[]; sources: AmountSource[]; onChange: (rows: TableRow[]) => void }) {
  const set = (i: number, key: string, v: FieldValue) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)))
  const pages = Math.max(1, Math.ceil(rows.length / table.rowsPerPage))
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium text-foreground/70">
        Table {table.id.replace('_', ' ')}: {table.title}
        <span className="ml-2 font-normal text-foreground/40">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'}, {table.rowsPerPage} a page
          {pages > 1 ? ` · printed on ${pages} pages` : ''}
        </span>
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/8 bg-surface/60 text-left text-foreground/50">
              {table.columns.map((c) => (
                <th key={c.key} className="px-2 py-2 font-medium">
                  {c.label}
                </th>
              ))}
              <th className="w-16 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-white/8 last:border-0">
                {table.columns.map((c) => (
                  <td key={c.key} className="px-1 py-1">
                    {c.type === 'check' ? (
                      <input
                        type="checkbox"
                        aria-label={`${c.label}, row ${i + 1}`}
                        checked={r[c.key] === true || r[c.key] === 'yes'}
                        onChange={(e) => set(i, c.key, e.target.checked)}
                        className="accent-accent"
                      />
                    ) : (
                      <input
                        aria-label={`${c.label}, row ${i + 1}`}
                        type={c.type === 'date' ? 'date' : 'text'}
                        inputMode={c.type === 'money' ? 'decimal' : undefined}
                        value={r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key])}
                        onChange={(e) => {
                          const raw = e.target.value
                          const n = Number(raw.replace(/[$,\s]/g, ''))
                          set(i, c.key, raw === '' ? null : c.type === 'money' && Number.isFinite(n) ? n : raw)
                        }}
                        className={`w-full min-w-[90px] rounded border border-border bg-input-bg px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none ${c.type === 'money' ? 'text-right tabular-nums' : ''}`}
                      />
                    )}
                  </td>
                ))}
                <td className="px-1 py-1">
                  <span className="flex items-center gap-1">
                    {sources[i] && <SourceButton source={sources[i]} label={`Row ${i + 1}`} />}
                    <button
                      type="button"
                      aria-label={`Remove row ${i + 1}`}
                      onClick={() => onChange(rows.filter((_, j) => j !== i))}
                      className="rounded p-1 text-foreground/40 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => onChange([...rows, {}])} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
        <Plus className="h-3.5 w-3.5" />
        Add a row
      </button>
    </div>
  )
}

/* ---------------- Form 509 candidates ---------------- */

function Candidates({ candidates }: { candidates: Candidate[] }) {
  return (
    <aside className="h-fit space-y-3 rounded-xl border border-border bg-card p-4 lg:sticky lg:top-24">
      <h2 className="text-sm font-semibold text-foreground">Amounts not placed on the form</h2>
      <p className="text-xs text-foreground/50">Where each goes on Form 509 is to be confirmed (CVL settings).</p>
      <ul className="space-y-3 text-xs">
        {candidates.map((c) => {
          const placement = c.target ? (PLACEMENTS[c.key].options as Record<string, string>)[c.target] : null
          return (
            <li key={c.key} className="rounded-lg border border-border/60 p-2.5">
              <p className="font-medium text-foreground/80">{c.label}</p>
              <p className="mt-0.5 flex items-center gap-1 tabular-nums text-foreground">
                {aud(c.amount)}
                <SourceButton source={c.source} label={c.label} />
              </p>
              <p className="mt-1 text-foreground/50">
                {placement ? `Placed in ${placement}${c.confirmed ? '' : ' — pending confirmation'}` : 'Not placed yet — pending confirmation'}
              </p>
            </li>
          )
        })}
      </ul>
      <Link href="/cvl/settings" className="inline-block text-xs font-medium text-accent hover:underline">
        Open CVL settings
      </Link>
    </aside>
  )
}
