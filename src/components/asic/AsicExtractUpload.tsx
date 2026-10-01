'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { uploadAsicExtract } from '@/lib/asic/browser'
import { formatExtractDate } from '@/lib/asic/dates'
import { acnDiffers, formatAcn, type AsicFill, type IdentityFillMode } from '@/lib/asic/fill'
import type { AsicExtract } from '@/lib/asic/types'

interface AsicExtractUploadProps {
  id: string
  /**
   * The form's ACN as typed. An extract for a different ACN is confirmed before
   * anything fills; confirming replaces the company details with the extract's.
   */
  acnNumber: string
  /** The fill currently applied, if any — shown with its date and an undo. */
  fill: AsicFill | null
  disabled?: boolean
  /**
   * 'inline' sits among the fields, button first. 'centered' is for the top of
   * a form: the button in the middle of its own panel, its hint underneath.
   */
  layout?: 'inline' | 'centered'
  /** 'merge' fills empty boxes; 'replace' after a confirmed ACN mismatch. */
  onFill: (extract: AsicExtract, mode: IdentityFillMode) => void
  onUndo: () => void
}

type Status =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'failed'; message: string }
  /** The extract is for a different ACN than the form's. Nothing filled until confirmed. */
  | { kind: 'confirm'; extract: AsicExtract }

/**
 * "Upload ASIC extract (PDF)": fills from an ASIC Current Company Extract — the
 * company name, ACN and ABN into empty boxes, and the registered office, the
 * principal place of business and the directors. Never the trust: trusts are
 * not registered with ASIC. See src/lib/asic/fill.ts for the rules.
 *
 * An extract for a different ACN than the form's asks first, and confirming
 * replaces the company details with the extract's.
 *
 * Optional everywhere it appears: every field it fills stays editable, and the
 * form works exactly the same with no upload at all. The PDF is read on our own
 * server and not stored.
 */
export function AsicExtractUpload({
  id,
  acnNumber,
  fill,
  disabled,
  layout = 'inline',
  onFill,
  onUndo,
}: AsicExtractUploadProps) {
  const input = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const reading = status.kind === 'reading'

  async function handleFile(file: File | undefined) {
    if (!file) return
    setStatus({ kind: 'reading' })
    const result = await uploadAsicExtract(file)
    if (!result.ok) {
      setStatus({ kind: 'failed', message: result.message })
      return
    }
    if (acnDiffers(acnNumber, result.extract.acn)) {
      setStatus({ kind: 'confirm', extract: result.extract })
      return
    }
    setStatus({ kind: 'idle' })
    onFill(result.extract, 'merge')
  }

  const asAt = formatExtractDate(fill?.extractedAt)
  // The question above is asked at upload. This covers the other order: the
  // extract went in first and a different ACN was typed afterwards.
  const mismatchedSince = fill !== null && acnDiffers(acnNumber, fill.acn)

  return (
    <div className="space-y-2">
      <input
        ref={input}
        id={id}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Upload ASIC extract (PDF)"
        className="sr-only"
        disabled={disabled || reading}
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared so choosing the same file again still fires a change.
          event.target.value = ''
          void handleFile(file)
        }}
      />
      <div
        className={
          layout === 'centered'
            ? 'flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-center'
            : 'flex flex-wrap items-center gap-x-3 gap-y-1'
        }
      >
        <Button
          type="button"
          variant="accent"
          size={layout === 'centered' ? 'md' : 'sm'}
          loading={reading}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {!reading && (
            <Upload
              className={layout === 'centered' ? 'h-4 w-4' : 'h-3.5 w-3.5'}
              aria-hidden="true"
            />
          )}
          {reading ? 'Reading the extract…' : 'Upload ASIC extract (PDF)'}
        </Button>
        <p className="text-xs text-foreground/50">
          Fills the company name, ACN and ABN where empty, the registered office, principal place
          of business and directors. Optional.
        </p>
      </div>

      {status.kind === 'failed' && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {status.message}
        </p>
      )}

      {status.kind === 'confirm' && (
        <div
          role="alertdialog"
          aria-label="This extract is for a different ACN"
          className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-3"
        >
          <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground/80">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <span>
              This extract is for {status.extract.companyName ?? 'another company'}, ACN{' '}
              {formatAcn(status.extract.acn)} — not the ACN on this form.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const { extract } = status
                setStatus({ kind: 'idle' })
                onFill(extract, 'replace')
              }}
            >
              Replace company details with the extract&rsquo;s
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setStatus({ kind: 'idle' })}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {fill && status.kind !== 'confirm' && (
        <div role="status" className="space-y-2 rounded-lg border border-success/30 bg-success/10 p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground/80">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <span>
                {asAt ? `Filled from ASIC extract dated ${asAt}.` : 'Filled from ASIC extract.'} Check
                the fields below.
              </span>
            </p>
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onUndo}>
              Undo fill
            </Button>
          </div>
          {mismatchedSince && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2 text-xs leading-relaxed text-foreground/80"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span>
                This extract is for {fill.companyName ?? 'another company'}, ACN {formatAcn(fill.acn)}
                , which is not the ACN on this form. Check the ACN, or undo the fill.
              </span>
            </p>
          )}
          {fill.warnings.length > 0 && (
            <ul className="space-y-1 pl-6 text-xs leading-relaxed text-foreground/70">
              {fill.warnings.map((warning) => (
                <li key={warning} className="list-disc">
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
