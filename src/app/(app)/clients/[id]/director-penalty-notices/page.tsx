import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { readDirectors } from '@/lib/clients/companyDetails'
import { Badge } from '@/components/ui/Badge'
import { DpnExportButtons } from '@/components/admin/dpn/DpnExportButtons'
import { buildDpnPanel, formatCents, sydneyToday } from '@/lib/dpn/view'
import {
  DPN_EXPORT_SOURCE_NOTE,
  columnLabels,
  describeDaysLeft,
  formatIsoDate,
  isUrgent,
  summariseNotices,
  typeLabel,
  type DpnSummary,
  type SummaryNotice,
} from '@/lib/dpn/summary'
import type { DpnAmounts } from '@/lib/dpn/types'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * A client's director penalty notices in one place: what the company owes by
 * type, each notice with its deadline, and what each director is personally
 * liable for. Figures are the notices' own; labels follow their wording.
 */
export default async function DirectorPenaltyNoticesPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('*').eq('id', id).single()
  if (!client) notFound()
  // An archived file is viewed, read-only, in the Archive.
  if (client.archived_at) redirect(`/sbr/archive/${client.id}`)

  const [{ data: docs }, { data: noticeRows }, { data: company }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, original_filename')
      .eq('client_id', id)
      .eq('doc_category', 'director_penalty_notices')
      .order('uploaded_at', { ascending: false }),
    supabase.from('director_penalty_notices').select('*').eq('client_id', id),
    supabase.from('company_details').select('acn_number, directors').eq('client_id', id).maybeSingle(),
  ])

  const todayIso = sydneyToday()
  const panel = buildDpnPanel({
    documents: (docs ?? []).map((d) => ({ id: d.id, originalFilename: d.original_filename })),
    noticeRows: noticeRows ?? [],
    client,
    file: { acn: company?.acn_number ?? null, directors: readDirectors(company?.directors) },
    todayIso,
  })
  const summary = summariseNotices(panel.notices, todayIso)
  const meta = { clientName: client.name, asAtIso: todayIso }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Link
        href={`/clients/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-foreground/40 transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to client
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Director penalty notices</h1>
          <p className="mt-1 text-sm text-foreground/50">
            {client.name} · as at {formatIsoDate(todayIso)}
          </p>
        </div>
        {summary.notices.length > 0 && <DpnExportButtons summary={summary} meta={meta} />}
      </div>

      {panel.notices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-foreground/50">
          {panel.noneIssued
            ? `No director penalty notice has been issued (ticked by ${panel.noneIssued.by}).`
            : 'No director penalty notices uploaded.'}
        </div>
      ) : (
        <div className="space-y-8">
          <CompanyTotals summary={summary} />
          <NoticesTable notices={summary.notices} />
          <DirectorTotals summary={summary} />
          {summary.waiting.length > 0 && (
            <section aria-labelledby="dpn-waiting-heading" className="rounded-xl border border-warning/30 bg-warning/5 p-4">
              <h2 id="dpn-waiting-heading" className="text-sm font-semibold text-foreground">
                Not in the totals
              </h2>
              <p className="mt-1 text-xs text-foreground/60">
                Waiting to be read or entered manually on the{' '}
                <Link href={`/clients/${id}`} className="text-accent hover:underline">
                  client page
                </Link>
                :
              </p>
              <ul className="mt-2 list-disc pl-5 text-sm text-foreground/80">
                {summary.waiting.map((w) => (
                  <li key={w.documentId}>{w.filename}</li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-foreground/40">{DPN_EXPORT_SOURCE_NOTE}</p>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 text-sm font-semibold text-foreground">
      {children}
    </h2>
  )
}

/** What the company owes, by type, each period counted once. */
function CompanyTotals({ summary }: { summary: DpnSummary }) {
  return (
    <section aria-labelledby="dpn-company-heading">
      <SectionTitle id="dpn-company-heading">What the company owes, by type</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {summary.companyByType.map((t) => {
          const labels = columnLabels(t.type, t.earliestDeadline)
          return (
            <div key={t.type} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">{typeLabel(t.type)}</h3>
                <span className="text-xs text-foreground/40">
                  {t.periods} period{t.periods === 1 ? '' : 's'}, each counted once
                </span>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <AmountLine label={labels.column3} value={t.totals.column3} strong />
                <AmountLine label={labels.column4} value={t.totals.column4} />
                <AmountLine label={labels.column5} value={t.totals.column5} />
                <AmountLine label={labels.column2} value={t.totals.column2} muted />
              </dl>
            </div>
          )
        })}
      </div>
      {summary.companyByType.length > 1 && (
        <p className="mt-3 text-sm text-foreground/80">
          All types: <span className="font-semibold tabular-nums">{formatCents(summary.company.column3)}</span> unpaid
        </p>
      )}
    </section>
  )
}

function AmountLine({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className={muted ? 'text-foreground/50' : 'text-foreground/70'}>{label}</dt>
      <dd
        className={`shrink-0 tabular-nums ${strong ? 'text-base font-semibold text-foreground' : muted ? 'text-foreground/50' : 'text-foreground'}`}
      >
        {formatCents(value)}
      </dd>
    </div>
  )
}

const AMOUNT_KEYS: (keyof DpnAmounts)[] = ['column2', 'column3', 'column4', 'column5']

function NoticesTable({ notices }: { notices: SummaryNotice[] }) {
  return (
    <section aria-labelledby="dpn-notices-heading">
      <SectionTitle id="dpn-notices-heading">Notices</SectionTitle>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-foreground/50">
              <th className="px-3 py-2 font-medium">Standing</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Director</th>
              <th className="px-3 py-2 font-medium">Issued</th>
              <th className="px-3 py-2 font-medium">Deadline</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 text-right font-medium">Column 2</th>
              <th className="px-3 py-2 text-right font-medium">Col 3 Unpaid</th>
              <th className="px-3 py-2 text-right font-medium">Column 4</th>
              <th className="px-3 py-2 text-right font-medium">Column 5</th>
              <th className="px-3 py-2 font-medium">How read</th>
            </tr>
          </thead>
          <tbody>
            {notices.map((n) => {
              const history = n.standing === 'history'
              return (
                <tr key={n.documentId} className={`border-b border-border last:border-0 ${history ? 'text-foreground/50' : 'text-foreground/90'}`}>
                  <td className="px-3 py-2">
                    <Badge variant={history ? 'muted' : 'accent'}>{history ? 'History' : 'Current'}</Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{typeLabel(n.type)}</td>
                  <td className="px-3 py-2">{n.directorName}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatIsoDate(n.issuedOn)}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {formatIsoDate(n.deadline)}
                    {!history && (
                      <span
                        className={`ml-1.5 text-xs ${isUrgent(n.daysLeft) ? 'font-semibold text-destructive' : 'text-foreground/50'}`}
                      >
                        {describeDaysLeft(n.daysLeft)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-foreground/60">{n.reference ?? '—'}</td>
                  {AMOUNT_KEYS.map((key) => (
                    <td key={key} className={`px-3 py-2 text-right tabular-nums ${key === 'column3' ? 'font-medium' : ''}`}>
                      {formatCents(n.totals[key])}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={n.source === 'manual' ? 'accent' : 'muted'}>
                        {n.source === 'manual' ? 'Entered manually' : 'Read automatically'}
                      </Badge>
                      {(n.needsReview || n.issues.length > 0) && (
                        <span title={n.issues.join('\n')} className="text-warning">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="sr-only">Needs checking: {n.issues.join(' ')}</span>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-foreground/40">
        Column 2: the notice&apos;s own amount (withheld, or assessed). Column 3: unpaid. Column 4: removed if the
        company appoints an SBR practitioner, administrator or liquidator, or pays, by the notice&apos;s deadline.
        Column 5: stays with the director unless paid. &ldquo;Current&rdquo; is the most recent notice for that
        director and type; totals use current notices.
      </p>
    </section>
  )
}

function DirectorTotals({ summary }: { summary: DpnSummary }) {
  return (
    <section aria-labelledby="dpn-directors-heading">
      <SectionTitle id="dpn-directors-heading">By director (current notices)</SectionTitle>
      <p className="-mt-2 mb-3 text-xs text-foreground/50">
        Each director receives their own notice for the same company debt, so these are not added together: the
        company figures above count each period once.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-foreground/50">
              <th className="px-3 py-2 font-medium">Director</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 text-right font-medium">Column 2</th>
              <th className="px-3 py-2 text-right font-medium">Col 3 Unpaid</th>
              <th className="px-3 py-2 text-right font-medium">Column 4</th>
              <th className="px-3 py-2 text-right font-medium">Column 5</th>
            </tr>
          </thead>
          <tbody>
            {summary.directors.flatMap((d) => [
              ...d.byType.map((t, i) => (
                <tr key={`${d.directorName}-${t.type}`} className="border-b border-border">
                  <td className="px-3 py-2">{i === 0 ? d.directorName : ''}</td>
                  <td className="px-3 py-2">{typeLabel(t.type)}</td>
                  {AMOUNT_KEYS.map((key) => (
                    <td key={key} className="px-3 py-2 text-right tabular-nums">
                      {formatCents(t.totals[key])}
                    </td>
                  ))}
                </tr>
              )),
              ...(d.byType.length > 1
                ? [
                    <tr key={`${d.directorName}-all`} className="border-b border-border font-medium">
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2">All types</td>
                      {AMOUNT_KEYS.map((key) => (
                        <td key={key} className="px-3 py-2 text-right tabular-nums">
                          {formatCents(d.overall[key])}
                        </td>
                      ))}
                    </tr>,
                  ]
                : []),
            ])}
          </tbody>
        </table>
      </div>
    </section>
  )
}
