import { NextResponse } from 'next/server'
import { getPortalClient } from '@/lib/auth/portal'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import type { DocumentRecord, AccountantDetails } from '@/types/app'

/**
 * Returns the authenticated client's profile, documents, accountant details,
 * and ATO admin confirmation status. Backs the portal landing page.
 */
export async function GET() {
  try {
    const ctx = await getPortalClient()
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabaseServerClient()

    const { data: client, error } = await supabase
      .from('clients')
      .select('id, name, email, status, ato_admin_confirmed, ato_admin_confirmed_at')
      .eq('id', ctx.clientId)
      .single()

    if (error || !client) {
      return NextResponse.json({ error: 'Client profile not found' }, { status: 404 })
    }

    const { data: rawDocs } = await supabase
      .from('documents')
      .select('*')
      .eq('client_id', client.id)
      .order('uploaded_at', { ascending: false })

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

    const { data: rawAccountant } = await supabase
      .from('accountant_details')
      .select('*')
      .eq('client_id', client.id)
      .maybeSingle()

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

    const { data: rawCompany } = await supabase
      .from('company_details')
      .select('*')
      .eq('client_id', client.id)
      .maybeSingle()

    const companyDetails = rawCompany
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

    return NextResponse.json({
      clientId: client.id,
      clientName: client.name,
      clientEmail: client.email,
      atoAdminConfirmed: client.ato_admin_confirmed,
      documents,
      accountantDetails,
      companyDetails,
    })
  } catch (err) {
    console.error('[GET /api/portal/me]', err)
    return NextResponse.json({ error: 'Failed to load portal data' }, { status: 500 })
  }
}
