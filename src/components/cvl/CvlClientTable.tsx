import Link from 'next/link'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils'
import { CVL_ORIGIN_LABELS, CVL_STATUS_LABELS, type CvlStatus } from '@/lib/cvl/cases'
import type { CvlListPage } from '@/lib/cvl/listing'
import { CvlDeleteButton } from './CvlDeleteButton'

const STATUS_VARIANT: Record<CvlStatus, 'muted' | 'warning' | 'success'> = {
  draft: 'muted',
  forms_prepared: 'warning',
  printed: 'success',
}

interface CvlClientTableProps {
  list: CvlListPage
  /** The page this table is on, for search and paging links. */
  path: string
  /** Extra query kept on search and paging links (e.g. the Archive's view=moved). */
  keep?: Record<string, string>
  /** Where a row opens: the CVL file, or its read-only SBR record. */
  rowHref: (clientId: string) => string
  /** "Moved to CVL": show when and by whom, instead of status. */
  moved?: boolean
  /** A Delete on each row (the CVL client list; never the SBR Archive's "Moved to CVL"). */
  deletable?: boolean
  empty: string
}

/** The CVL client list, and the SBR Archive's "Moved to CVL". Search and paging are plain links. */
export function CvlClientTable({ list, path, keep = {}, rowHref, moved = false, deletable = false, empty }: CvlClientTableProps) {
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize))
  const link = (page: number) => {
    const params = new URLSearchParams({ ...keep, ...(list.query ? { q: list.query } : {}), page: String(page) })
    return `${path}?${params}`
  }

  return (
    <div className="space-y-3">
      <form method="get" action={path} className="relative max-w-sm">
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/40" aria-hidden="true" />
        <input
          type="search"
          name="q"
          defaultValue={list.query}
          placeholder="Search by name or email"
          aria-label="Search by name or email"
          className="w-full rounded-lg border border-border bg-input-bg py-2 pl-8 pr-3 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      </form>

      {list.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-foreground/50">
          {list.query ? 'No CVL clients match that search.' : empty}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-xs text-foreground/50">
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">{moved ? 'Moved to CVL' : 'Status'}</th>
                <th className="px-4 py-3 font-medium">{moved ? 'By' : 'Came from'}</th>
                <th className="px-4 py-3 font-medium">{moved ? 'CVL status' : 'Opened'}</th>
                {deletable && <th className="w-12 px-4 py-3"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.caseId} className="border-b border-white/8 last:border-0 hover:bg-surface/60">
                  <td className="px-4 py-3">
                    <Link href={rowHref(r.clientId)} className="font-medium text-foreground hover:text-accent">
                      {r.name}
                    </Link>
                    <p className="text-xs text-foreground/50">{r.email}</p>
                  </td>
                  {moved ? (
                    <>
                      <td className="px-4 py-3 tabular-nums text-foreground/70">{r.sbrArchivedAt ? formatDate(r.sbrArchivedAt) : '—'}</td>
                      <td className="px-4 py-3 text-foreground/70">{r.sbrArchivedBy ?? '—'}</td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[r.status]}>{CVL_STATUS_LABELS[r.status]}</Badge>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[r.status]}>{CVL_STATUS_LABELS[r.status]}</Badge>
                        {r.status === 'printed' && r.printedAt ? (
                          <span className="ml-2 text-xs tabular-nums text-foreground/50">{formatDate(r.printedAt)}</span>
                        ) : r.status === 'forms_prepared' && r.formsPreparedAt ? (
                          <span className="ml-2 text-xs tabular-nums text-foreground/50">{formatDate(r.formsPreparedAt)}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-foreground/70">{CVL_ORIGIN_LABELS[r.origin]}</td>
                      <td className="px-4 py-3 tabular-nums text-foreground/70">{formatDate(r.createdAt)}</td>
                    </>
                  )}
                  {deletable && (
                    <td className="px-4 py-3 text-right">
                      <CvlDeleteButton clientId={r.clientId} clientName={r.name} compact />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-xs text-foreground/50" aria-label="Pages">
          <span>
            Page {list.page} of {pages}
          </span>
          <span className="flex gap-3">
            {list.page > 1 && <Link href={link(list.page - 1)} className="hover:text-foreground">Previous</Link>}
            {list.page < pages && <Link href={link(list.page + 1)} className="hover:text-foreground">Next</Link>}
          </span>
        </nav>
      )}
    </div>
  )
}
