import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { withAppointmentDates } from '@/lib/asic/keep'
import {
  CompanyDetailsSchema,
  readDirectors,
  companyDetailsInsert,
  companyDetailsUpdate,
  hasCompanyDetails,
} from '@/lib/clients/companyDetails'
import { raiseDeveloperAlert } from '@/lib/alerts/developerAlert'

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
    entityType: data.entity_type,
    companyName: data.company_name,
    acnNumber: data.acn_number,
    abnNumber: data.abn_number,
    trustName: data.trust_name,
    trustAbnNumber: data.trust_abn_number,
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
    // The directors' appointment dates come from a kept ASIC extract, not
    // this form (migration 0041): carried over to the same directors.
    if (Array.isArray(details.directors) && details.directors.length > 0) {
      const { data: stored } = await supabase.from('company_details').select('directors').eq('client_id', clientId).maybeSingle()
      details.directors = withAppointmentDates(details.directors, readDirectors(stored?.directors)).directors
    }
    // A partial write leaves every column it did not mention alone. Intake
    // step 1 sends only what the business register answered for, and the phone
    // number and email on this record are not on any register — see
    // src/lib/clients/companyDetails.ts.
    const { error } = await supabase
      .from('company_details')
      .update({ ...companyDetailsUpdate(details), updated_at: new Date().toISOString() })
      .eq('client_id', clientId)

    if (error) {
      console.error('[POST /api/portal/company-details] update', error.code ?? 'unknown')
      // The database's own words go to the developer, never to the client's screen (24 Nov 2026).
      await raiseDeveloperAlert(supabase, {
        kind: 'portal_save',
        key: `portal_save:${clientId}:update:${error.code ?? 'unknown'}`,
        subject: 'Client portal: company details could not be saved',
        lines: ['A client could not save their company details.', '', `Client id: ${clientId}`, `Step: update`, `Database code: ${error.code ?? 'unknown'}`],
      })
      return NextResponse.json({ error: 'Your details could not be saved just now. Please try again in a moment.' }, { status: 500 })
    }
  } else {
    const { error } = await supabase
      .from('company_details')
      .insert(companyDetailsInsert(clientId, details))

    if (error) {
      console.error('[POST /api/portal/company-details] insert', error.code ?? 'unknown')
      // The database's own words go to the developer, never to the client's screen (24 Nov 2026).
      await raiseDeveloperAlert(supabase, {
        kind: 'portal_save',
        key: `portal_save:${clientId}:insert:${error.code ?? 'unknown'}`,
        subject: 'Client portal: company details could not be saved',
        lines: ['A client could not save their company details.', '', `Client id: ${clientId}`, `Step: insert`, `Database code: ${error.code ?? 'unknown'}`],
      })
      return NextResponse.json({ error: 'Your details could not be saved just now. Please try again in a moment.' }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
