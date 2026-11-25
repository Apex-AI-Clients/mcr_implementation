'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { fetchWithTimeout } from '@/lib/fetchWithTimeout'
import { CheckCircle2, Lock, Unlock } from 'lucide-react'

/**
 * "Complete" on each ASIC form of a CVL file, and "Unlock forms" for the lot (18 Nov 2026,
 * migration 0063). A completed form cannot be edited until the forms are unlocked.
 */

/** Never throws: a failure, a dropped connection or a timeout is the message to show (24 Nov 2026). */
async function send(url: string, init: RequestInit): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, init, 30_000)
    if (res.ok) return null
    return (await res.json().catch(() => ({})))?.error ?? 'Something went wrong. Please try again.'
  } catch (err) {
    return err instanceof Error && err.name === 'TimeoutError' ? err.message : 'Could not reach the server. Please try again.'
  }
}

export function CompleteFormButton({ caseId, form, subject, label }: { caseId: string; form: string; subject: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={busy}
        aria-label={`Mark ${label} complete`}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const err = await send(`/api/admin/cvl/${caseId}/forms/completion`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ form, subject }),
          })
          setBusy(false)
          if (err) setError(err)
          else router.refresh()
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 text-xs font-medium text-success hover:bg-success/20 disabled:opacity-50"
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> {busy ? 'Saving…' : 'Complete'}
      </button>
      {error && <span className="mt-1 max-w-[16rem] text-right text-[11px] text-destructive">{error}</span>}
    </span>
  )
}

export function UnlockFormsButton({ caseId, count }: { caseId: string; count: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(`Unlock the ${count} completed form${count === 1 ? '' : 's'} so they can be edited again?`)) return
          setBusy(true)
          setError(null)
          const err = await send(`/api/admin/cvl/${caseId}/forms/completion`, { method: 'DELETE' })
          setBusy(false)
          if (err) setError(err)
          else router.refresh()
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-primary disabled:opacity-50"
      >
        <Unlock className="h-3.5 w-3.5" /> {busy ? 'Unlocking…' : 'Unlock forms'}
      </button>
      {error && <span className="mt-1 max-w-[16rem] text-right text-[11px] text-destructive">{error}</span>}
    </span>
  )
}

/** A completed form's button: opens it read-only, under its "completed and locked" banner (24 Nov 2026). */
export function LockedFillButton({ at, href }: { at: string; href: string }) {
  return (
    <Link
      href={href}
      title={`Completed on ${formatDate(at)}. Unlock the forms to edit it.`}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-3 text-xs font-medium text-foreground/60 hover:text-foreground"
    >
      <Lock className="h-3.5 w-3.5" /> View
    </Link>
  )
}
