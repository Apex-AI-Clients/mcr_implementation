import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { DPN_CATEGORY, readAndStoreNotice } from '@/lib/dpn/store'

/**
 * POST — read an uploaded DPN again, for a file uploaded before notices were
 * read automatically, or one whose read failed. Never overwrites a manual
 * entry (409).
 */

interface Params {
  params: Promise<{ id: string; documentId: string }>
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId, documentId } = await params
    const supabase = getSupabaseServerClient()
    const { data: doc } = await supabase
      .from('documents')
      .select('id, client_id, file_path')
      .eq('id', documentId)
      .eq('client_id', clientId)
      .eq('doc_category', DPN_CATEGORY)
      .maybeSingle()
    if (!doc) return NextResponse.json({ error: 'Notice not found' }, { status: 404 })

    const outcome = await readAndStoreNotice(supabase, doc)
    if (outcome.kind === 'kept_manual') {
      return NextResponse.json(
        { error: 'This notice was entered by hand, so it was not read again.' },
        { status: 409 },
      )
    }
    if (outcome.kind === 'failed') {
      return NextResponse.json({ error: 'The notice could not be read. Try again.' }, { status: 500 })
    }
    return NextResponse.json({ status: outcome.status, manualReason: outcome.manualReason })
  } catch (err) {
    console.error('[POST director-penalty-notices/read]', err instanceof Error ? err.name : 'unknown')
    return NextResponse.json({ error: 'The notice could not be read. Try again.' }, { status: 500 })
  }
}
