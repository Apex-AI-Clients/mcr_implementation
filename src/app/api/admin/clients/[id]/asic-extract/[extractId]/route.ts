import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string; extractId: string }>
}

/**
 * GET /api/admin/clients/[id]/asic-extract/[extractId]?page=2 — opens a kept
 * ASIC extract (migration 0041) at a page: a signed link of 300 seconds, made
 * when the ⓘ is clicked, never a public one.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, extractId } = await params
  const supabase = getSupabaseServerClient()

  const { data: row } = await supabase
    .from('client_asic_extracts')
    .select('file_path, page_count')
    .eq('id', extractId)
    .eq('client_id', id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'ASIC extract not found' }, { status: 404 })

  const { data, error } = await supabase.storage.from('documents').createSignedUrl(row.file_path, 300)
  if (error || !data?.signedUrl) {
    console.error('[GET /api/admin/clients/[id]/asic-extract/[extractId]] sign failed')
    return NextResponse.json({ error: 'Could not open the ASIC extract' }, { status: 500 })
  }
  const page = Number(req.nextUrl.searchParams.get('page'))
  const anchor = Number.isInteger(page) && page >= 1 && page <= row.page_count ? `#page=${page}` : ''
  return NextResponse.redirect(`${data.signedUrl}${anchor}`, 302)
}
