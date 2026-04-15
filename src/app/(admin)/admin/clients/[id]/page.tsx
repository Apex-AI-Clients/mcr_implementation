import { notFound } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { DocumentStatusGrid } from '@/components/admin/DocumentStatusGrid'
import { CompletenessBar } from '@/components/admin/CompletenessBar'
import { ReminderButton } from '@/components/admin/ReminderButton'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils'
import type { DocumentRecord, FollowUpRecord, AccountantDetails } from '@/types/app'
import Link from 'next/link'
import { ArrowLeft, CheckCircle, XCircle, Building } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await getSupabaseServerClient()

  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (!client) notFound()

  const { data: rawDocs } = await supabase
    .from('documents')
    .select('*')
    .eq('client_id', id)
    .order('uploaded_at', { ascending: false })

  const { data: rawFollowUps } = await supabase
    .from('follow_ups')
    .select('*')
    .eq('client_id', id)
    .order('sent_at', { ascending: false })

  const { data: rawAccountant } = await supabase
    .from('accountant_details')
    .select('*')
    .eq('client_id', id)
    .maybeSingle()

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

  const followUps: FollowUpRecord[] = (rawFollowUps ?? []).map((f) => ({
    id: f.id,
    clientId: f.client_id,
    type: f.type,
    missingItems: f.missing_items ?? [],
    sentAt: f.sent_at,
    emailStatus: f.email_status,
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

  const lastFollowUp = followUps[0] ?? null

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
      {/* Back */}
      <Link
        href="/admin/clients"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All Clients
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{client.name}</h1>
          <p className="mt-0.5 text-sm text-foreground/50">{client.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          <ReminderButton clientId={client.id} lastSentAt={lastFollowUp?.sentAt ?? null} />
        </div>
      </div>

      {/* Completeness */}
      <Card className="mb-4">
        <CompletenessBar documents={documents} />
      </Card>

      {/* Meta row */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs text-foreground/50">
        <div>
          <p className="text-foreground/30 mb-0.5">Invite Sent</p>
          <p>{formatDate(client.created_at)}</p>
        </div>
        <div>
          <p className="text-foreground/30 mb-0.5">Link Expires</p>
          <p>{client.link_expires_at ? formatDate(client.link_expires_at) : '--'}</p>
        </div>
        <div>
          <p className="text-foreground/30 mb-0.5">ATO Admin</p>
          <div className="flex items-center gap-1">
            {client.ato_admin_confirmed ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 text-success" />
                <span className="text-success">Confirmed</span>
              </>
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5 text-foreground/30" />
                <span>Not confirmed</span>
              </>
            )}
          </div>
        </div>
        <div>
          <p className="text-foreground/30 mb-0.5">Last Reminder</p>
          <p>{lastFollowUp ? formatDate(lastFollowUp.sentAt) : 'None sent'}</p>
        </div>
      </div>

      {/* Accountant Details */}
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

      {/* Document grid */}
      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-foreground/80">Document Status</h2>
        <DocumentStatusGrid documents={documents} />
      </div>

      {/* Follow-up history */}
      {followUps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Reminder History</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-2">
            {followUps.map((fu) => (
              <div
                key={fu.id}
                className="flex items-center justify-between text-xs border-b border-white/5 last:border-0 pb-2 last:pb-0"
              >
                <div>
                  <span className="text-foreground/70 capitalize">{fu.type} reminder</span>
                  {fu.missingItems.length > 0 && (
                    <span className="text-foreground/40 ml-2">
                      ({fu.missingItems.length} items missing)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-foreground/40">
                  <span>{formatDate(fu.sentAt)}</span>
                  <Badge variant={fu.emailStatus === 'sent' ? 'success' : 'muted'}>
                    {fu.emailStatus}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
