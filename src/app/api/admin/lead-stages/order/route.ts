import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { isCustomStage } from '@/lib/leads/constants'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/admin/lead-stages/order — the tab order on the leads page (0055),
 * from the "Edit stages" panel: every shown stage, built-in and staff-added,
 * in the order Gabby put them. Each takes its place as its position.
 *
 * The whole list or nothing: a list missing a shown stage, or naming one that
 * is not there, is refused, so a stale panel cannot leave tabs out of order.
 * Hidden stages keep their position.
 */

const BodySchema = z.object({
  keys: z.array(z.string().min(1).max(80)).min(1).max(200),
})

export async function PUT(req: NextRequest) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = BodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    const keys = parsed.data.keys

    const supabase = getSupabaseServerClient()
    const { data: rows, error: readError } = await supabase.from('lead_stages').select('key, built_in, hidden_at')
    if (readError) throw readError

    const shown = new Set((rows ?? []).filter((r) => r.built_in || !r.hidden_at).map((r) => r.key))
    const asked = new Set(keys)
    const same = asked.size === keys.length && asked.size === shown.size && keys.every((k) => shown.has(k))
    if (!same) {
      return NextResponse.json({ error: 'The stages have changed since this was opened. Close it and try again.' }, { status: 409 })
    }

    for (const [position, key] of keys.entries()) {
      const { error } = await supabase.from('lead_stages').update({ position }).eq('key', key)
      if (error) throw error
    }
    console.info(`[PUT /api/admin/lead-stages/order] ${keys.length} stages, ${keys.filter(isCustomStage).length} added by staff`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PUT /api/admin/lead-stages/order]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save the order' }, { status: 500 })
  }
}
