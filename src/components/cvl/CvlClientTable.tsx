import Link from 'next/link'
import { CheckCircle2, Search } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils'
import { formatExtractDate } from '@/lib/asic/dates'
import { CVL_ORIGIN_LABELS, CVL_STATUS_LABELS, type CvlStatus } from '@/lib/cvl/cases'
import type { CvlListPage } from '@/lib/cvl/listing'
import { CvlDeleteButton } from './CvlDeleteButton'
import { CvlRowCheckbox, CvlSelectAll, CvlSelectionProvider } from './CvlBulkDelete'

const STATUS_VARIANT: Record<CvlStatus, 'muted' | 'warning' | 'success'> = {
  draft: 'muted',
  forms_prepared: 'warning',
  printed: 'success',
}

interface CvlClientTableProps {
  list: CvlListPage
  /** The page this table is on, for search and paging links. */
  path: string
  /** Extra query kept on search and paging links. */
  keep?: Record<string, string>
  /** Where a row opens. */
  rowHref: (clientId: string) => string
  /** A Delete on each row, and ticking several to delete together. */
  deletable?: boolean
  empty: string
}

/** The CVL client list. Search and paging are plain links. */
export function CvlClientTable({ list, path, keep = {}, rowHref, deletable = false, empty }: CvlClientTableProps) {
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize))
  // Shown when the list says, per file, whether its ASIC extract PDF is kept (cvl/listing.ts).
  const showAsic = list.rows.some((r) => r.asicExtract !== undefined)
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
        <Selectable on={deletable} rows={list.rows.map((r) => ({ id: r.caseId, name: r.name, inSbr: r.inSbr }))}>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-xs text-foreground/50">
                {deletable && (
                  <th className="w-10 px-4 py-3">
                    <CvlSelectAll />
                  </th>
                )}
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Came from</th>
                <th className="px-4 py-3 font-medium">Became CVL client</th>
                {showAsic && <th className="px-4 py-3 font-medium">ASIC extract</th>}
                {deletable && <th className="w-12 px-4 py-3"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.caseId} className="border-b border-white/8 last:border-0 hover:bg-surface/60">
                  {deletable && (
                    <td className="px-4 py-3">
                      <CvlRowCheckbox id={r.caseId} name={r.name} />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <Link href={rowHref(r.clientId)} className="font-medium text-foreground hover:text-accent">
                      {r.name}
                    </Link>
                    <p className="text-xs text-foreground/50">{r.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[r.status]}>{CVL_STATUS_LABELS[r.status]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-foreground/70">
                    {CVL_ORIGIN_LABELS[r.origin]}
                    {r.inSbr && (
                      <Link href={`/clients/${r.clientId}`} className="ml-2 inline-flex">
                        <Badge variant="muted">Also in SBR</Badge>
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-foreground/70">{formatDate(r.createdAt)}</td>
                  {showAsic && (
                    <td className="px-4 py-3 text-xs">
                      {r.asicExtract != null ? (
                        <span className="inline-flex items-center gap-1 text-success" title={r.asicExtract ? `ASIC extract dated ${formatExtractDate(r.asicExtract)}` : 'ASIC extract on file'}>
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          {r.asicExtract ? formatExtractDate(r.asicExtract) : 'On file'}
                        </span>
                      ) : (
                        <Link href={`${rowHref(r.clientId)}/intake?step=company`} className="text-warning hover:underline" title="No ASIC extract on file: upload it under Company and Trust Details">
                          — Not on file
                        </Link>
                      )}
                    </td>
                  )}
                  {deletable && (
                    <td className="px-4 py-3 text-right">
                      <CvlDeleteButton caseId={r.caseId} clientName={r.name} inSbr={r.inSbr} compact />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </Selectable>
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

/** The selection (and its "Delete selected" bar) around the table, when rows can be deleted. */
function Selectable({ on, rows, children }: { on: boolean; rows: { id: string; name: string; inSbr: boolean }[]; children: React.ReactNode }) {
  return on ? <CvlSelectionProvider rows={rows}>{children}</CvlSelectionProvider> : <>{children}</>
}
