import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'

export async function GET(req: NextRequest) {
  const user = await requireStaffUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = req.nextUrl.searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  const supabase = getSupabaseServerClient()
  const { data } = await supabase
    .from('company_details')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()

  if (!data) return NextResponse.json(null)

  return NextResponse.json({
    id: data.id,
    clientId: data.client_id,
    companyName: data.company_name,
    acnNumber: data.acn_number,
    abnNumber: data.abn_number,
    trustName: data.trust_name,
    phoneNumber: data.phone_number,
    emailAddress: data.email_address,
  })
}

export async function POST(req: NextRequest) {
  const user = await requireStaffUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { clientId, companyName, acnNumber, abnNumber, trustName, phoneNumber, emailAddress } = body
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })

  const supabase = getSupabaseServerClient()

  const { data: existing } = await supabase
    .from('company_details')
    .select('id')
    .eq('client_id', clientId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('company_details')
      .update({
        company_name: companyName ?? null,
        acn_number: acnNumber ?? null,
        abn_number: abnNumber ?? null,
        trust_name: trustName ?? null,
        phone_number: phoneNumber ?? null,
        email_address: emailAddress ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('client_id', clientId)

    if (error) {
      console.error('[POST /api/portal/company-details] update', error)
      return NextResponse.json({ error: `Failed to update: ${error.message}` }, { status: 500 })
    }
  } else {
    const { error } = await supabase.from('company_details').insert({
      client_id: clientId,
      company_name: companyName ?? null,
      acn_number: acnNumber ?? null,
      abn_number: abnNumber ?? null,
      trust_name: trustName ?? null,
      phone_number: phoneNumber ?? null,
      email_address: emailAddress ?? null,
    })

    if (error) {
      console.error('[POST /api/portal/company-details] insert', error)
      return NextResponse.json({ error: `Failed to save: ${error.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
