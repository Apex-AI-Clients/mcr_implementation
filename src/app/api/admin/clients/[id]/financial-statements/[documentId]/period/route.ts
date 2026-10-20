import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { FINANCIAL_STATEMENT_CATEGORIES } from '@/lib/constants'

/**
 * POST — staff setting one financial statement file's year, and whether it is
 * annual or a current period, in place of what its headings say. Or clearing
 * that, to go back to the headings.
 *
 * Saved on the document (migration 0031) with who and when, and applied the
 * next time the file is extracted. The comparison is marked stale until then,
 * so it is never shown as if the change were already in it. The page starts
 * that extraction for this one file straight after.
 */

interface Params {
  params: Promise<{ id: string; documentId: string }>
}

const BodySchema = z.union([
  z.object({
    kind: z.enum(['annual', 'current_period']),
    financialYear: z.number().int().min(2000).max(2100),
  }),
  z.object({ clear: z.literal(true) }),
])

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId, documentId } = await params
    const parsed = BodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Choose a year and a type.' }, { status: 400 })

    const supabase = getSupabaseServerClient()
    const update =
      'clear' in parsed.data
        ? { fs_override_kind: null, fs_override_fy: null, fs_override_by: null, fs_override_at: null }
        : {
            fs_override_kind: parsed.data.kind,
            fs_override_fy: parsed.data.financialYear,
            fs_override_by: staffAuthorName(staff),
            fs_override_at: new Date().toISOString(),
          }

    const { data, error } = await supabase
      .from('documents')
      .update(update)
      .eq('id', documentId)
      .eq('client_id', clientId)
      .in('doc_category', FINANCIAL_STATEMENT_CATEGORIES)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'File not found' }, { status: 404 })

    // Not applied until the file is extracted again.
    const { error: staleError } = await supabase
      .from('financial_comparisons')
      .update({ stale_since: new Date().toISOString() })
      .eq('client_id', clientId)
      .is('stale_since', null)
    if (staleError) console.error('[financial-statements/period] marking stale failed', staleError.code)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST financial-statements/period]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
