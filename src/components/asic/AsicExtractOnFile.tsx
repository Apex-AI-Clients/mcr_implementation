'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, FileWarning } from 'lucide-react'
import { formatExtractDate } from '@/lib/asic/dates'
import { formatDate } from '@/lib/utils'

/**
 * Whether the ASIC extract PDF is kept on the client file (migration 0041),
 * in one line: "ASIC extract on file, dated 3 Oct 2026 — Open", or that none
 * is and what uploading it fills on the CVL forms. Files whose company details
 * were filled from an extract before 0041 have no PDF kept: this says so.
 *
 * Asks the server on mount and whenever refreshKey changes (after a save).
 */

interface KeptExtract {
  id: string
  extractedAt: string | null
  uploadedAt: string
}

export function AsicExtractOnFile({
  clientId,
  refreshKey = 0,
  uploadHref,
  className,
}: {
  clientId: string
  refreshKey?: number
  /** Where the extract is uploaded (the intake page), when shown elsewhere. */
  uploadHref?: string
  className?: string
}) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; extract: KeptExtract | null }>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetch(`/api/admin/clients/${clientId}/asic-extract`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('status')
        const body = (await res.json()) as { extract: KeptExtract | null }
        if (!cancelled) setState({ status: 'ready', extract: body.extract })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [clientId, refreshKey])

  if (state.status === 'loading') return null
  if (state.status === 'error') {
    return <p className={className ? `text-xs text-foreground/50 ${className}` : 'text-xs text-foreground/50'}>Could not check whether the ASIC extract is on file.</p>
  }

  const { extract } = state
  if (extract) {
    const dated = formatExtractDate(extract.extractedAt)
    return (
      <p className={`flex flex-wrap items-center gap-x-1.5 text-xs text-foreground/70 ${className ?? ''}`} data-testid="asic-extract-on-file">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        <span>
          ASIC extract on file{dated ? `, dated ${dated}` : ''} (uploaded {formatDate(extract.uploadedAt)}).
        </span>
        <a href={`/api/admin/clients/${clientId}/asic-extract/${extract.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
          Open
        </a>
      </p>
    )
  }
  return (
    <p className={`flex items-start gap-1.5 text-xs text-warning ${className ?? ''}`} data-testid="asic-extract-on-file">
      <FileWarning className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        No ASIC extract on file: upload it under Company and Trust Details and save, to fill the registration and appointment dates on the CVL forms.
        {uploadHref && (
          <>
            {' '}
            <Link href={uploadHref} className="font-medium text-accent hover:underline">
              Upload it
            </Link>
          </>
        )}
      </span>
    </p>
  )
}
