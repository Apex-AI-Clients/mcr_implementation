import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { StoreRefusedError, undoImport } from '@/lib/sbr/import/store'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/sbr/case-imports/[id]/undo — staff only. "Undo this upload".
 *
 * In one transaction (sbr_undo_case_import, migration 0028): the cases the
 * upload added are deleted, the values its corrections and details replaced
 * are put back, and the upload is marked undone. Refused when a later upload
 * that is still in force changed the same cases: that one must be undone first.
 */

const ROUTE = 'POST /api/admin/sbr/case-imports/[id]/undo'

const REFUSALS = {
  not_found: { status: 404, error: 'Upload not found.' },
  undone: { status: 409, error: 'This upload is already undone.' },
  later_upload: {
    status: 409,
    error: 'A later upload changed some of the same cases. Undo that upload first.',
  },
  changed: { status: 409, error: 'The stored cases changed. Reload and try again.' },
} as const

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: REFUSALS.not_found.error }, { status: 404 })
  }

  try {
    const result = await undoImport(getSupabaseServerClient(), id, staffAuthorName(staff))
    console.info(`[${ROUTE}] outcome=undone deleted=${result.deleted} restored=${result.restored}`)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof StoreRefusedError) {
      const refusal = REFUSALS[err.refusal]
      console.info(`[${ROUTE}] outcome=${err.refusal}`)
      return NextResponse.json({ error: refusal.error }, { status: refusal.status })
    }
    console.error(`[${ROUTE}] outcome=failed error=${err instanceof Error ? err.name : 'unknown'}`)
    return NextResponse.json(
      { error: 'The upload could not be undone. Nothing was changed.' },
      { status: 500 },
    )
  }
}
