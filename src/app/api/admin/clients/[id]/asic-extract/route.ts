import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { NO_STORE, readAsicUpload } from '@/lib/asic/readUpload'
import { withAppointmentDates } from '@/lib/asic/keep'
import { readDirectors } from '@/lib/clients/companyDetails'
import type { Json } from '@/types/database'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/admin/clients/[id]/asic-extract — keep an ASIC extract PDF on the
 * client file (migration 0041, pending Gabby's confirmation).
 *
 * The same checks and parse as the parse-only route (src/lib/asic/readUpload.ts).
 * The file is kept privately in the documents bucket at
 * {client_id}/asic/{uuid}.pdf, for the CVL screens' ⓘ to open at its page,
 * and two dates are written for the CVL forms: the registration date and each
 * director's appointment date. Nothing else on the file changes.
 *
 * An extract for a different ACN from the one on file is refused. Nothing
 * about the file's contents is logged.
 */

const ROUTE = 'POST /api/admin/clients/[id]/asic-extract'

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const supabase = getSupabaseServerClient()

  try {
    const { data: client } = await supabase.from('clients').select('id, archived_at').eq('id', id).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    if (client.archived_at) return NextResponse.json({ error: 'This file is archived.' }, { status: 409 })

    const upload = await readAsicUpload(req, ROUTE)
    if (!upload.ok) return upload.response
    const { extract } = upload

    const { data: company } = await supabase
      .from('company_details')
      .select('acn_number, directors')
      .eq('client_id', id)
      .maybeSingle()
    const acnOnFile = company?.acn_number?.replace(/\D/g, '') || null
    if (acnOnFile && acnOnFile !== extract.acn) {
      console.info(`[${ROUTE}] outcome=other_company`)
      return NextResponse.json(
        { error: 'This extract is for a different company from the one on this file (the ACN does not match).' },
        { status: 409, headers: NO_STORE },
      )
    }

    const filePath = `${id}/asic/${randomUUID()}.pdf`
    const { error: storeError } = await supabase.storage
      .from('documents')
      .upload(filePath, upload.bytes, { contentType: 'application/pdf', upsert: false })
    if (storeError) throw storeError

    const { data: row, error: rowError } = await supabase
      .from('client_asic_extracts')
      .insert({
        client_id: id,
        file_path: filePath,
        page_count: upload.pageCount,
        acn: extract.acn,
        extracted_at: extract.extractedAt,
        section_pages: upload.pages as unknown as Json,
        uploaded_by: staffAuthorName(staff),
      })
      .select('id')
      .single()
    if (rowError || !row) {
      // No row, no file: nothing points at it.
      await supabase.storage.from('documents').remove([filePath])
      throw rowError ?? new Error('Insert returned no row')
    }

    // The two dates for the CVL forms, on the file's own company record.
    let matched = 0
    if (company) {
      const kept = withAppointmentDates(readDirectors(company.directors), extract.directors)
      matched = kept.matched
      const { error: updateError } = await supabase
        .from('company_details')
        .update({
          registration_date: extract.registeredOn,
          directors: kept.directors as unknown as Json,
          updated_at: new Date().toISOString(),
        })
        .eq('client_id', id)
      if (updateError) throw updateError
    }

    console.info(`[${ROUTE}] outcome=ok pages=${upload.pageCount}`)
    return NextResponse.json(
      {
        id: row.id,
        pageCount: upload.pageCount,
        registeredOn: company ? extract.registeredOn : null,
        appointmentDates: matched,
      },
      { status: 201, headers: NO_STORE },
    )
  } catch (err) {
    console.error(`[${ROUTE}] outcome=failed error=${err instanceof Error ? err.name : 'unknown'}`)
    return NextResponse.json({ error: 'Could not keep the ASIC extract on the file.' }, { status: 500 })
  }
}
