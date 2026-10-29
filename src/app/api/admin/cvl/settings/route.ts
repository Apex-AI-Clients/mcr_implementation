import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { isSettingKey, loadCvlSettings, settingValue } from '@/lib/cvl/settings'

/**
 * GET /api/admin/cvl/settings — every CVL setting, and which are confirmed.
 * PUT /api/admin/cvl/settings — one setting: { key, value, confirmed }.
 *
 * Values are checked against their setting (settings.ts); null clears one,
 * which leaves its boxes on the forms blank. "Confirmed" is Gabby's say-so.
 */

const Body = z.object({ key: z.string(), value: z.unknown(), confirmed: z.boolean() })

export async function GET() {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await loadCvlSettings(getSupabaseServerClient()))
}

export async function PUT(req: NextRequest) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = Body.safeParse(await req.json().catch(() => null))
    if (!body.success || !isSettingKey(body.data.key)) return NextResponse.json({ error: 'Unknown setting' }, { status: 400 })

    let value
    try {
      value = settingValue(body.data.key, body.data.value)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid value' }, { status: 400 })
    }

    const supabase = getSupabaseServerClient()
    const { error } = await supabase.from('cvl_settings').upsert(
      {
        key: body.data.key,
        value,
        // Nothing to confirm while it is blank.
        confirmed: value === null ? false : body.data.confirmed,
        updated_by: staffAuthorName(staff),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    )
    if (error) throw error
    return NextResponse.json(await loadCvlSettings(supabase))
  } catch (err) {
    console.error('[PUT /api/admin/cvl/settings]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save the setting' }, { status: 500 })
  }
}
