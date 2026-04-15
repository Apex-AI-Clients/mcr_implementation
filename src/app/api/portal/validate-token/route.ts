import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { isTokenExpired } from '@/lib/tokens'
import type { DocumentRecord, AccountantDetails } from '@/types/app'

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    const supabase = await getSupabaseServerClient()

    const { data: client, error } = await supabase
      .from('clients')
      .select('id, name, email, status, magic_link_token, link_expires_at, ato_admin_confirmed, ato_admin_confirmed_at')
      .eq('magic_link_token', token)
      .single()

    if (error || !client) {
      return NextResponse.json(
        { error: 'This link is invalid or has already been used.' },
        { status: 404 },
      )
    }

    if (isTokenExpired(client.link_expires_at)) {
      return NextResponse.json(
        {
          error:
            'This link has expired. Please contact your MCR Partners advisor for a new link.',
        },
        { status: 410 },
      )
    }

    // Fetch documents
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

    // Fetch accountant details
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

    return NextResponse.json({
      clientId: client.id,
      clientName: client.name,
      atoAdminConfirmed: client.ato_admin_confirmed,
      documents,
      accountantDetails,
    })
  } catch (err) {
    console.error('[GET /api/portal/validate-token]', err)
    return NextResponse.json({ error: 'Failed to validate token' }, { status: 500 })
  }
}
