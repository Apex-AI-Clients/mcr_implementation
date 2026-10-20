import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { ManualNoticeSchema } from '@/lib/dpn/manualEntry'
import { DPN_PARSER_VERSION, fieldColumns } from '@/lib/dpn/stored'
import { DPN_CATEGORY } from '@/lib/dpn/store'

/**
 * PUT — a notice entered (or corrected) by hand, for one uploaded DPN.
 *
 * Stored as source 'manual' with who and when, and shown as "entered
 * manually" everywhere. Totals are worked out here from the rows, never taken
 * from the request. A later automatic re-read never overwrites it.
 */

interface Params {
  params: Promise<{ id: string; documentId: string }>
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId, documentId } = await params
    const parsed = ManualNoticeSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    const { data: doc } = await supabase
      .from('documents')
      .select('id')
      .eq('id', documentId)
      .eq('client_id', clientId)
      .eq('doc_category', DPN_CATEGORY)
      .maybeSingle()
    if (!doc) return NextResponse.json({ error: 'Notice not found' }, { status: 404 })

    const { error } = await supabase.from('director_penalty_notices').upsert(
      {
        client_id: clientId,
        document_id: documentId,
        source: 'manual',
        status: 'read',
        manual_reason: null,
        review_reasons: [],
        parser_version: DPN_PARSER_VERSION,
        entered_by: staffAuthorName(staff),
        entered_at: new Date().toISOString(),
        ...fieldColumns(parsed.data),
      },
      { onConflict: 'document_id' },
    )
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PUT director-penalty-notices]', err instanceof Error ? err.name : 'unknown')
    return NextResponse.json({ error: 'Failed to save the notice' }, { status: 500 })
  }
}
