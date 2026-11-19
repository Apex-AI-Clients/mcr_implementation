import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { loadPrintedComparison } from '@/lib/printed/store'
import { dismissLine, MappingError } from '@/lib/printed/mappingStore'

/**
 * POST — "Not a loan account": staff turning down a possible director loan line on the latest balance
 * sheet (mapping.ts, predictionFinancials; migration 0062). Who answered comes from the session; the
 * line is checked against the comparison as it is now.
 */

interface Params {
  params: Promise<{ id: string }>
}

const BodySchema = z.object({ meaning: z.literal('loan_receivable'), rowKey: z.string().min(1).max(1000) })

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id: clientId } = await params
    const parsed = BodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const supabase = getSupabaseServerClient()
    const { comparison } = await loadPrintedComparison(supabase, clientId)
    const row = comparison.tables.flatMap((t) => t.rows).find((r) => r.key === parsed.data.rowKey)
    if (!row) return NextResponse.json({ error: 'That line is not on the statements any more. Refresh the page.' }, { status: 422 })
    await dismissLine(supabase, clientId, staffAuthorName(staff), { meaning: parsed.data.meaning, rowKey: row.key, label: row.label })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof MappingError) return NextResponse.json({ error: err.message }, { status: 422 })
    console.error('[POST line-dismissals]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save the answer' }, { status: 500 })
  }
}
