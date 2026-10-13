'use client'

import { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Dialog } from '@/components/ui/Dialog'
import type { ImportHistoryCounts } from '@/lib/sbr/import/payload'
import { MAX_UPLOAD_BYTES } from '@/lib/sbr/import/config'
import styles from './PredictionData.module.css'
import { IconCheck, IconFile, IconUpload, IconWarn } from './shared'

/**
 * The simple upload (used while GUIDED_UPLOAD is off, see config.ts): choose a
 * file, press Upload, see what happened. The server checks every row exactly
 * as in the guided flow and saves the new cases in one go; rows that fail a
 * check are left out. Corrections to cases we already hold are not applied
 * here (they need someone to tick them, which only the guided review offers).
 * Any upload can be undone from the upload history.
 */

interface Props {
  open: boolean
  onClose: () => void
  /** After a save: refresh the page's data. */
  onImported: (result: { importId: string | null; counts: Partial<ImportHistoryCounts> }) => void
}

type Result = { importId: string | null; counts: Partial<ImportHistoryCounts> }

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? fallback
}

export function SimpleUploadDialog({ open, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  function close() {
    if (uploading) return
    setFile(null)
    setError(null)
    setResult(null)
    onClose()
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
      setError(null)
      if (accepted[0]) {
        if (accepted[0].size > MAX_UPLOAD_BYTES) setError('The file is larger than 5 MB.')
        else setFile(accepted[0])
      } else if (rejections[0]) {
        setError('Upload a .csv, .xlsx or .xls file.')
      }
    },
  })

  async function upload() {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('corrections', '[]')
      const res = await fetch('/api/admin/sbr/case-imports', { method: 'POST', body: form })
      if (!res.ok) {
        setError(await errorOf(res, 'The file could not be uploaded. Nothing was changed.'))
        return
      }
      const body = (await res.json()) as Result
      setResult(body)
      onImported(body)
    } catch {
      setError('The file could not be uploaded. Nothing was changed.')
    } finally {
      setUploading(false)
    }
  }

  const c = result?.counts ?? {}
  const added = c.added ?? 0
  const alreadyHad = (c.already_have ?? 0) + (c.corrections_not_applied ?? 0)

  return (
    <Dialog
      open={open}
      onClose={close}
      title={result ? 'Upload complete' : 'Upload past cases'}
      titleClassName={`${styles.display} text-2xl`}
      eyebrow={
        <div className={styles.eyebrow} style={{ color: 'var(--accent-text)', marginBottom: 6 }}>
          Upload data
        </div>
      }
      className="max-w-[560px] rounded-3xl p-8"
    >
      {error && (
        <p
          role="alert"
          style={{
            margin: '0 0 16px',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '12px 14px',
            borderRadius: 12,
            background: 'var(--bad-soft)',
            color: 'var(--bad-text)',
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          <IconWarn size={18} style={{ flex: 'none', marginTop: 1 }} />
          {error}
        </p>
      )}

      {result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 16, background: 'var(--ok-soft)' }}>
            <span style={{ flex: 'none', width: 36, height: 36, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--ok)', color: '#fff' }}>
              <IconCheck size={16} />
            </span>
            <span style={{ fontSize: 15.5, lineHeight: 1.45, color: 'var(--text)' }}>
              {result.importId ? (
                <>
                  <strong>
                    {added} new {added === 1 ? 'case' : 'cases'} added.
                  </strong>{' '}
                  Predictions use them straight away.
                </>
              ) : (
                <strong>Nothing new: the file matches the cases we already have.</strong>
              )}
            </span>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14.5, color: 'var(--muted)' }}>
            <li>
              <strong className={styles.num} style={{ color: 'var(--text)' }}>
                {alreadyHad}
              </strong>{' '}
              already in the data, left as they are
            </li>
          </ul>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div {...getRootProps({ className: `${styles.dropzone}${isDragActive ? ` ${styles.dropzoneActive}` : ''}` })} style={{ padding: '32px 24px' }}>
            <input {...getInputProps()} aria-label="Choose a CSV or Excel file" />
            <span style={{ width: 52, height: 52, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
              <IconUpload size={24} />
            </span>
            {file ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 650, fontSize: 15.5 }}>
                <IconFile size={18} />
                {file.name}
              </span>
            ) : (
              <span style={{ fontWeight: 700, fontSize: 16.5 }}>{isDragActive ? 'Drop it here' : 'Drop a CSV or Excel file here'}</span>
            )}
            <span style={{ color: 'var(--muted)', fontSize: 14 }}>Up to 5 MB. One row per past SBR.</span>
            <button type="button" className={styles.btn} onClick={openPicker} disabled={uploading}>
              {file ? 'Choose a different file' : 'Choose file'}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)', textAlign: 'center' }}>
            Columns need to match ours.{' '}
            <a className={styles.lnk} href="/api/admin/sbr/case-imports/template">
              Download the template
            </a>
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button type="button" className={styles.btn} onClick={close} disabled={uploading}>
              Cancel
            </button>
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => void upload()} disabled={!file || uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
