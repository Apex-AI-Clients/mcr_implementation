import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { loadPrintedComparison } from '@/lib/printed/store'
import { MappingError, saveMapping, type MappingSelection } from '@/lib/printed/mappingStore'
import { MEANINGS } from '@/lib/printed/meanings'

/**
 * PUT — staff confirming which printed lines are the revenue, net profit,
 * net assets, ATO-related debt, loan accounts and other creditors
 * (mappingStore.ts). Every meaning answered: lines, or "not printed". Who
 * confirmed comes from the session, never the request; the lines are checked
 * against the comparison as it is now.
 */

interface Params {
  params: Promise<{ id: string }>
}

const Answer = z.union([z.object({ rowKeys: z.array(z.string().min(1).max(1000)).max(50) }), z.object({ none: z.literal(true) })])
const BodySchema = z.object({
  selection: z.object(Object.fromEntries(MEANINGS.map((m) => [m.key, Answer.optional()])) as Record<string, z.ZodOptional<typeof Answer>>),
})

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id: clientId } = await params
    const parsed = BodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const supabase = getSupabaseServerClient()
    const { comparison } = await loadPrintedComparison(supabase, clientId)
    const mapping = await saveMapping(supabase, clientId, staffAuthorName(staff), parsed.data.selection as MappingSelection, comparison)
    return NextResponse.json({ ok: true, saved: mapping.length })
  } catch (err) {
    if (err instanceof MappingError) return NextResponse.json({ error: err.message }, { status: 422 })
    console.error('[PUT line-mapping]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save the mapping' }, { status: 500 })
  }
}
