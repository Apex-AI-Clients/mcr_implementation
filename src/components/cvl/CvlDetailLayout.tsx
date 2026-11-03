import Link from 'next/link'
import { ArrowLeft, ArrowRight, Building, CheckCircle2, Circle, Eye, FileText, Gavel, Landmark, Pencil, Printer, Users } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { DocumentStatusGrid } from '@/components/admin/DocumentStatusGrid'
import { AtoAccountsPanel } from '@/components/admin/AtoAccountsPanel'
import { CompletenessBar } from '@/components/admin/CompletenessBar'
import { ComparisonJobStatus } from '@/components/admin/ComparisonJobStatus'
import { LeadOriginLink } from '@/components/leads/LeadOriginLink'
import { CvlStatusControl } from './CvlStatusControl'
import { CvlDeleteButton } from './CvlDeleteButton'
import { CURRENT_VERSION, FORM_CODES, formVersion } from '@/lib/forms/registry'
import { subjectsFor } from '@/lib/cvl/prefill'
import { CVL_ORIGIN_LABELS, type CvlCase } from '@/lib/cvl/cases'
import { formatPhone } from '@/lib/leads/format'
import { formatDob } from '@/lib/asic/dates'
import { formatDate } from '@/lib/utils'
import type { AtoAccountsOverview } from '@/lib/analysis/atoAccount/store'
import type { DpnPanelData } from '@/lib/dpn/view'
import type { AccountantDetails, CompanyDetails, DocumentRecord } from '@/types/app'

interface CvlDetailLayoutProps {
  client: { id: string; name: string; email: string; phone: string | null }
  originLeadId: string | null
  cvlCase: CvlCase
  drafts: { form_code: string; subject: string; updated_at: string; updated_by: string }[]
  company: CompanyDetails | null
  accountant: AccountantDetails | null
  documents: DocumentRecord[]
  dpn: DpnPanelData
  atoAccounts: AtoAccountsOverview
  runningJob: { id: string; created_at: string } | null
}

const SHORT: Record<string, string> = { '509': 'Form 509', '507a': 'Form 507 Part A', '507b': 'Form 507 Part B' }

const formatAcn = (acn: string | null) => {
  const d = (acn ?? '').replace(/\D/g, '')
  return d.length === 9 ? d.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : acn || null
}

/** "1 Aug 2022" from ASIC's "20220801"; a year alone as it is. */
const versionLabel = (v: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  return m ? formatDate(`${m[1]}-${m[2]}-${m[3]}`) : v
}

/**
 * A CVL client file, laid out for the job: where it stands and what to do
 * next first, then the ASIC forms (one Part B per director), the company and
 * its directors at a glance, and the documents and analyses the forms draw on.
 */
export function CvlDetailLayout({ client, originLeadId, cvlCase, drafts, company, accountant, documents, dpn, atoAccounts, runningJob }: CvlDetailLayoutProps) {
  const base = `/cvl/${client.id}`
  const directors = company?.directors ?? []
  const forms = FORM_CODES.flatMap((code) =>
    subjectsFor(code, { directors: directors.length }).map((subject) => {
      const n = subject.startsWith('director:') ? Number(subject.split(':')[1]) : null
      return {
        code,
        subject,
        title: formVersion(code).map.title,
        short: SHORT[code],
        who: n ? (directors[n - 1]?.name ?? `Director ${n}`) : 'The company',
        draft: drafts.find((d) => d.form_code === code && d.subject === subject) ?? null,
      }
    }),
  )
  const started = forms.filter((f) => f.draft).length
  const next =
    cvlCase.status === 'printed'
      ? 'Printed. Nothing more to do here unless the forms change.'
      : cvlCase.status === 'forms_prepared'
        ? 'Forms are saved for printing. Print them, then mark them printed.'
        : started === 0
          ? 'Check the forms: what the file has is filled in already. Fill any blank box, then save them for printing.'
          : `${started} of ${forms.length} forms opened. Finish the rest, then save them for printing.`

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link href="/cvl" className="mb-4 inline-flex items-center gap-1.5 text-xs text-foreground/40 transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        CVL clients
      </Link>

      {/* Who, and the main actions */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
            <Gavel className="h-3 w-3" aria-hidden="true" /> CVL · {CVL_ORIGIN_LABELS[cvlCase.origin]}
          </p>
          <h1 className="text-xl font-semibold text-foreground">{client.name}</h1>
          <p className="mt-0.5 text-sm text-foreground/60">
            {company?.companyName ?? 'No company details yet'}
            {formatAcn(company?.acnNumber ?? null) ? ` · ACN ${formatAcn(company?.acnNumber ?? null)}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-foreground/40">
            {client.email}
            {client.phone ? ` · ${formatPhone(client.phone)}` : ''}
          </p>
          <LeadOriginLink leadId={originLeadId} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CvlDeleteButton clientId={client.id} clientName={client.name} redirectTo="/cvl" />
          <Link
            href={`${base}/intake`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit details
          </Link>
          <Link
            href={`${base}/print`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent/90"
          >
            <Printer className="h-3.5 w-3.5" />
            Preview and print
          </Link>
        </div>
      </div>

      {/* Where it stands */}
      <div className="mb-6 space-y-2">
        <CvlStatusControl caseId={cvlCase.id} status={cvlCase.status} formsPreparedAt={cvlCase.formsPreparedAt} printedAt={cvlCase.printedAt} />
        <p className="flex items-center gap-1.5 px-1 text-xs text-foreground/60">
          <ArrowRight className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          {next}
        </p>
      </div>

      {runningJob && <ComparisonJobStatus key={runningJob.id} clientId={client.id} basePath={base} jobId={runningJob.id} startedAt={runningJob.created_at} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* The forms */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-foreground/50" />
                <CardTitle>ASIC forms</CardTitle>
              </div>
            </CardHeader>
            <p className="-mt-2 mb-3 text-xs text-foreground/50">
              One Part B per director. Opened or not, each prints with what the client file has; blank boxes are filled on the form.
            </p>
            <ul className="divide-y divide-white/5">
              {forms.map((f) => (
                <li key={`${f.code}-${f.subject}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    {f.draft ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-foreground/30" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {f.short} <span className="font-normal text-foreground/60">— {f.who}</span>
                      </p>
                      <p className="text-xs text-foreground/40">
                        <span className="sr-only">{f.title}. </span>
                        {f.draft ? `Draft saved ${formatDate(f.draft.updated_at)} by ${f.draft.updated_by}` : 'Not opened yet'} · ASIC version{' '}
                        {versionLabel(CURRENT_VERSION[f.code])}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={`/api/admin/cvl/${cvlCase.id}/preview?form=${f.code}&subject=${encodeURIComponent(f.subject)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs text-muted hover:text-foreground"
                    >
                      <Eye className="h-3.5 w-3.5" /> Preview
                    </a>
                    <Link
                      href={`${base}/forms/${f.code}?subject=${encodeURIComponent(f.subject)}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 text-xs font-medium text-accent hover:bg-accent/20"
                    >
                      <Pencil className="h-3.5 w-3.5" /> {f.draft ? 'Continue' : 'Fill in'}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {/* The documents the forms draw on */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-foreground/80">Documents</h2>
            <Card className="mb-3">
              <CompletenessBar documents={documents} />
            </Card>
            <DocumentStatusGrid documents={documents} clientId={client.id} basePath={base} dpn={dpn} atoAccounts={atoAccounts.accounts.map((a) => ({ id: a.id, kind: a.kind, label: a.label }))} />
          </section>

          <AtoAccountsPanel clientId={client.id} overview={atoAccounts} basePath={base} />
        </div>

        <aside className="space-y-6">
          {/* The company and its directors */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-foreground/50" />
                <CardTitle>Company</CardTitle>
              </div>
            </CardHeader>
            {company ? (
              <dl className="space-y-2.5 text-xs">
                {[
                  ['Name', company.companyName],
                  ['ACN', formatAcn(company.acnNumber)],
                  ['ABN', company.abnNumber],
                  ['Registered office', company.registeredOfficeAddress],
                  ['Principal place of business', company.principalPlaceOfBusiness],
                  ...(company.entityType === 'trust' ? [['Trustee of', company.trustName] as [string, string | null]] : []),
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-foreground/40">{label}</dt>
                    <dd className="text-foreground/80">{value || '—'}</dd>
                  </div>
                ))}
                {company.asicExtractDate && (
                  <p className="pt-1 text-[11px] text-foreground/40">From the ASIC extract dated {formatDate(company.asicExtractDate)}.</p>
                )}
              </dl>
            ) : (
              <p className="text-xs italic text-foreground/40">
                No company details yet.{' '}
                <Link href={`${base}/intake`} className="not-italic text-accent hover:underline">
                  Add them
                </Link>
                , or upload the ASIC extract.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-foreground/50" />
                <CardTitle>{directors.length === 1 ? 'Director' : 'Directors'}</CardTitle>
              </div>
            </CardHeader>
            {directors.length ? (
              <ul className="space-y-2.5 text-xs">
                {directors.map((d, i) => (
                  <li key={i}>
                    <p className="font-medium text-foreground/80">{d.name}</p>
                    <p className="text-foreground/40">
                      {d.dateOfBirth ? `Born ${formatDob(d.dateOfBirth)}` : 'Date of birth not on file'}
                      {d.appointedOn ? ` · appointed ${formatDate(d.appointedOn)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs italic text-foreground/40">No directors on file: add them in Edit details. Each gets their own Part B.</p>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Building className="h-4 w-4 text-foreground/50" />
                <CardTitle>Accountant</CardTitle>
              </div>
            </CardHeader>
            {accountant ? (
              <div className="space-y-0.5 text-xs text-foreground/80">
                <p className="font-medium">{accountant.companyName}</p>
                <p className="text-foreground/60">{accountant.contactPerson}</p>
                <p className="text-foreground/40">
                  {accountant.phoneNumber}
                  {accountant.emailAddress ? ` · ${accountant.emailAddress}` : ''}
                </p>
              </div>
            ) : (
              <p className="text-xs italic text-foreground/40">Not on file. Part B question 24 stays blank.</p>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Analyses</CardTitle>
            </CardHeader>
            <ul className="space-y-2 text-xs">
              {[
                [`${base}/financials-comparison`, 'Financial statements comparison'],
                [`${base}/financials-comparison/mapping`, 'Confirm key figures (Form 509 values)'],
                [`${base}/lodgement-compliance-analysis`, 'ATO activity statement account'],
                [`${base}/director-penalty-notices`, 'Director penalty notices'],
              ].map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                    {label}
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
            {cvlCase.origin === 'sbr_client' && (
              <p className="mt-3 border-t border-border pt-3 text-[11px] text-foreground/40">
                Moved from SBR{cvlCase.sbrArchivedAt ? ` on ${formatDate(cvlCase.sbrArchivedAt)}` : ''}.{' '}
                <Link href={`/sbr/archive/${client.id}`} className="text-accent hover:underline">
                  SBR record (read-only)
                </Link>
              </p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  )
}
