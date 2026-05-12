import { notFound } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { DocumentStatusGrid } from '@/components/admin/DocumentStatusGrid'
import { CompletenessBar } from '@/components/admin/CompletenessBar'
import { ClientActions } from '@/components/admin/ClientActions'
import { LodgementAnalysisCard } from '@/components/admin/LodgementAnalysisCard'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils'
import type { DocumentRecord, AccountantDetails, CompanyDetails } from '@/types/app'
import type { LodgementAnalysisPayload } from '@/lib/analysis/types'
import Link from 'next/link'
import { ArrowLeft, Building, Landmark } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase.from('clients').select('*').eq('id', id).single()
  if (!client) notFound()

  const [
    { data: rawDocs },
    { data: rawAccountant },
    { data: rawCompany },
    { data: rawAnalysis },
  ] = await Promise.all([
    supabase
      .from('documents')
      .select('*')
      .eq('client_id', id)
      .order('uploaded_at', { ascending: false }),
    supabase.from('accountant_details').select('*').eq('client_id', id).maybeSingle(),
    supabase.from('company_details').select('*').eq('client_id', id).maybeSingle(),
    supabase
      .from('lodgement_analyses')
      .select('*')
      .eq('client_id', id)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
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

  const hasActivityStatementCsv = documents.some(
    (d) =>
      d.docCategory === 'integrated_client_account' &&
      d.originalFilename.toLowerCase().includes('activity statement') &&
      d.originalFilename.toLowerCase().endsWith('.csv'),
  )

  const initialAnalysis: LodgementAnalysisPayload | null = rawAnalysis
    ? {
        id: rawAnalysis.id,
        clientId: rawAnalysis.client_id,
        documentId: rawAnalysis.document_id,
        sourceFilename: rawAnalysis.source_filename,
        statementLabel: rawAnalysis.statement_label,
        companyNameInCsv: rawAnalysis.company_name_in_csv,
        rowCount: rawAnalysis.row_count,
        summary: {
          numberOfLateLodgements: rawAnalysis.number_of_late_lodgements,
          cumulativeDaysLate: rawAnalysis.cumulative_days_late,
        },
        rows: rawAnalysis.rows as LodgementAnalysisPayload['rows'],
        warnings: rawAnalysis.warnings as LodgementAnalysisPayload['warnings'],
        analysedAt: rawAnalysis.analysed_at,
      }
    : null

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
        acnNumber: rawCompany.acn_number,
        abnNumber: rawCompany.abn_number,
        trustName: rawCompany.trust_name,
        phoneNumber: rawCompany.phone_number,
        emailAddress: rawCompany.email_address,
      }
    : null

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
        href="/admin/clients"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All Clients
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{client.name}</h1>
          <p className="mt-0.5 text-sm text-foreground/50">{client.email}</p>
        </div>
        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
      </div>

      <div className="mb-6">
        <ClientActions clientId={client.id} clientName={client.name} clientEmail={client.email} />
      </div>

       <div className="mb-6">
        <LodgementAnalysisCard
          clientId={id}
          initialAnalysis={initialAnalysis}
          hasActivityStatementCsv={hasActivityStatementCsv}
        />
      </div>

      <Card className="mb-4">
        <CompletenessBar documents={documents} />
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 text-xs text-foreground/50">
        <div>
          <p className="text-foreground/30 mb-0.5">Invite Sent</p>
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
            <CardTitle>Company / Trust Details</CardTitle>
          </div>
        </CardHeader>
        {companyDetails ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-foreground/30 mb-0.5">Company Name</p>
              <p className="text-foreground/70">{companyDetails.companyName || '—'}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">ACN Number</p>
              <p className="text-foreground/70">{companyDetails.acnNumber || '—'}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">ABN Number</p>
              <p className="text-foreground/70">{companyDetails.abnNumber || '—'}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">Trust Name</p>
              <p className="text-foreground/70">{companyDetails.trustName || '—'}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">Phone</p>
              <p className="text-foreground/70">{companyDetails.phoneNumber || '—'}</p>
            </div>
            <div>
              <p className="text-foreground/30 mb-0.5">Email</p>
              <p className="text-foreground/70">{companyDetails.emailAddress || '—'}</p>
            </div>
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
        <DocumentStatusGrid documents={documents} clientId={id} />
      </div>
      
    </div>
  )
}
