import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { DocumentStatusGrid } from '@/components/admin/DocumentStatusGrid'
import { CompletenessBar } from '@/components/admin/CompletenessBar'
import { ClientActions } from '@/components/admin/ClientActions'
import { ArchivedClientActions } from '@/components/admin/ArchivedClientActions'
import { PredictOutcomeButton } from '@/components/admin/PredictOutcomeButton'
import { LeadOriginLink } from '@/components/leads/LeadOriginLink'
import { getLeadIdForClient } from '@/lib/leads/queries'
import { formatPhone } from '@/lib/leads/format'
import { readDirectors } from '@/lib/clients/companyDetails'
import { describeDirector } from '@/lib/asic/fill'
import { identityDisplay } from '@/lib/clients/identityDisplay'
import { archiveReasonLabel } from '@/lib/clients/archive'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils'
import type { DocumentRecord, AccountantDetails, CompanyDetails } from '@/types/app'
import Link from 'next/link'
import { Archive, ArrowLeft, Building, Landmark, Pencil } from 'lucide-react'

interface ClientDetailViewProps {
  id: string
  /**
   * 'active' is the client page (/clients/[id]); 'archived' is the same file in
   * the Archive (/sbr/archive/[id]) — read-only, with Restore and Delete
   * permanently in place of the editing actions. Each redirects to the other
   * when the file is not in the state it shows.
   */
  mode: 'active' | 'archived'
}

/**
 * A client file, read: header, company and trust, accountant, documents. One
 * view for the client page and the Archive, so the two never drift apart.
 */
export async function ClientDetailView({ id, mode }: ClientDetailViewProps) {
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('*').eq('id', id).single()
  if (!client) notFound()
  // Each page shows only files in its own state.
  if (mode === 'active' && client.archived_at) redirect(`/sbr/archive/${client.id}`)
  if (mode === 'archived' && !client.archived_at) redirect(`/clients/${client.id}`)
  const archived = mode === 'archived'

  const [
    { data: rawDocs },
    { data: rawAccountant },
    { data: rawCompany },
    originLeadId,
  ] = await Promise.all([
    supabase
      .from('documents')
      .select('*')
      .eq('client_id', id)
      .order('uploaded_at', { ascending: false }),
    supabase.from('accountant_details').select('*').eq('client_id', id).maybeSingle(),
    supabase.from('company_details').select('*').eq('client_id', id).maybeSingle(),
    // Was a scan of the client-side lead list, which only worked while the
    // browser held every lead and was lost on reload.
    getLeadIdForClient(id),
  ])

  const documents: DocumentRecord[] = (rawDocs ?? []).map((d) => ({
    id: d.id,
    clientId: d.client_id,
    filePath: d.file_path,
    originalFilename: d.original_filename,
    fileType: d.file_type,
    fileSizeBytes: d.file_size_bytes,
    docCategory: d.doc_category,
    status: d.status,
    uploadedAt: d.uploaded_at,
  }))

  const accountantDetails: AccountantDetails | null = rawAccountant
    ? {
        id: rawAccountant.id,
        clientId: rawAccountant.client_id,
        companyName: rawAccountant.company_name,
        contactPerson: rawAccountant.contact_person,
        phoneNumber: rawAccountant.phone_number,
        emailAddress: rawAccountant.email_address,
      }
    : null

  const companyDetails: CompanyDetails | null = rawCompany
    ? {
        id: rawCompany.id,
        clientId: rawCompany.client_id,
        companyName: rawCompany.company_name,
        entityType: rawCompany.entity_type,
        acnNumber: rawCompany.acn_number,
        abnNumber: rawCompany.abn_number,
        trustName: rawCompany.trust_name,
        trustAbnNumber: rawCompany.trust_abn_number,
        phoneNumber: rawCompany.phone_number,
        emailAddress: rawCompany.email_address,
        registeredOfficeAddress: rawCompany.registered_office_address,
        principalPlaceOfBusiness: rawCompany.principal_place_of_business,
        directors: readDirectors(rawCompany.directors),
        asicExtractDate: rawCompany.asic_extract_date,
        companyDetailsSource: rawCompany.company_details_source,
      }
    : null
  const identity = identityDisplay(companyDetails ?? {})

  const STATUS_LABELS: Record<
    string,
    { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' | 'accent' }
  > = {
    invited: { label: 'Invited', variant: 'accent' },
    in_progress: { label: 'Uploading', variant: 'warning' },
    complete: { label: 'Complete', variant: 'success' },
    missing_items: { label: 'Missing Items', variant: 'destructive' },
  }
  const statusBadge = STATUS_LABELS[client.status] ?? { label: client.status, variant: 'muted' }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link
        href={archived ? '/sbr/archive' : '/clients'}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {archived ? 'Archive' : 'All Clients'}
      </Link>

      {archived && client.archived_at && (
        <div
          role="status"
          className="mb-6 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground/80"
        >
          <Archive className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            <span className="font-medium text-foreground">Archived</span> on{' '}
            {formatDate(client.archived_at)}
            {client.archived_by ? ` by ${client.archived_by}` : ''}.{' '}
            {archiveReasonLabel(client.archived_reason)
              ? `${archiveReasonLabel(client.archived_reason)}. `
              : ''}
            It is not on the client list. Make it a client again to edit it, or delete it
            permanently.
          </p>
        </div>
      )}

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{client.name}</h1>
          <p className="mt-0.5 text-sm text-foreground/50">{client.email}</p>
          {/* The client's own number, carried over from the lead — not the
              company or trust line, which is in the card below. */}
          {client.phone && (
            <p className="mt-0.5 text-sm tabular-nums text-foreground/50">
              {formatPhone(client.phone)}
            </p>
          )}
          <LeadOriginLink leadId={originLeadId} />
        </div>
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
      </div>

      {archived ? (
        <div className="mb-6">
          <ArchivedClientActions
            clientId={client.id}
            clientName={client.name}
            clientEmail={client.email}
          />
        </div>
      ) : (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <ClientActions clientId={client.id} clientName={client.name} />
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/clients/${client.id}/intake`}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-primary"
            >
              <Pencil className="h-4 w-4" />
              Continue intake
            </Link>
            <PredictOutcomeButton clientId={client.id} />
          </div>
        </div>
      )}

      <Card className="mb-4">
        <CompletenessBar documents={documents} />
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 text-xs text-foreground/50">
        <div>
          <p className="text-foreground/30 mb-0.5">Created</p>
          <p>{formatDate(client.created_at)}</p>
        </div>
        <div>
          <p className="text-foreground/30 mb-0.5">Last Updated</p>
          <p>{formatDate(client.updated_at)}</p>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-foreground/50" />
            <CardTitle>Company and Trust Details</CardTitle>
          </div>
        </CardHeader>
        {companyDetails ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            {/* The company and the trust apart, each with its own ABN. */}
            <p className="col-span-2 text-[11px] font-medium uppercase tracking-wide text-foreground/40">
              Company
            </p>
            {identity.company.map((row) => (
              <div key={row.label}>
                <p className="text-foreground/30 mb-0.5">{row.label}</p>
                <p className={`text-foreground/70 ${row.numeric ? 'tabular-nums' : ''}`}>
                  {row.value || '—'}
                </p>
              </div>
            ))}
            <div>
              <p className="text-foreground/30 mb-0.5">Company Phone</p>
              <p className="text-foreground/70">{companyDetails.phoneNumber || '—'}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">Company Email</p>
              <p className="text-foreground/70">{companyDetails.emailAddress || '—'}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">Registered Office</p>
              <p className="text-foreground/70">{companyDetails.registeredOfficeAddress || '—'}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">Principal Place of Business</p>
              <p className="text-foreground/70">{companyDetails.principalPlaceOfBusiness || '—'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-foreground/30 mb-0.5">
                {companyDetails.directors.length > 1 ? 'Directors' : 'Director'}
              </p>
              {companyDetails.directors.length > 0 ? (
                <ul className="space-y-0.5 text-foreground/70">
                  {companyDetails.directors.map((director, index) => (
                    <li key={index} className="tabular-nums">
                      {describeDirector(director)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-foreground/70">—</p>
              )}
            </div>
            {identity.trust && (
              <>
                <p className="col-span-2 mt-2 border-t border-border pt-3 text-[11px] font-medium uppercase tracking-wide text-foreground/40">
                  Trust
                </p>
                {identity.trust.map((row) => (
                  <div key={row.label}>
                    <p className="text-foreground/30 mb-0.5">{row.label}</p>
                    <p className={`text-foreground/70 ${row.numeric ? 'tabular-nums' : ''}`}>
                      {row.value || '—'}
                    </p>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-foreground/30 italic">Not yet provided by client</p>
        )}
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building className="h-4 w-4 text-foreground/50" />
            <CardTitle>Accountant Details</CardTitle>
          </div>
        </CardHeader>
        {accountantDetails ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-foreground/30 mb-0.5">Company</p>
              <p className="text-foreground/70">{accountantDetails.companyName}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">Contact Person</p>
              <p className="text-foreground/70">{accountantDetails.contactPerson}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">Phone</p>
              <p className="text-foreground/70">{accountantDetails.phoneNumber}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">Email</p>
              <p className="text-foreground/70">{accountantDetails.emailAddress}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-foreground/30 italic">Not yet provided by client</p>
        )}
      </Card>

      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-foreground/80">Document Status</h2>
        {/* Read-only in the Archive: files can be downloaded, not changed. */}
        <DocumentStatusGrid documents={documents} clientId={id} readOnly={archived} />
      </div>
    </div>
  )
}
