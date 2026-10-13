'use client'

import { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Dialog } from '@/components/ui/Dialog'
import { MAX_UPLOAD_BYTES } from '@/lib/sbr/import/config'
import { rejectedRowsCsv } from '@/lib/sbr/import/csv'
import type { ImportPreview, RowRef } from '@/lib/sbr/import/types'
import styles from './PredictionData.module.css'
import { IconArrow, IconCheck, IconDownload, IconFile, IconUpload, IconWarn, Shape } from './shared'

/**
 * "Upload data": drop a file → we check every row (on the server; never sent
 * to an AI) → you review → confirm. Nothing is saved before Confirm, and
 * Confirm sends the same file again, so the server checks it again rather
 * than trusting anything from this page.
 */

type Stage = 'drop' | 'checking' | 'review'

const STEPS = ['Upload', 'We check every row', 'You review', 'Confirm']
const TITLES: Record<Stage, string> = {
  drop: 'Add past cases',
  checking: 'Checking every row…',
  review: 'Review before anything changes',
}
const CHECKS = [
  'All required columns are there',
  'Every figure is read and checked',
  'Repeats and stored cases matched',
  'Payments and C/$ agree',
]
/** Long enough for the checklist to read, short enough not to wait for it. */
const MIN_CHECKING_MS = 1400

interface Checked {
  file: File
  fileName: string
  preview: ImportPreview
}

export interface ImportedCounts {
  added: number
  corrected: number
}

interface Props {
  open: boolean
  onClose: () => void
  onImported: (result: { importId: string | null; counts: ImportedCounts }) => void
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? fallback
}

export function UploadDialog({ open, onClose, onImported }: Props) {
  const [stage, setStage] = useState<Stage>('drop')
  const [checked, setChecked] = useState<Checked | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function reset() {
    setStage('drop')
    setChecked(null)
    setTicked(new Set())
    setError(null)
    setSaving(false)
  }
  function close() {
    if (saving) return
    reset()
    onClose()
  }

  async function check(file: File) {
    setError(null)
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('The file is larger than 5 MB.')
      return
    }
    setStage('checking')
    const started = Date.now()
    try {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch('/api/admin/sbr/case-imports/preview', { method: 'POST', body: form })
      const wait = MIN_CHECKING_MS - (Date.now() - started)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      if (!res.ok) {
        setError(await errorOf(res, 'The file could not be checked.'))
        setStage('drop')
        return
      }
      const body = (await res.json()) as { fileName: string; preview: ImportPreview }
      setChecked({ file, fileName: body.fileName, preview: body.preview })
      setTicked(new Set())
      setStage('review')
    } catch {
      setError('The file could not be checked. Try again.')
      setStage('drop')
    }
  }

  async function confirm() {
    if (!checked) return
    setSaving(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', checked.file)
      form.set('corrections', JSON.stringify([...ticked]))
      const res = await fetch('/api/admin/sbr/case-imports', { method: 'POST', body: form })
      if (!res.ok) {
        setError(await errorOf(res, 'The import could not be saved. Nothing was changed.'))
        setSaving(false)
        return
      }
      const result = (await res.json()) as { importId: string | null; counts: ImportedCounts }
      setSaving(false)
      reset()
      onImported(result)
    } catch {
      setError('The import could not be saved. Nothing was changed.')
      setSaving(false)
    }
  }

  const { getRootProps, getInputProps, isDragActive, open: openPicker } = useDropzone({
    multiple: false,
    noClick: true,
    noKeyboard: true,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    onDrop: (accepted, rejections) => {
      if (accepted[0]) void check(accepted[0])
      else if (rejections[0]) setError('Upload a .csv, .xlsx or .xls file.')
    },
  })

  const stepIndex = stage === 'drop' ? 0 : stage === 'checking' ? 1 : saving ? 3 : 2

  return (
    <Dialog
      open={open}
      onClose={close}
      title={TITLES[stage]}
      titleClassName={`${styles.display} text-2xl`}
      eyebrow={
        <div className={styles.eyebrow} style={{ color: 'var(--accent-text)', marginBottom: 6 }}>
          Upload data
        </div>
      }
      className="max-w-[720px] rounded-3xl p-8"
    >
      <ol style={{ listStyle: 'none', margin: '4px 0 24px', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {STEPS.map((label, k) => (
          <li key={label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ display: 'block', height: 4, borderRadius: 4, transition: 'background .3s ease', background: k <= stepIndex ? '#2563EB' : 'var(--line2)' }} />
            <span style={{ fontSize: 12.5, fontWeight: k === stepIndex ? 700 : 600, color: k === stepIndex ? 'var(--text)' : 'var(--faint)' }}>{label}</span>
          </li>
        ))}
      </ol>

      {error && (
        <p
          role="alert"
          style={{ margin: '0 0 16px', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 12, background: 'var(--bad-soft)', color: 'var(--bad-text)', fontSize: 14, lineHeight: 1.45 }}
        >
          <IconWarn size={18} style={{ flex: 'none', marginTop: 1 }} />
          {error}
        </p>
      )}

      {stage === 'drop' && (
        <>
          <div {...getRootProps({ className: `${styles.dropzone}${isDragActive ? ` ${styles.dropzoneActive}` : ''}` })}>
            <input {...getInputProps()} aria-label="Choose a CSV or Excel file" />
            <span style={{ width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
              <IconUpload size={26} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 17 }}>{isDragActive ? 'Drop it here' : 'Drop your CSV or Excel file here'}</span>
            <span style={{ color: 'var(--muted)', fontSize: 14 }}>
              One row per past SBR, up to 5 MB. Every tab with the right headers is read. Nothing changes until you confirm.
            </span>
            <button type="button" className={`${styles.btn} ${styles.primary}`} style={{ marginTop: 6 }} onClick={openPicker}>
              Choose file
            </button>
          </div>
          <p style={{ margin: '16px 0 0', fontSize: 14, color: 'var(--muted)', textAlign: 'center' }}>
            Columns need to match ours.{' '}
            <a className={styles.lnk} href="/api/admin/sbr/case-imports/template">
              Download the template
            </a>
          </p>
        </>
      )}

      {stage === 'checking' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 14, background: 'var(--card2)', border: '1px solid var(--line2)' }}>
            <span style={{ color: 'var(--muted)', display: 'inline-flex' }}>
              <IconFile size={20} />
            </span>
            <span style={{ flex: 1, fontWeight: 600 }}>Checking your file</span>
            <span className={styles.num} style={{ fontSize: 13.5, color: 'var(--muted)' }}>
              On our server only
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: 'var(--line2)', overflow: 'hidden' }}>
            <div className={styles.checkbar} style={{ height: '100%', background: 'var(--accent)', borderRadius: 99 }} />
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {CHECKS.map((label, k) => (
              <li key={label} className={styles.rise} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5, animationDelay: `${250 + k * 300}ms` }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--ok-soft)', color: 'var(--ok-text)' }}>
                  <IconCheck size={12} />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stage === 'review' && checked && (
        <Review
          checked={checked}
          ticked={ticked}
          saving={saving}
          onToggle={(key) =>
            setTicked((prev) => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              return next
            })
          }
          onCancel={close}
          onConfirm={() => void confirm()}
        />
      )}
    </Dialog>
  )
}

function Review({
  checked,
  ticked,
  saving,
  onToggle,
  onCancel,
  onConfirm,
}: {
  checked: Checked
  ticked: ReadonlySet<string>
  saving: boolean
  onToggle: (key: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const { preview, fileName } = checked
  const { counts } = preview
  const addedAccepted = preview.added.filter((n) => n.record.accepted).length
  const willSave = counts.added + ticked.size + counts.details_added > 0
  const skippedTabs = preview.tabs.filter((t) => t.status === 'skipped' && t.detail)
  const names = preview.added.slice(0, 10)
  const confirmLabel =
    counts.added > 0 ? `Confirm and add ${counts.added} ${counts.added === 1 ? 'case' : 'cases'}` : willSave ? 'Confirm' : 'Nothing to import'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
        <strong style={{ color: 'var(--text)' }}>{fileName}</strong>: nothing is saved until you confirm.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Tile tone="ok" value={counts.added} title="Ready to add" note={`${addedAccepted} plans accepted · ${counts.added - addedAccepted} rejected`} />
        <Tile tone="warn" value={counts.corrections} title="Corrections" note="Different figures; tick to apply" />
        <Tile tone="plain" value={counts.already_have} title="Already have" note="Same figures; skipped" />
        <Tile tone="plain" value={counts.rejected} title="Not imported" note="Needs fixing in your file" />
      </div>

      {skippedTabs.map((t) => (
        <p key={t.tab ?? 'file'} style={{ margin: 0, fontSize: 13.5, color: 'var(--warn-text)' }}>
          Not read: {t.detail}
        </p>
      ))}

      {preview.corrections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Corrections to review</h3>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>
            We already have these clients, but your file has different figures. Tick the ones to apply; unticked ones change nothing.
          </p>
          {preview.corrections.map((c) => (
            <label
              key={c.key}
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 14, border: '1px solid var(--line2)', background: 'var(--card2)', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={ticked.has(c.key)}
                onChange={() => onToggle(c.key)}
                disabled={saving}
                style={{ marginTop: 3, width: 18, height: 18, accentColor: '#2563EB' }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 650 }}>
                  {c.clientName}
                  {c.caseId === null && <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 500, color: 'var(--faint)' }}>(new in this file)</span>}
                </span>
                {c.notes.map((n) => (
                  <span key={n.code} style={{ display: 'block', marginTop: 3, fontSize: 13, color: 'var(--warn-text)' }}>
                    {n.message}
                  </span>
                ))}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
                  {c.changes.map((ch) => (
                    <span key={ch.column} className={styles.num} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 13.5 }}>
                      <span style={{ color: 'var(--faint)' }}>{ch.label}:</span>
                      <span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{ch.from}</span>
                      <span style={{ color: 'var(--faint)', display: 'inline-flex' }} aria-label="becomes">
                        <IconArrow size={13} />
                      </span>
                      <strong>{ch.to}</strong>
                    </span>
                  ))}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {preview.rejected.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Not imported</h3>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>
            These rows won&apos;t be saved because something in the row needs fixing. This is about the row, not whether the plan was accepted.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {preview.rejected.map((r) => (
              <li key={refKey(r.ref)} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 14, border: '1px solid var(--line2)' }}>
                <span style={{ flex: 'none', color: 'var(--warn-text)', marginTop: 1, display: 'inline-flex' }}>
                  <IconWarn size={18} />
                </span>
                <span style={{ fontSize: 14, lineHeight: 1.5 }}>
                  <strong>
                    {where(r.ref)} · {r.clientName || 'No client name'}
                  </strong>{' '}
                  <span style={{ color: 'var(--muted)' }}>{r.reasons.map((x) => x.message).join(' ')}</span>
                </span>
              </li>
            ))}
          </ul>
          <div>
            <button type="button" className={styles.btn} style={{ minHeight: 40 }} onClick={() => downloadCsv(rejectedRowsCsv(preview.rejected), rejectedFileName(fileName))}>
              <IconDownload size={16} />
              Download rows not imported (CSV)
            </button>
          </div>
        </div>
      )}

      {counts.added > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13.5, color: 'var(--faint)', fontWeight: 600, marginRight: 4 }}>Adding:</span>
          {names.map((n) => (
            <span
              key={refKey(n.ref)}
              title={n.notes.map((x) => x.message).join(' ') || undefined}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999, background: 'var(--card2)', border: '1px solid var(--line2)', fontSize: 13 }}
            >
              <Shape accepted={n.record.accepted} size={8} />
              <span className="sr-only">{n.record.accepted ? 'Plan accepted:' : 'Plan rejected:'}</span>
              {n.record.client_name}
              {n.notes.length > 0 && <span style={{ color: 'var(--warn-text)' }}>•</span>}
            </span>
          ))}
          {counts.added > names.length && <span style={{ fontSize: 13, color: 'var(--muted)' }}>and {counts.added - names.length} more</span>}
        </div>
      )}

      {counts.details_added > 0 && (
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>
          Also filling in business type and number of creditors on {counts.details_added} stored{' '}
          {counts.details_added === 1 ? 'case' : 'cases'} that had none. Undo clears them again.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 6 }}>
        <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>You can undo this later from Upload history.</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className={styles.btn} onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={onConfirm} disabled={!willSave || saving}>
            {saving ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function Tile({ tone, value, title, note }: { tone: 'ok' | 'warn' | 'plain'; value: number; title: string; note: string }) {
  const bg = tone === 'ok' ? 'var(--ok-soft)' : tone === 'warn' ? 'var(--warn-soft)' : 'var(--card2)'
  const fg = tone === 'ok' ? 'var(--ok-text)' : tone === 'warn' ? 'var(--warn-text)' : 'var(--text)'
  return (
    <div style={{ padding: 16, borderRadius: 16, background: bg, border: tone === 'plain' ? '1px solid var(--line2)' : '1px solid transparent', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className={`${styles.display} ${styles.num}`} style={{ fontSize: 30, fontWeight: 700, color: fg, lineHeight: 1.1 }}>
        {value}
      </span>
      <span style={{ fontWeight: 700 }}>{title}</span>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{note}</span>
    </div>
  )
}

const refKey = (ref: RowRef) => `${ref.tab ?? ''}:${ref.rowNumber}`
const where = (ref: RowRef) => (ref.tab ? `${ref.tab}, row ${ref.rowNumber}` : `Row ${ref.rowNumber}`)

function rejectedFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '') || 'upload'
  return `${base} - rows not imported.csv`
}

/** A CSV download, with the byte-order mark Excel needs to read UTF-8. */
function downloadCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
