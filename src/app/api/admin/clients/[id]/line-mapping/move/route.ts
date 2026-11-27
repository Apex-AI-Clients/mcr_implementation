import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { loadPrintedComparison } from '@/lib/printed/store'
import { MappingError, moveLoanLine } from '@/lib/printed/mappingStore'

/**
 * POST — "Move it": a stored loan line the sign-aware section rule puts on the other side, moved there
 * by staff (mappingStore.ts moveLoanLine). Who moved it comes from the session; the server checks the
 * rule really puts the line on the side asked for.
 */

interface Params {
  params: Promise<{ id: string }>
}

const Side = z.enum(['loan_receivable', 'loan_payable'])
const BodySchema = z
  .object({ rowKey: z.string().min(1).max(1000), from: Side, to: Side })
  .refine((b) => b.from !== b.to, { message: 'from and to must differ' })

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id: clientId } = await params
    const parsed = BodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const supabase = getSupabaseServerClient()
    const { comparison } = await loadPrintedComparison(supabase, clientId)
    await moveLoanLine(supabase, clientId, staffAuthorName(staff), parsed.data, comparison)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof MappingError) return NextResponse.json({ error: err.message }, { status: 422 })
    console.error('[POST line-mapping/move]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to move the line' }, { status: 500 })
  }
}
