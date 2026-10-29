import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { CVL_STATUSES, statusUpdate, toCvlCase } from '@/lib/cvl/cases'

/**
 * PATCH /api/admin/cvl/[caseId]/status — Draft → Forms prepared → Printed.
 *
 * Each step is stamped with its date; a step back clears the later dates
 * (cases.ts). Setting the status it already has changes nothing.
 */

const Body = z.object({ status: z.enum(CVL_STATUSES) })

interface Params {
  params: Promise<{ caseId: string }>
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Unknown status' }, { status: 400 })

    const { caseId } = await params
    const supabase = getSupabaseServerClient()
    const { data: row, error: readError } = await supabase.from('cvl_cases').select('*').eq('id', caseId).maybeSingle()
    if (readError) throw readError
    if (!row) return NextResponse.json({ error: 'CVL file not found' }, { status: 404 })

    const current = toCvlCase(row)
    const update = statusUpdate(current, parsed.data.status)
    if (!update) return NextResponse.json({ case: current })

    const { data: saved, error } = await supabase.from('cvl_cases').update(update).eq('id', caseId).select('*').single()
    if (error) throw error
    return NextResponse.json({ case: toCvlCase(saved) })
  } catch (err) {
    console.error('[PATCH /api/admin/cvl/[caseId]/status]', err instanceof Error ? err.message : JSON.stringify(err))
    return NextResponse.json({ error: 'Failed to update the status' }, { status: 500 })
  }
}
