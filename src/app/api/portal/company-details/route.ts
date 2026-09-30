import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import {
  CompanyDetailsSchema,
  readDirectors,
  companyDetailsInsert,
  companyDetailsUpdate,
  hasCompanyDetails,
} from '@/lib/clients/companyDetails'

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
    registeredOfficeAddress: data.registered_office_address,
    principalPlaceOfBusiness: data.principal_place_of_business,
    directors: readDirectors(data.directors),
    asicExtractDate: data.asic_extract_date,
    companyDetailsSource: data.company_details_source,
  })
}

export async function POST(req: NextRequest) {
  const user = await requireStaffUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { clientId, ...rest } = (body ?? {}) as Record<string, unknown>
  if (typeof clientId !== 'string' || !clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
  }

  // This used to take the JSON as it came. directors is stored as jsonb, so
  // whatever gets past here is what the column holds.
  const parsed = CompanyDetailsSchema.safeParse(rest)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const details = parsed.data

  if (!hasCompanyDetails(details)) {
    return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
  }

  const supabase = getSupabaseServerClient()

  const { data: existing } = await supabase
    .from('company_details')
    .select('id')
    .eq('client_id', clientId)
    .maybeSingle()

  if (existing) {
    // A partial write leaves every column it did not mention alone. Intake
    // step 1 sends only what the business register answered for, and the phone
    // number and email on this record are not on any register — see
    // src/lib/clients/companyDetails.ts.
    const { error } = await supabase
      .from('company_details')
      .update({ ...companyDetailsUpdate(details), updated_at: new Date().toISOString() })
      .eq('client_id', clientId)

    if (error) {
      console.error('[POST /api/portal/company-details] update', error)
      return NextResponse.json({ error: `Failed to update: ${error.message}` }, { status: 500 })
    }
  } else {
    const { error } = await supabase
      .from('company_details')
      .insert(companyDetailsInsert(clientId, details))

    if (error) {
      console.error('[POST /api/portal/company-details] insert', error)
      return NextResponse.json({ error: `Failed to save: ${error.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
