import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { loadStoredReads } from '@/lib/printed/store'
import { saveScanChoice, ScanChoiceError } from '@/lib/scan/choices'

/**
 * PUT — staff correcting a figure Claude read from a scanned page
 * (src/lib/scan): the figure typed in (or Claude's own reading back). Who comes
 * from the session; the line is checked against the file's read as it is now.
 */

interface Params {
  params: Promise<{ id: string }>
}

const BodySchema = z.object({
  documentId: z.string().uuid(),
  rowKey: z.string().min(1).max(1000),
  column: z.number().int().min(0).max(20),
  source: z.enum(['claude', 'typed']),
  value: z.number().finite().nullable(),
})

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id: clientId } = await params
    const parsed = BodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const supabase = getSupabaseServerClient()
    const reads = await loadStoredReads(supabase, clientId)
    const read = reads.get(parsed.data.documentId)?.read ?? null
    await saveScanChoice(supabase, { clientId, ...parsed.data, by: staffAuthorName(staff) }, read)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ScanChoiceError) return NextResponse.json({ error: err.message }, { status: 422 })
    console.error('[PUT scan-choices]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save the choice' }, { status: 500 })
  }
}
