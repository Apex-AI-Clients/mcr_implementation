'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileWarning, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { DpnPanelData } from '@/lib/dpn/view'
import { formatDate } from '@/lib/utils'

interface DpnPanelProps {
  clientId: string
  data: DpnPanelData
  /** An archived file: shown, not changed. */
  readOnly?: boolean
}

/**
 * The client page's Director Penalty Notices card, under the files: the
 * "none issued" tick when there are no notices, and the way to the DPN
 * summary when there are. What each notice says, and reading or entering it,
 * live on the summary page.
 */
export function DpnPanel({ clientId, data, readOnly = false }: DpnPanelProps) {
  return (
    <>
      {data.clearedNote && (
        <p className="mt-3 ml-6.5 flex items-start gap-1.5 rounded-lg bg-accent/10 px-2.5 py-2 text-xs text-foreground/70">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
          {data.clearedNote}
        </p>
      )}

      {data.notices.length === 0 ? (
        <NoneIssuedTick clientId={clientId} noneIssued={data.noneIssued} readOnly={readOnly} />
      ) : (
        <div className="mt-3 ml-6.5 flex justify-end">
          <Link href={`/clients/${clientId}/director-penalty-notices`}>
            <Button variant="primary" size="sm">
              <FileWarning className="h-3.5 w-3.5" />
              DPN Summary
            </Button>
          </Link>
        </div>
      )}
    </>
  )
}

function NoneIssuedTick({
  clientId,
  noneIssued,
  readOnly,
}: {
  clientId: string
  noneIssued: DpnPanelData['noneIssued']
  readOnly: boolean
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(confirmed: boolean) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/director-penalty-notices/none-issued`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error ?? 'That did not save.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 ml-6.5 text-xs">
      <label className="inline-flex cursor-pointer items-center gap-2 text-foreground/80">
        <input
          type="checkbox"
          checked={noneIssued !== null}
          disabled={saving || readOnly}
          onChange={(event) => toggle(event.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer accent-accent"
        />
        No director penalty notice has been issued
      </label>
      {noneIssued && (
        <p className="mt-1 ml-5.5 text-foreground/40">
          Ticked by {noneIssued.by}, {formatDate(noneIssued.at)}
        </p>
      )}
      {error && <p className="mt-1 text-destructive">{error}</p>}
    </div>
  )
}
