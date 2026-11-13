'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Download, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SourceButton } from '@/components/ui/SourcedAmount'
import type { AmountSource } from '@/lib/sources'
import { formatDate } from '@/lib/utils'
import type { FieldValue, FormCode, TableRow } from '@/lib/forms/types'
import { overflowOf, type Room } from '@/lib/forms/fit'
import { choiceValue, choiceValues } from '@/lib/forms/choice'
import type { EntryField, EntryMap, EntryTable } from '@/lib/cvl/entryMap'
import type { Prefill } from '@/lib/cvl/prefill'
import type { EntryState } from '@/lib/cvl/drafts'

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
  const [spot, setSpot] = useState<Spot | null>(null)
  const dirty = !same(state, savedState)
  const answersOf = (st: EntryState) => JSON.stringify({ fields: st.fields, tables: st.tables, signedBy: st.signedBy })
  // What the preview shows: filled on opening, and again on Save (never while typing).
  const [previewRequest, setPreviewRequest] = useState(() => ({ answers: answersOf(initial), n: 0 }))
  const onScreen = answersOf(state)
  const stale = onScreen !== previewRequest.answers
  const refreshPreview = () => setPreviewRequest((r) => ({ answers: answersOf(state), n: r.n + 1 }))
  // The preview follows typing: filled again (in the browser) once the
  // answers have stopped changing for a moment, not on every keystroke.
  useEffect(() => {
    if (onScreen === previewRequest.answers) return
    const timer = setTimeout(() => setPreviewRequest((r) => ({ answers: onScreen, n: r.n + 1 })), PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [onScreen, previewRequest.answers])
  // Each press of Download in the header; the preview saves its PDF as a file.
  const [downloadTick, setDownloadTick] = useState(0)

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
    const focused = e.target as HTMLElement
    restoreFrames(focused)
    // Again once the browser has finished bringing it into view.
    requestAnimationFrame(() => restoreFrames(focused))
    const holder = (e.target as HTMLElement).closest('[data-page]') as HTMLElement | null
    if (holder?.dataset.page) setSpot({ page: Number(holder.dataset.page), top: Number(holder.dataset.top ?? 0) })
  }

  // Scrolling the questions: the section across the middle of the column is
  // the one whose page shows on the right. Just after a jump link, the
  // section jumped to decides (not those passed on the way), until staff next
  // scroll the questions themselves (wheel, touch or keys: never the jump's own scroll).
  const jumped = useRef(false)
  useEffect(() => {
    const release = () => {
      jumped.current = false
    }
    const opts = { passive: true } as const
    window.addEventListener('wheel', release, opts)
    window.addEventListener('touchstart', release, opts)
    window.addEventListener('keydown', release)
    return () => {
      window.removeEventListener('wheel', release)
      window.removeEventListener('touchstart', release)
      window.removeEventListener('keydown', release)
    }
  }, [])
  // The browser reports crossings
  // (IntersectionObserver), so nothing runs while scrolling within a section.
  // Which sections are across the middle is kept, not just the latest
  // crossing: a tall section already across the middle when the screen opens
  // (Part A's External Administrator box, all of page 2) never crosses again,
  // and its page was skipped once the top marker had shown page 1.
  const questions = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = questions.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const marker = root.querySelector<HTMLElement>('[data-form-top]')
    const firstSection = root.querySelector<HTMLElement>('section[data-page]')
    const across = new Set<HTMLElement>()
    let topInView = false

    const show = (el: HTMLElement | null | undefined, top?: number) => {
      if (!el?.dataset.page) return
      const next = { page: Number(el.dataset.page), top: top ?? Number(el.dataset.top ?? 0) }
      setSpot((cur) => (cur && cur.page === next.page && cur.top === next.top ? cur : next))
    }
    const topmostAcross = () => [...across].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
    // Back at the top of the questions, with nothing but the first section
    // across the middle: the first page, from its top.
    const topWins = () => topInView && [...across].every((el) => el === firstSection)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) across.add(e.target as HTMLElement)
          else across.delete(e.target as HTMLElement)
        }
        if (jumped.current) return
        if (topWins()) return show(marker, 0)
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        // Only a section leaving: whichever is still across the middle.
        show((hit?.target as HTMLElement | undefined) ?? topmostAcross())
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    root.querySelectorAll('section[data-page]').forEach((el) => observer.observe(el))

    const atTop = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1]
      if (last) topInView = last.isIntersecting
      if (jumped.current) return
      if (topWins()) show(marker, 0)
      // Scrolled away from the top: the section across the middle, even one
      // that was already there.
      else show(topmostAcross())
    })
    if (marker) atTop.observe(marker)
    return () => {
      observer.disconnect()
      atTop.disconnect()
    }
  }, [map])

  // Jump links (the question buttons, "the rows go in Table …"): the
  // questions' own column scrolls, never the app's frame. A plain #anchor
  // makes the browser scroll every box around the target, the fixed frame
  // too, which pushes the whole screen up. Opened with a #q-… address, the
  // same, once.
  const onJumpClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest('a[href^="#q-"]') as HTMLAnchorElement | null
    if (!link) return
    e.preventDefault()
    showJumped(jumpTo(decodeURIComponent(link.getAttribute('href')!.slice(1))))
  }
  // The page of the section jumped to, on the right, while the column scrolls to it.
  function showJumped(section: HTMLElement | null) {
    if (!section?.dataset.page) return
    jumped.current = true
    setSpot({ page: Number(section.dataset.page), top: Number(section.dataset.top ?? 0) })
  }
  useEffect(() => {
    if (!window.location.hash.startsWith('#q-')) return
    const id = decodeURIComponent(window.location.hash.slice(1))
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    showJumped(jumpTo(id))
  }, [])

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6" onClickCapture={onJumpClick}>
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
          <Button type="button" size="sm" variant="ghost" onClick={() => setDownloadTick((t) => t + 1)} title="Download the PDF of the answers on screen">
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
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
        <div ref={questions} className="min-w-0 space-y-3" onFocus={onFocusIn}>
          {/* Marks the top of the questions, for the preview to show the first page from its top. */}
          <div data-form-top="" data-page={sectionSpot(map.sections[0] ?? { q: '', text: '', fields: [], tables: [], page: 1, kind: 'page' }, true)['data-page'] ?? 1} aria-hidden="true" className="-mb-3 h-0" />
          <nav aria-label="Questions" className="flex flex-wrap gap-1">
            {map.sections.filter((s) => s.kind !== 'page').map((s) => (
              <a
                key={s.q}
                href={`#q-${s.q}`}
                // A question number (A3, B12) in the form's own style; a section name (Form 509) in full.
                className={`rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground/50 hover:border-accent hover:text-accent ${/^[A-Z]\d/.test(s.q) ? 'font-mono tabular-nums' : ''}`}
              >
                {s.q}
              </a>
            ))}
          </nav>


          {map.sections.map((s, i) =>
            s.kind === 'page' ? (
              <section
                key={s.q}
                aria-labelledby={`q-${s.q}`}
                className="flex items-baseline gap-2.5 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-foreground/50"
                {...sectionSpot(s, i === 0)}
              >
                <span id={`q-${s.q}`} className="font-medium text-foreground/70">
                  {s.q}
                </span>
                <span>{s.text}</span>
              </section>
            ) : (
            <section
              key={s.q}
              className="scroll-mt-4 rounded-xl border border-border bg-card p-4"
              aria-labelledby={`q-${s.q}`}
              {...sectionSpot(s, i === 0)}
            >
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
              {s.tableRefs?.map((t) => (
                <p key={t.id} className="mt-3 text-xs text-foreground/60">
                  The rows go in{' '}
                  <a href={`#q-Table ${t.id}`} className="font-medium text-accent hover:underline">
                    Table {t.id}
                  </a>{' '}
                  ({t.title}), on page {t.page} after the form.
                </p>
              ))}
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
            ),
          )}
        </div>

        {/* The official page, as it will print */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <LivePreview
            caseId={caseId}
            code={map.code}
            version={map.version}
            subject={subject}
            request={previewRequest}
            stale={stale}
            onRefresh={refreshPreview}
            downloadTick={downloadTick}
            spot={spot}
            title={map.title}
            fileName={`${map.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}${subject === 'company' ? '' : `-${(subjects.find((x) => x.subject === subject)?.label ?? subject).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`}.pdf`}
          />
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

/** How long after the last change the preview is filled again (in the browser). */
const PREVIEW_DELAY_MS = 400

/**
 * Puts back any box around this element that should never scroll (overflow
 * hidden, like the app's fixed frame) but the browser scrolled anyway, to
 * bring something into view. Moved, it pushes the whole screen up.
 */
/** A box's vertical overflow (from the shorthand where only that is set). */
function overflowYOf(el: HTMLElement): string {
  const cs = getComputedStyle(el)
  return cs.overflowY && cs.overflowY !== 'visible' ? cs.overflowY : cs.overflow || cs.overflowY
}

function restoreFrames(from: HTMLElement) {
  for (let up = from.parentElement; up; up = up.parentElement) {
    if (up.scrollTop && overflowYOf(up) === 'hidden') up.scrollTop = 0
  }
}

/**
 * Scrolls the element with this id to the top of its own scrolling column
 * (the box with overflow auto or scroll around it), and puts back any box
 * that should never scroll (overflow hidden) the browser may have moved.
 */
function jumpTo(id: string): HTMLElement | null {
  const el = document.getElementById(id)
  if (!el) return null
  let box: HTMLElement | null = el.parentElement
  while (box && !/(auto|scroll)/.test(overflowYOf(box))) box = box.parentElement
  restoreFrames(el)
  const target = (el.closest('section') as HTMLElement | null) ?? el
  if (box) {
    const y = box.scrollTop + target.getBoundingClientRect().top - box.getBoundingClientRect().top - 16
    box.scrollTo?.({ top: Math.max(0, y), behavior: 'smooth' })
  }
  return target
}

/** Where the preview remembers whole page or fit width (this browser only). */
const FIT_KEY = 'cvl.preview.fit'

/** A place on the form: a template page, and how far down it (points). */
interface Spot {
  page: number
  top: number
}

/**
 * Where a section starts on the form: its first answer or table that is on
 * screen. The form's first section shows its page from the very top, so the
 * form's heading is in view while the questions are scrolled to the top.
 */
function sectionSpot(s: EntryMap['sections'][number], first: boolean): { 'data-page'?: number; 'data-top'?: number } {
  const shown = [...s.fields.filter((f) => !f.handwritten), ...s.tables]
  const lead = shown[0]
  if (!lead) return s.page ? { 'data-page': s.page, 'data-top': 0 } : {}
  if (first) return { 'data-page': lead.page, 'data-top': 0 }
  const onLeadPage = shown.filter((x) => x.page === lead.page)
  return { 'data-page': lead.page, 'data-top': Math.min(...onLeadPage.map((x) => x.top)) }
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
  version,
  subject,
  request,
  stale,
  onRefresh,
  downloadTick,
  spot,
  title,
  fileName,
}: {
  caseId: string
  code: string
  /** The form version the answers are written against (its map and template). */
  version: string
  subject: string
  /** The answers to fill, and a counter that changes each time a new preview is asked for. */
  request: { answers: string; n: number }
  /** The answers on screen differ from the ones previewed. */
  stale: boolean
  /** Ask for a preview of the answers on screen (without saving). */
  onRefresh: () => void
  /** Changes each time Download is pressed (in the header). */
  downloadTick: number
  /** The page and place being looked at or edited on the left. */
  spot: Spot | null
  title: string
  fileName: string
}) {
  const [filled, setFilled] = useState<Filled | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [pendingDownload, setPendingDownload] = useState(false)
  // Every page, one under the other, in a column that scrolls to the last.
  const viewer = useRef<HTMLDivElement>(null)
  const pageEls = useRef<(HTMLDivElement | null)[]>([])
  // Each page's size in points (A4 until the PDF says), and the page in view.
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([])
  const [current, setCurrent] = useState(1)
  // Each page as tall as the column (the default), or as wide as it. Remembered in this browser.
  const [fit, setFit] = useState<'page' | 'width'>('page')
  useEffect(() => {
    try {
      if (window.localStorage.getItem(FIT_KEY) === 'width') setFit('width')
    } catch {
      // Storage blocked: the whole page.
    }
  }, [])
  const chooseFit = (next: 'page' | 'width') => {
    setFit(next)
    try {
      window.localStorage.setItem(FIT_KEY, next)
    } catch {
      // Not remembered: fine.
    }
  }
  const latest = useRef(0)

  // Fill once per request: on opening, a moment after typing stops, on Save,
  // before a download. In the browser (no request per change); the server
  // fills it only when that fails. The latest request wins.
  useEffect(() => {
    const id = ++latest.current
    let cancelled = false
    const answers = JSON.parse(request.answers)
    void (async () => {
      setLoading(true)
      try {
        try {
          const { fillInBrowser } = await import('@/lib/forms/browserFill')
          const fill = await fillInBrowser(code as FormCode, version, answers)
          if (cancelled || id !== latest.current) return
          setFilled({ pdf: fill.pdf, pageSources: fill.pageSources })
          setError(null)
          return
        } catch {
          // Filled on the server instead, below.
        }
        const res = await fetch(`/api/admin/cvl/${caseId}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form: code, subject, answers }),
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
  }, [caseId, code, version, subject, request])

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

  // Each page's size, once per parsed copy (cheap: no drawing). The last
  // sizes stay meanwhile, so the column never jumps while a preview is filled.
  useEffect(() => {
    if (!doc) return
    let cancelled = false
    void (async () => {
      try {
        const next: { w: number; h: number }[] = []
        for (let i = 1; i <= doc.numPages; i++) {
          const v = (await doc.getPage(i)).getViewport({ scale: 1 })
          next.push({ w: v.width, h: v.height })
        }
        if (!cancelled) setSizes(next)
      } catch {
        // A4 meanwhile.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc])

  // Scroll the column to a spot: a page, and how far down it (points).
  const filledRef = useRef(filled)
  filledRef.current = filled
  const sizesRef = useRef(sizes)
  sizesRef.current = sizes
  const scrollToPage = useCallback((index: number, top = 0) => {
    const box = viewer.current
    const el = pageEls.current[index]
    if (!box || !el) return
    const h = sizesRef.current[index]?.h ?? A4.h
    // Where the page sits in the column's scroll, measured on screen (whatever is positioned around it).
    const pageTop = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top
    const y = pageTop + (top / h) * el.clientHeight - (top ? 24 : 0)
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollTo?.({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' })
  }, [])

  // Follow the questions: the page the section looked at or edited on the
  // left starts on, shown from its top. On the page already in view, the
  // column stays still: it never scrolls within a page to chase a section.
  // Only when the section changes, never on a refill, so scrolling the
  // column by hand is not undone while typing.
  // Also once the first fill lands: the questions report their section as the
  // screen opens, before there is a page to turn to, and a tall section (Part
  // A's External Administrator box, page 2) reports nothing new while it is
  // scrolled through, so its page was never shown.
  const currentRef = useRef(current)
  currentRef.current = current
  const ready = filled !== null
  useEffect(() => {
    const f = filledRef.current
    if (!f || !spot) return
    const at = f.pageSources.indexOf(spot.page)
    if (at < 0 || at + 1 === currentRef.current) return
    setCurrent(at + 1)
    scrollToPage(at)
  }, [spot, ready, scrollToPage])

  // Stable, so a page drawing is never restarted by a re-render.
  const onPageError = useCallback(() => setError('The preview could not be drawn. Download the PDF instead.'), [])

  // The page in view, for the page buttons: the one across the top third of the column.
  const onScroll = useCallback(() => {
    const box = viewer.current
    if (!box) return
    const line = box.scrollTop + box.clientHeight / 3
    let n = 1
    pageEls.current.forEach((el, i) => {
      if (el && box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top <= line) n = i + 1
    })
    setCurrent((c) => (c === n ? c : n))
  }, [])

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

  // Download pressed: fill the answers on screen first when they have changed,
  // then save the PDF as a file once it is ready.
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh
  const staleRef = useRef(stale)
  staleRef.current = stale
  useEffect(() => {
    if (downloadTick === 0) return
    setPendingDownload(true)
    if (staleRef.current) onRefreshRef.current()
  }, [downloadTick])

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
            onClick={() => {
              setCurrent(n)
              scrollToPage(n - 1)
            }}
            aria-current={n === current ? 'page' : undefined}
            className={`min-w-[2em] rounded border px-1.5 py-0.5 font-mono tabular-nums ${n === current ? 'border-accent bg-accent text-white' : 'border-border bg-card text-foreground/60 hover:border-accent'}`}
          >
            {n}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {/* A slot of its own width, always there: the buttons beside it never move as it comes and goes. */}
          <span data-testid="preview-status" role="status" aria-live="polite" className="inline-flex w-20 items-center justify-end gap-1 text-foreground/40">
            {(loading || stale) && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Updating
              </>
            )}
          </span>
          <span role="group" aria-label="Preview size" className="inline-flex overflow-hidden rounded border border-border">
            {(
              [
                ['page', 'Whole page'],
                ['width', 'Fit width'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={fit === v}
                onClick={() => chooseFit(v)}
                className={`px-2 py-0.5 ${v === 'width' ? 'border-l border-border' : ''} ${fit === v ? 'bg-accent text-white' : 'bg-card text-foreground/60 hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </span>
        </span>
      </div>
      <div
        ref={viewer}
        data-fit={fit}
        onScroll={onScroll}
        aria-label={`${title}: every page`}
        className={`max-h-[calc(100vh-9rem)] overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          fit === 'page' ? 'snap-y snap-mandatory' : 'space-y-3 pb-2'
        }`}
      >
        {filled ? (
          Array.from({ length: pages }, (_, i) => (
            <PdfPageView
              key={i}
              doc={doc}
              index={i}
              total={pages}
              size={sizes[i] ?? A4}
              fit={fit}
              root={viewer}
              holderRef={(el) => {
                pageEls.current[i] = el
              }}
              onError={onPageError}
            />
          ))
        ) : (
          <div className="flex aspect-[1/1.414] items-center justify-center rounded-sm bg-white text-xs text-neutral-500">
            {error ?? 'Filling the form…'}
          </div>
        )}
      </div>
      {filled && error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  )
}

/** A4 in points: the size a page is laid out at until the PDF says. */
const A4 = { w: 595.28, h: 841.89 }

/**
 * One page of the preview, laid out at its own size straight away (so the
 * column scrolls true) and drawn only once it comes near the visible part of
 * the column: a 15-page Part A draws two or three pages, not fifteen, each
 * time it is filled. Drawn off screen, then copied in, so it never flashes.
 */
function PdfPageView({
  doc,
  index,
  total,
  size,
  fit,
  root,
  holderRef,
  onError,
}: {
  doc: PdfDoc | null
  index: number
  total: number
  size: { w: number; h: number }
  fit: 'page' | 'width'
  root: React.RefObject<HTMLDivElement | null>
  holderRef: (el: HTMLDivElement | null) => void
  onError: () => void
}) {
  const holder = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // With no IntersectionObserver (old browsers), every page counts as near.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = holder.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setNear(!!e?.isIntersecting), { root: root.current, rootMargin: '800px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  // Draw this page from the parsed copy: when it comes near, and again for each new copy while near.
  const drawn = useRef<PdfDoc | null>(null)
  useEffect(() => {
    if (!doc || !near || drawn.current === doc) return
    let cancelled = false
    void (async () => {
      try {
        const pdfPage = await doc.getPage(Math.min(index + 1, doc.numPages))
        const scale = Math.min(2, (window.devicePixelRatio || 1) * 1.25)
        const viewport = pdfPage.getViewport({ scale })
        const off = document.createElement('canvas')
        off.width = viewport.width
        off.height = viewport.height
        const offCtx = off.getContext('2d')
        if (!offCtx) return
        await pdfPage.render({ canvas: off, canvasContext: offCtx, viewport } as Parameters<typeof pdfPage.render>[0]).promise
        pdfPage.cleanup()
        const target = canvas.current
        if (cancelled || !target) return
        target.width = off.width
        target.height = off.height
        target.getContext('2d')?.drawImage(off, 0, 0)
        drawn.current = doc
      } catch {
        if (!cancelled) onError()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, near, index, onError])

  const ratio = size.w / size.h
  const sheet = (
    <div
      data-page-index={index + 1}
      className="relative mx-auto max-w-full overflow-hidden rounded-sm bg-white shadow-[0_1px_2px_rgba(20,30,50,.12),0_6px_20px_rgba(20,30,50,.08)]"
      style={{
        aspectRatio: `${size.w} / ${size.h}`,
        width: fit === 'width' ? '100%' : `min(100%, calc((100vh - 9rem) * ${ratio}))`,
      }}
    >
      <canvas ref={canvas} className="absolute inset-0 block h-full w-full" aria-label={`Page ${index + 1} of ${total}`} />
    </div>
  )
  const setHolder = (el: HTMLDivElement | null) => {
    holder.current = el
    holderRef(el)
  }
  // Whole page: a slot as tall as the column, so whatever the page's width
  // allows, one page fills the view and the next never peeks in.
  return fit === 'page' ? (
    <div ref={setHolder} data-page-slot={index + 1} className="flex h-[calc(100vh-9rem)] snap-start items-start justify-center">
      {sheet}
    </div>
  ) : (
    <div ref={setHolder}>{sheet}</div>
  )
}

/* ---------------- one answer ---------------- */

const inputClass =
  'w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50'
/** An answer longer than its box on the form: outlined in red. */
const tooLongClass = 'border-destructive focus:border-destructive'

/** How many characters of an answer won't print in its box (0 when it all fits, or the box has no limit). */
function overflowFor(room: Room | undefined, value: FieldValue): number {
  if (!room || value === null || value === undefined || typeof value === 'boolean') return 0
  return overflowOf(room, String(value))
}

const chars = (n: number) => `${n} ${n === 1 ? 'character' : 'characters'}`

/** The warning under an answer that won't all print. */
function TooLong({ id, over, room }: { id: string; over: number; room: Room }) {
  if (!over) return null
  const where = room.kind === 'lines' ? `the ${room.lineWs.length} lines on the form` : 'its box on the form'
  return (
    <p id={id} className="mt-1 text-xs text-destructive">
      Too long for {where}: the last {chars(over)} won’t print.
    </p>
  )
}

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

  // Measured as the form prints it: shrunk to fit first, then whatever still doesn't fit is cut.
  const over = overflowFor(f.room, value)
  const fitId = `${id}-fit`
  const fitProps = over ? { 'aria-invalid': true as const, 'aria-describedby': fitId } : {}

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
                // relative: the hidden radio inside is placed in this label. Unplaced, it
                // sits on the app's fixed frame, and focusing it (a click) scrolled the
                // frame, pushing the whole screen up.
                className={`relative cursor-pointer px-3.5 py-1.5 transition-colors focus-within:ring-2 focus-within:ring-accent/40 ${v === 'no' ? 'border-l border-border' : ''} ${on ? 'bg-accent font-medium text-white' : 'bg-input-bg text-foreground/60 hover:text-foreground'}`}
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
    // As on the form: a tick box per option, any number ticked.
    const order = f.options!.map(([v]) => v)
    const ticked = choiceValues(value)
    control = (
      <div className="flex items-start gap-1">
        <div role="group" aria-labelledby={`${id}-label`} className="flex-1 space-y-1.5 rounded-lg border border-border bg-input-bg px-3 py-2.5">
          {f.options!.map(([v, label]) => (
            <label key={v} className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={ticked.includes(v)}
                onChange={(e) => onChange(choiceValue(e.target.checked ? [...ticked, v] : ticked.filter((x) => x !== v), order))}
                className="mt-0.5 accent-accent"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {info}
      </div>
    )
  } else if (f.type === 'lines') {
    control = (
      <div className="flex items-start gap-1">
        <textarea
          id={id}
          rows={Math.min(8, Math.max(2, f.lines ?? 3))}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} ${over ? tooLongClass : ''}`}
          {...fitProps}
        />
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
            if (f.type === 'money') onChange(moneyValue(raw))
            else onChange(raw === '' ? null : raw)
          }}
          className={`${inputClass} ${f.type === 'money' ? 'tabular-nums' : ''} ${over ? tooLongClass : ''}`}
          {...fitProps}
        />
        {info}
      </div>
    )
  }

  return (
    <div className={f.type === 'yesno' ? 'sm:col-span-2' : wide ? 'sm:col-span-2' : ''} data-page={f.page} data-top={f.top}>
      {f.type === 'yesno' ? (
        <p id={`${id}-label`} className="mb-1.5 text-sm text-foreground/80">
          {f.label}
        </p>
      ) : f.type === 'choice' ? (
        <p id={`${id}-label`} className="mb-1.5 block text-xs font-medium text-muted">
          {f.label} <span className="font-normal text-foreground/40">(tick all that apply)</span>
        </p>
      ) : (
        <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">
          {f.label}
        </label>
      )}
      {control}
      {f.room && <TooLong id={fitId} over={over} room={f.room} />}
      {note && <p className="mt-1 text-xs text-warning">{note}</p>}
    </div>
  )
}

/* ---------------- Form 509's two columns ---------------- */

/** What a total box prints when left blank: the sum of its boxes that hold amounts, as the PDF engine adds them (withComputed). */
function sumOf(keys: string[], values: Record<string, FieldValue>): number | null {
  const nums = keys
    .map((k) => {
      const v = values[k]
      if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
      const n = Number(String(v).replace(/[$,\s]/g, ''))
      return Number.isFinite(n) ? n : null
    })
    .filter((n): n is number => n !== null)
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100 : null
}

/** Typed amount → stored value: a number when it reads as one, else the text as typed. */
function moneyValue(raw: string): FieldValue {
  if (raw.trim() === '') return null
  const cleaned = raw.replace(/[$,\s]/g, '')
  const n = Number(cleaned)
  if (!Number.isFinite(n) || !/^-?[\d,.\s$]+$/.test(raw)) return raw
  // Kept as typed while a number would change what is on screen ("2500." mid-typing,
  // "12.50", "2,500"): the box shows exactly what was typed, and the PDF reads both alike.
  return String(n) === cleaned ? n : raw
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
  // The totals as the PDF prints them, in order: a total left blank adds up
  // its boxes, and one that copies another total (TOTAL estimated realisable
  // values' Valuation = TOTAL assets' Valuation) copies what that prints.
  const printed: Record<string, FieldValue> = { ...values }
  for (let pass = 0; pass < 2; pass++) {
    for (const t of fields) {
      if (!t.sum) continue
      const typed = values[t.key]
      if (typed !== null && typed !== undefined && typed !== '') continue
      printed[t.key] = sumOf(t.sum, printed)
    }
  }
  const cell = (f: EntryField | undefined) => {
    if (!f) return <span className="block px-2 text-xs text-foreground/25" aria-hidden="true">—</span>
    const source = sourceOf(f.key)
    const value = values[f.key]
    const over = overflowFor(f.room, value)
    const fitId = `f-${f.key}-fit`
    // A total the form adds up when left blank (TOTAL assets, TOTAL estimated
    // realisable values): the sum shows in the empty box, as it will print.
    const total = f.sum ? sumOf(f.sum, printed) : null
    // A total box not typed into shows its total as its value (as it prints), kept up to
    // date; nothing is saved for it. Clicking in selects it, so typing replaces it.
    const auto = total !== null && (value === null || value === undefined || value === '') ? total : null
    return (
      <div data-page={f.page} data-top={f.top}>
        <div className="flex items-center gap-1">
          <input
            id={`f-${f.key}`}
            aria-label={f.label}
            inputMode="decimal"
            data-auto={auto !== null ? '' : undefined}
            onFocus={auto !== null ? (e) => e.currentTarget.select() : undefined}
            title={
              !f.sum
                ? undefined
                : f.sum.length === 1 && fields.some((x) => x.key === f.sum![0])
                  ? `The same as ${fields.find((x) => x.key === f.sum![0])!.label} when left blank; type an amount to use it instead.`
                  : 'Adds up the boxes above when left blank; type an amount to use it instead.'
            }
            value={auto !== null ? String(auto) : value === null || value === undefined ? '' : String(value)}
            onChange={(e) => onChange(f.key, moneyValue(e.target.value))}
            className={`${inputClass} py-1.5 tabular-nums ${over ? tooLongClass : ''}`}
            {...(over ? { 'aria-invalid': true as const, 'aria-describedby': fitId } : {})}
          />
          {source && <SourceButton source={source} label={f.label} />}
        </div>
        {f.room && <TooLong id={fitId} over={over} room={f.room} />}
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
                {r.inline && <InlineAnswer field={r.inline} value={values[r.inline.key]} onChange={onChange} />}
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

/** Line 4's "…assets to:" blank, typed inside its row. */
function InlineAnswer({ field: f, value, onChange }: { field: EntryField; value: FieldValue; onChange: (key: string, v: FieldValue) => void }) {
  const id = `f-${f.key}`
  const over = overflowFor(f.room, value)
  return (
    <span className="mt-1 block" data-page={f.page} data-top={f.top}>
      <span className="flex items-center gap-1.5">
        <label htmlFor={id} className="shrink-0 text-foreground/50">
          to:
        </label>
        <input
          id={id}
          aria-label={f.label}
          placeholder="Who holds the debenture or charge"
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(f.key, e.target.value === '' ? null : e.target.value)}
          className={`${inputClass} py-1 text-xs ${over ? tooLongClass : ''}`}
          {...(over ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-fit` } : {})}
        />
      </span>
      {f.room && <TooLong id={`${id}-fit`} over={over} room={f.room} />}
    </span>
  )
}

/* ---------------- appendix tables ---------------- */

function TableInput({ table, rows, sources, onChange }: { table: EntryTable; rows: TableRow[]; sources: AmountSource[]; onChange: (rows: TableRow[]) => void }) {
  const set = (i: number, key: string, v: FieldValue) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)))
  const pages = Math.max(1, Math.ceil(rows.length / table.rowsPerPage))
  return (
    <div className="mt-4" data-page={table.page} data-top={table.top}>
      <p className="mb-2 text-xs font-medium text-foreground/70">
        Table {table.id.replace('_', ' ')}: {table.title}
        <span className="ml-2 font-normal text-foreground/40">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'}, {table.rowsPerPage} a page · printed on{' '}
          {pages === 1 ? 'an appendix page' : `${pages} appendix pages`} (page {table.page}
          {pages > 1 ? ` and ${pages - 1} more ${pages === 2 ? 'copy' : 'copies'} of it` : ''})
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
                {table.columns.map((c) => {
                  const over = overflowFor(c.room, r[c.key])
                  const fitId = `t-${table.id}-${i}-${c.key}-fit`
                  return (
                    <td key={c.key} className="px-1 py-1 align-top">
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
                          set(i, c.key, c.type === 'money' ? moneyValue(raw) : raw === '' ? null : raw)
                        }}
                        className={`w-full min-w-[90px] rounded border border-border bg-input-bg px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none ${c.type === 'money' ? 'tabular-nums' : ''} ${over ? tooLongClass : ''}`}
                        {...(over ? { 'aria-invalid': true as const, 'aria-describedby': fitId } : {})}
                      />
                    )}
                    {over > 0 && (
                      <p id={fitId} className="mt-0.5 px-1 text-[11px] leading-tight text-destructive">
                        Too long for its cell: the last {chars(over)} won’t print.
                      </p>
                    )}
                    </td>
                  )
                })}
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

