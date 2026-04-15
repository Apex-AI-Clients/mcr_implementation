import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { isTokenExpired } from '@/lib/tokens'
import { z } from 'zod'

const AccountantSchema = z.object({
  companyName: z.string().min(1, 'Company name is required').max(200),
  contactPerson: z.string().min(1, 'Contact person is required').max(200),
  phoneNumber: z.string().min(1, 'Phone number is required').max(50),
  emailAddress: z.string().email('Valid email is required'),
})

async function validateToken(req: NextRequest) {
  const token = req.headers.get('x-client-token')
  if (!token) return null

  const supabase = await getSupabaseServerClient()
  const { data: client } = await supabase
    .from('clients')
    .select('id, link_expires_at')
    .eq('magic_link_token', token)
    .single()

  if (!client || isTokenExpired(client.link_expires_at)) return null
  return { clientId: client.id, supabase }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await validateToken(req)
    if (!ctx) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

    const { data } = await ctx.supabase
      .from('accountant_details')
      .select('*')
      .eq('client_id', ctx.clientId)
      .maybeSingle()

    if (!data) return NextResponse.json(null)

    return NextResponse.json({
      id: data.id,
      clientId: data.client_id,
      companyName: data.company_name,
      contactPerson: data.contact_person,
      phoneNumber: data.phone_number,
      emailAddress: data.email_address,
    })
  } catch (err) {
    console.error('[GET /api/portal/accountant-details]', err)
    return NextResponse.json({ error: 'Failed to fetch details' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await validateToken(req)
    if (!ctx) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

    const body = await req.json()
    const parsed = AccountantSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { companyName, contactPerson, phoneNumber, emailAddress } = parsed.data

    // Upsert by client_id
    const { data, error } = await ctx.supabase
      .from('accountant_details')
      .upsert(
        {
          client_id: ctx.clientId,
          company_name: companyName,
          contact_person: contactPerson,
          phone_number: phoneNumber,
          email_address: emailAddress,
        },
        { onConflict: 'client_id' },
      )
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({
      id: data.id,
      clientId: data.client_id,
      companyName: data.company_name,
      contactPerson: data.contact_person,
      phoneNumber: data.phone_number,
      emailAddress: data.email_address,
    })
  } catch (err) {
    console.error('[POST /api/portal/accountant-details]', err)
    return NextResponse.json({ error: 'Failed to save details' }, { status: 500 })
  }
}
