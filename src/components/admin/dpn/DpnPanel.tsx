'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Info } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DpnManualForm } from '@/components/admin/dpn/DpnManualForm'
import { daysUntil } from '@/lib/dpn/checks'
import { describeManualReason, noticeTypeLabel } from '@/lib/dpn/stored'
import { formatCents, type DpnNoticeView, type DpnPanelData } from '@/lib/dpn/view'
import { formatDate } from '@/lib/utils'

interface DpnPanelProps {
  clientId: string
  data: DpnPanelData
  /** An archived file: shown, not changed. */
  readOnly?: boolean
}

/**
 * The client page's view of its director penalty notices: what each uploaded
 * notice says, anything to check, and the "none issued" tick when there are
 * none. Every notice says how it got here: read automatically, or entered
 * manually.
 */
export function DpnPanel({ clientId, data, readOnly = false }: DpnPanelProps) {
  const [editing, setEditing] = useState<DpnNoticeView | null>(null)

  return (
    <div className="mt-3 ml-6.5 space-y-2">
      {data.clearedNote && (
        <p className="flex items-start gap-1.5 rounded-lg bg-accent/10 px-2.5 py-2 text-xs text-foreground/70">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
          {data.clearedNote}
        </p>
      )}

      {data.notices.length === 0 ? (
        <NoneIssuedTick clientId={clientId} noneIssued={data.noneIssued} readOnly={readOnly} />
      ) : (
        data.notices.map((view) => (
          <NoticeCard
            key={view.documentId}
            clientId={clientId}
            view={view}
            todayIso={data.todayIso}
            readOnly={readOnly}
            onEdit={() => setEditing(view)}
          />
        ))
      )}

      {editing && (
        <DpnManualForm
          clientId={clientId}
          documentId={editing.documentId}
          notice={editing.notice}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function NoticeCard({
  clientId,
  view,
  todayIso,
  readOnly,
  onEdit,
}: {
  clientId: string
  view: DpnNoticeView
  todayIso: string
  readOnly: boolean
  onEdit: () => void
}) {
  const router = useRouter()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { notice, issues, deadline } = view

  async function readNotice() {
    setReading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/clients/${clientId}/director-penalty-notices/${view.documentId}/read`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        setError(payload.error ?? 'The notice could not be read.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setReading(false)
    }
  }

  const complete = notice && notice.status !== 'needs_manual'
  const days = deadline ? daysUntil(deadline, todayIso) : null

  return (
    <div
      className="rounded-lg border border-border bg-card/60 p-3 text-xs"
      aria-label={`Notice: ${view.filename}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate text-foreground/50">{view.filename}</span>
        {notice &&
          (notice.source === 'manual' ? (
            <Badge variant="accent">Entered manually</Badge>
          ) : notice.status !== 'needs_manual' ? (
            <Badge variant="muted">Read automatically</Badge>
          ) : null)}
      </div>

      {!notice && <p className="mt-1.5 text-foreground/60">Not read yet.</p>}

      {notice?.status === 'needs_manual' && notice.manualReason && (
        <p className="mt-1.5 flex items-start gap-1.5 text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {describeManualReason(notice.manualReason)} Enter it manually.
        </p>
      )}

      {complete && (
        <div className="mt-1.5 space-y-1 text-foreground/80">
          <p className="text-sm font-medium text-foreground">
            {noticeTypeLabel(notice) ?? 'Type not given'}
            {notice.issuedOn && <span className="font-normal text-foreground/60"> · issued {formatDate(notice.issuedOn)}</span>}
          </p>
          {deadline && days !== null && (
            <p>
              Act by {formatDate(deadline)}{' '}
              <span className={days <= 7 ? 'font-semibold text-destructive' : 'text-foreground/60'}>
                ({days > 1 ? `${days} days left` : days === 1 ? '1 day left' : days === 0 ? 'today' : 'deadline passed'})
              </span>
            </p>
          )}
          {notice.totals && (
            <p>
              Unpaid <span className="font-medium tabular-nums">{formatCents(notice.totals.column3)}</span>
              {notice.directorName && <span className="text-foreground/60"> · to {notice.directorName}</span>}
            </p>
          )}
          {notice.source === 'manual' && notice.enteredBy && notice.enteredAt && (
            <p className="text-foreground/40">
              Entered manually by {notice.enteredBy}, {formatDate(notice.enteredAt)}
            </p>
          )}
        </div>
      )}

      {issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {issues.map((issue) => (
            <li key={issue} className="flex items-start gap-1.5 text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {issue}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-1.5 text-destructive">{error}</p>}

      {!readOnly && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(!notice || notice.source === 'parsed') && (
            <Button type="button" size="sm" variant="ghost" onClick={readNotice} loading={reading}>
              {notice ? 'Read again' : 'Read notice'}
            </Button>
          )}
          <Button type="button" size="sm" variant={complete ? 'ghost' : 'accent'} onClick={onEdit}>
            {complete ? 'Correct by hand' : 'Enter manually'}
          </Button>
        </div>
      )}
    </div>
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
    <div className="text-xs">
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
