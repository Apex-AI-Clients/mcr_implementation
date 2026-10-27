'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DpnManualForm } from '@/components/admin/dpn/DpnManualForm'
import { daysUntil } from '@/lib/dpn/checks'
import { describeManualReason, noticeTypeLabel } from '@/lib/dpn/stored'
import { formatCents, type DpnNoticeView } from '@/lib/dpn/view'
import { SourcedAmount } from '@/components/ui/SourcedAmount'
import { formatDate } from '@/lib/utils'

interface DpnNoticeListProps {
  clientId: string
  notices: DpnNoticeView[]
  /** Today in Sydney, ISO, for days left. */
  todayIso: string
}

/**
 * Every uploaded notice on the DPN summary page: what was read from it, how
 * (automatically or entered manually), anything to check, and the actions —
 * read it again, or enter or correct it by hand.
 */
export function DpnNoticeList({ clientId, notices, todayIso }: DpnNoticeListProps) {
  const [editing, setEditing] = useState<DpnNoticeView | null>(null)

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {notices.map((view) => (
          <NoticeCard
            key={view.documentId}
            clientId={clientId}
            view={view}
            todayIso={todayIso}
            onEdit={() => setEditing(view)}
          />
        ))}
      </div>
      {editing && (
        <DpnManualForm
          clientId={clientId}
          documentId={editing.documentId}
          notice={editing.notice}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function NoticeCard({
  clientId,
  view,
  todayIso,
  onEdit,
}: {
  clientId: string
  view: DpnNoticeView
  todayIso: string
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
    <div className="rounded-xl border border-border bg-card p-4 text-xs" aria-label={`Notice: ${view.filename}`}>
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
              Unpaid{' '}
              <span className="font-medium tabular-nums">
                <SourcedAmount
                  value={notice.totals.column3 / 100}
                  text={formatCents(notice.totals.column3)}
                  source={{
                    from: [
                      `Unpaid on this notice: ${formatCents(notice.totals.column3)}`,
                      `${view.filename}: the total of the notice's "unpaid" column, every period on it.`,
                      notice.source === 'manual' ? 'Entered by staff from the notice.' : 'Read from the notice.',
                    ],
                    link: { kind: 'pdf', documentId: view.documentId, page: 1, label: 'Open the notice' },
                  }}
                />
              </span>
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

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(!notice || notice.source === 'parsed') && (
          <Button type="button" size="sm" variant="ghost" onClick={readNotice} loading={reading}>
            {notice ? 'Read again' : 'Read notice'}
          </Button>
        )}
        <Button type="button" size="sm" variant={complete ? 'ghost' : 'accent'} onClick={onEdit}>
          {complete ? 'Correct by hand' : 'Enter manually'}
        </Button>
      </div>
    </div>
  )
}
