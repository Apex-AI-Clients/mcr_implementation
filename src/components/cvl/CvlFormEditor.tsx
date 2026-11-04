'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Download, Loader2, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react'
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
 * One ASIC form's entry screen: the questions on the left, in the form's own
 * order and numbering, and on the right the official page as it will print,
 * filled again a moment after each change and turned to the page being
 * edited.
 *
 * Every answer can be changed; a pre-filled one carries an ⓘ saying where it
 * came from until staff change it. Every Yes/No starts at "No". Answers
 * written by hand on the printout (signatures, the dates beside them, B6
 * log-ins, the B1 address) are shown but cannot be typed or saved.
 */
export function CvlFormEditor({ caseId, clientId, map, subject, subjects, prefill, initial, saved: savedAtOpen }: CvlFormEditorProps) {
  const router = useRouter()
  const [state, setState] = useState(initial)
  const [savedState, setSavedState] = useState(initial)
  const [saved, setSaved] = useState(savedAtOpen)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The template page being edited: the preview turns to it.
  const [editingPage, setEditingPage] = useState<number | null>(null)
  const dirty = !same(state, savedState)
  const answersOf = (st: EntryState) => JSON.stringify({ fields: st.fields, tables: st.tables, signedBy: st.signedBy })
  // What the preview shows: filled on opening, and again on Save (never while typing).
  const [previewRequest, setPreviewRequest] = useState(() => ({ answers: answersOf(initial), n: 0 }))
  const stale = answersOf(state) !== previewRequest.answers
  const refreshPreview = () => setPreviewRequest((r) => ({ answers: answersOf(state), n: r.n + 1 }))

  // Ctrl+S / Cmd+S saves (and updates the preview), as in a document editor.
  const saveRef = useRef<() => void>(() => {})
  saveRef.current = () => {
    if (!saving) void save()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      refreshPreview()
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

  // The page of whatever is focused on the left, for the preview.
  function onFocusIn(e: React.FocusEvent<HTMLDivElement>) {
    const holder = (e.target as HTMLElement).closest('[data-page]') as HTMLElement | null
    if (holder?.dataset.page) setEditingPage(Number(holder.dataset.page))
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6">
      <Link href={`/cvl/${clientId}`} className="mb-3 inline-flex items-center gap-1.5 text-xs text-foreground/40 transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to the CVL file
      </Link>

      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-foreground/40">ASIC · version {map.version}</p>
          <h1 className="text-xl font-semibold text-foreground">{map.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/cvl/${clientId}/print`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs text-muted hover:text-foreground"
          >
            <Printer className="h-3.5 w-3.5" />
            Print page
          </Link>
          <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={saving}>
            <RotateCcw className="h-3.5 w-3.5" />
            Back to pre-filled
          </Button>
          <Button type="button" size="sm" onClick={save} loading={saving} disabled={!dirty && !stale} title="Save the draft and update the preview (Ctrl+S)">
            {dirty || stale ? (
              'Save'
            ) : (
              <>
                <Check className="h-3.5 w-3.5" /> Saved
              </>
            )}
          </Button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {subjects.length > 1 &&
          subjects.map((s) => (
            <Link
              key={s.subject}
              href={`/cvl/${clientId}/forms/${map.code}?subject=${encodeURIComponent(s.subject)}`}
              aria-current={s.subject === subject ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 ${s.subject === subject ? 'border-accent bg-accent/10 font-medium text-foreground' : 'border-border text-foreground/50 hover:text-foreground'}`}
            >
              {s.label}
            </Link>
          ))}
        <span className={`rounded-full px-3 py-1 ${dirty ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>
          {dirty ? 'Changes not saved' : saved ? `Draft saved ${formatDate(saved.at)} by ${saved.by}` : 'Pre-filled, not saved yet'}
        </span>
        {saved && saved.version !== map.version && (
          <span className="rounded-full bg-warning/15 px-3 py-1 text-warning">Written against version {saved.version}</span>
        )}
        {error && <span className="text-destructive">{error}</span>}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* The questions */}
        <div className="min-w-0 space-y-3" onFocus={onFocusIn}>
          <nav aria-label="Questions" className="flex flex-wrap gap-1">
            {map.sections.map((s) => (
              <a
                key={s.q}
                href={`#q-${s.q}`}
                className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-foreground/50 hover:border-accent hover:text-accent"
              >
                {s.q.length > 6 ? s.q.split(' ').map((w) => w[0]).join('') : s.q}
              </a>
            ))}
          </nav>

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
            <section key={s.q} className="scroll-mt-4 rounded-xl border border-border bg-card p-4" aria-labelledby={`q-${s.q}`}>
              <h2 id={`q-${s.q}`} className="mb-3 flex items-baseline gap-2.5 text-sm font-medium text-foreground">
                <span className="min-w-[2.6em] font-mono font-semibold text-accent">{s.q}</span>{' '}
                <span className="flex-1">{s.text}</span>
              </h2>
              {s.fields.some((f) => f.column) && (
                <ColumnsTable
                  fields={s.fields.filter((f) => f.column || f.inline)}
                  values={state.fields}
                  sourceOf={sourceOf}
                  notes={prefill.notes}
                  onChange={setField}
                />
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {s.fields
                  .filter((f) => !f.column && !f.inline)
                  .map((f) => (
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

        {/* The official page, as it will print */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <LivePreview
            caseId={caseId}
            code={map.code}
            subject={subject}
            request={previewRequest}
            stale={stale}
            onRefresh={refreshPreview}
            editingPage={editingPage}
            title={map.title}
            fileName={`${map.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}${subject === 'company' ? '' : `-${(subjects.find((x) => x.subject === subject)?.label ?? subject).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`}.pdf`}
          />
          {prefill.candidates.length > 0 && <Candidates candidates={prefill.candidates} />}
        </div>
      </div>
    </div>
  )
}

/* ---------------- the live preview ---------------- */

interface Filled {
  pdf: Uint8Array
  /** Template page of each output page. */
  pageSources: number[]
}

/** pdf.js's parsed document and its loading task (unpdf's build), as used here. */
type PdfTask = ReturnType<typeof import('unpdf/pdfjs').getDocument>
type PdfDoc = Awaited<PdfTask['promise']>

/**
 * The form as it will print, filled on the server when asked (on opening,
 * on Save, before a download) and drawn here page by page; never while
 * typing. Turns to the page of whatever is being edited, and says when the
 * answers on screen have changed since.
 */
function LivePreview({
  caseId,
  code,
  subject,
  request,
  stale,
  onRefresh,
  editingPage,
  title,
  fileName,
}: {
  caseId: string
  code: string
  subject: string
  /** The answers to fill, and a counter that changes each time a new preview is asked for. */
  request: { answers: string; n: number }
  /** The answers on screen differ from the ones previewed. */
  stale: boolean
  /** Ask for a preview of the answers on screen (without saving). */
  onRefresh: () => void
  editingPage: number | null
  title: string
  fileName: string
}) {
  const [filled, setFilled] = useState<Filled | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [pendingDownload, setPendingDownload] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const latest = useRef(0)

  // Fill once per request (on opening, on Save, before a download): never while typing.
  useEffect(() => {
    const id = ++latest.current
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/cvl/${caseId}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form: code, subject, answers: JSON.parse(request.answers) }),
        })
        if (!res.ok) throw new Error('The preview could not be filled.')
        const pdf = new Uint8Array(await res.arrayBuffer())
        let pageSources: number[] = []
        try {
          pageSources = JSON.parse(res.headers.get('X-Cvl-Pages') ?? '[]')
        } catch {
          // The PDF still shows; it just cannot turn to the page being edited.
        }
        if (cancelled || id !== latest.current) return
        setFilled({ pdf, pageSources })
        setError(null)
      } catch (err) {
        if (!cancelled && id === latest.current) setError(err instanceof Error ? err.message : 'The preview could not be filled.')
      } finally {
        if (!cancelled && id === latest.current) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [caseId, code, subject, request])

  // Parse each preview once; every page tab draws from the same parsed copy.
  // The previous copy is let go when a new one arrives, and on leaving.
  useEffect(() => {
    if (!filled) return
    let task: PdfTask | null = null
    let cancelled = false
    void (async () => {
      try {
        // pdf.js itself (unpdf's browser-ready build), loaded only when a preview is drawn.
        const { getDocument } = await import('unpdf/pdfjs')
        task = getDocument({ data: filled.pdf.slice(), useSystemFonts: true })
        const parsed = await task.promise
        if (!cancelled) setDoc(parsed)
      } catch {
        if (!cancelled) setError('The preview could not be drawn. Download the PDF instead.')
      }
    })()
    return () => {
      cancelled = true
      setDoc(null)
      void task?.destroy()
    }
  }, [filled])

  const pages = filled ? Math.max(1, filled.pageSources.length) : 0

  // Turn to the page of the field being edited.
  useEffect(() => {
    if (!filled || editingPage === null) return
    const at = filled.pageSources.indexOf(editingPage)
    if (at >= 0) setPage(at + 1)
  }, [editingPage, filled])

  const shown = Math.min(page, pages || 1)

  // Draw the page shown, from the parsed copy.
  useEffect(() => {
    if (!doc || !canvas.current) return
    let cancelled = false
    void (async () => {
      try {
        const pdfPage = await doc.getPage(Math.min(shown, doc.numPages))
        const scale = Math.min(2, (window.devicePixelRatio || 1) * 1.25)
        const viewport = pdfPage.getViewport({ scale })
        const target = canvas.current
        if (cancelled || !target) return
        target.width = viewport.width
        target.height = viewport.height
        const ctx = target.getContext('2d')
        if (!ctx) return
        await pdfPage.render({ canvas: target, canvasContext: ctx, viewport } as Parameters<typeof pdfPage.render>[0]).promise
        pdfPage.cleanup()
      } catch {
        if (!cancelled) setError('The preview could not be drawn. Download the PDF instead.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, shown])

  // Save the PDF of the answers on screen: filled again first when they have changed.
  const saveFile = useCallback(() => {
    if (!filled) return
    const url = URL.createObjectURL(new Blob([filled.pdf.slice()], { type: 'application/pdf' }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [filled, fileName])

  function download() {
    if (stale) {
      setPendingDownload(true)
      onRefresh()
    } else saveFile()
  }

  useEffect(() => {
    if (!pendingDownload || loading || stale || !filled) return
    setPendingDownload(false)
    saveFile()
  }, [pendingDownload, loading, stale, filled, saveFile])

  return (
    <section aria-label={`Preview of ${title}`} className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="mr-1 text-foreground/50">Page</span>
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPage(n)}
            aria-current={n === shown ? 'page' : undefined}
            className={`min-w-[2em] rounded border px-1.5 py-0.5 font-mono tabular-nums ${n === shown ? 'border-accent bg-accent text-white' : 'border-border bg-card text-foreground/60 hover:border-accent'}`}
          >
            {n}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {loading ? (
            <span className="inline-flex items-center gap-1 text-foreground/40">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Updating
            </span>
          ) : (
            stale && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">Preview not updated: save to see your changes</span>
          )}
          <button
            type="button"
            onClick={download}
            disabled={!filled || pendingDownload}
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-foreground/70 hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <Download className="h-3 w-3" aria-hidden="true" /> Download
          </button>
        </span>
      </div>
      <div className="overflow-hidden rounded-sm bg-white shadow-[0_1px_2px_rgba(20,30,50,.12),0_6px_20px_rgba(20,30,50,.08)]">
        {filled ? (
          <canvas ref={canvas} className="block h-auto w-full" aria-label={`Page ${shown} of ${pages}`} />
        ) : (
          <div className="flex aspect-[1/1.414] items-center justify-center text-xs text-neutral-500">
            {error ?? 'Filling the form…'}
          </div>
        )}
      </div>
      {filled && error && <p className="text-xs text-destructive">{error}</p>}
    </section>
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

  // Written by hand on the printout (signature dates, B6 log-ins, B1 address): not on this screen.
  if (f.handwritten) return null

  let control: React.ReactNode
  if (f.type === 'yesno') {
    control = (
      <div className="flex items-center gap-1">
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="inline-flex overflow-hidden rounded-md border border-border text-xs">
          {(['yes', 'no'] as const).map((v) => {
            const on = String(value ?? 'no').toLowerCase() === v
            return (
              <label
                key={v}
                className={`cursor-pointer px-3.5 py-1.5 transition-colors focus-within:ring-2 focus-within:ring-accent/40 ${v === 'no' ? 'border-l border-border' : ''} ${on ? 'bg-accent font-medium text-white' : 'bg-input-bg text-foreground/60 hover:text-foreground'}`}
              >
                <input type="radio" name={id} checked={on} onChange={() => onChange(v)} className="sr-only" />
                {v === 'yes' ? 'Yes' : 'No'}
              </label>
            )
          })}
        </div>
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
          className={`${inputClass} ${f.type === 'money' ? 'tabular-nums' : ''}`}
        />
        {info}
      </div>
    )
  }

  return (
    <div className={f.type === 'yesno' ? 'sm:col-span-2' : wide ? 'sm:col-span-2' : ''} data-page={f.page}>
      {f.type === 'yesno' ? (
        <p id={`${id}-label`} className="mb-1.5 text-sm text-foreground/80">
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

/* ---------------- Form 509's two columns ---------------- */

/** Typed amount → stored value: a number when it reads as one, else the text as typed. */
function moneyValue(raw: string): FieldValue {
  const n = Number(raw.replace(/[$,\s]/g, ''))
  return raw.trim() === '' ? null : Number.isFinite(n) && /^-?[\d,.\s$]+$/.test(raw) ? n : raw
}

/**
 * Form 509's summary of assets and liabilities as it is printed: one row per
 * line of the form, its amount boxes under "Valuation" and "Estimated
 * realisable value". A row has a box only in the column the form prints one
 * in: the liabilities, and TOTAL estimated realisable values, in the second
 * column only; TOTAL assets in the first only.
 */
function ColumnsTable({
  fields,
  values,
  sourceOf,
  notes,
  onChange,
}: {
  fields: EntryField[]
  values: Record<string, FieldValue>
  sourceOf: (key: string) => AmountSource | null
  notes: Record<string, string>
  onChange: (key: string, v: FieldValue) => void
}) {
  const rows: { label: string; page: number; valuation?: EntryField; erv?: EntryField; inline?: EntryField }[] = []
  for (const f of fields.filter((x) => x.column)) {
    let row = rows.find((r) => r.label === f.row)
    if (!row) {
      row = { label: f.row ?? f.label, page: f.page }
      rows.push(row)
    }
    row[f.column!] = f
  }
  for (const f of fields.filter((x) => x.inline)) {
    const row = rows.find((r) => r.label === f.row)
    if (row) row.inline = f
  }
  const cell = (f: EntryField | undefined) => {
    if (!f) return <span className="block px-2 text-xs text-foreground/25" aria-hidden="true">—</span>
    const source = sourceOf(f.key)
    const value = values[f.key]
    return (
      <div data-page={f.page}>
        <div className="flex items-center gap-1">
          <input
            id={`f-${f.key}`}
            aria-label={f.label}
            inputMode="decimal"
            value={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => onChange(f.key, moneyValue(e.target.value))}
            className={`${inputClass} py-1.5 tabular-nums`}
          />
          {source && <SourceButton source={source} label={f.label} />}
        </div>
        {notes[f.key] && <p className="mt-1 text-xs text-warning">{notes[f.key]}</p>}
      </div>
    )
  }
  return (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-foreground/50">
            <th className="pb-2 pr-3 font-medium" />
            <th className="w-[34%] pb-2 pr-2 font-medium">Valuation</th>
            <th className="w-[34%] pb-2 font-medium">Estimated realisable value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-white/5">
              <td className="py-1.5 pr-3 text-xs text-foreground/80">
                {r.label}
                {r.inline && (
                  <span className="mt-1 flex items-center gap-1.5" data-page={r.inline.page}>
                    <label htmlFor={`f-${r.inline.key}`} className="shrink-0 text-foreground/50">
                      to:
                    </label>
                    <input
                      id={`f-${r.inline.key}`}
                      aria-label={r.inline.label}
                      placeholder="Who holds the debenture or charge"
                      value={values[r.inline.key] === null || values[r.inline.key] === undefined ? '' : String(values[r.inline.key])}
                      onChange={(e) => onChange(r.inline!.key, e.target.value === '' ? null : e.target.value)}
                      className={`${inputClass} py-1 text-xs`}
                    />
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-2">{cell(r.valuation)}</td>
              <td className="py-1.5">{cell(r.erv)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- appendix tables ---------------- */

function TableInput({ table, rows, sources, onChange }: { table: EntryTable; rows: TableRow[]; sources: AmountSource[]; onChange: (rows: TableRow[]) => void }) {
  const set = (i: number, key: string, v: FieldValue) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)))
  const pages = Math.max(1, Math.ceil(rows.length / table.rowsPerPage))
  return (
    <div className="mt-4" data-page={table.page}>
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
                        className={`w-full min-w-[90px] rounded border border-border bg-input-bg px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none ${c.type === 'money' ? 'tabular-nums' : ''}`}
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
    <aside className="h-fit space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Amounts to place on the form</h2>
      <p className="text-xs text-foreground/50">From the client file. Type each one that belongs into its box on the left.</p>
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
                {placement ? `Placed in ${placement}` : 'Not on the form yet'}
              </p>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
