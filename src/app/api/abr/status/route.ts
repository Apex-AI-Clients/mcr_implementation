import { NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { isAbrConfigured } from '@/lib/abr/service'

export const dynamic = 'force-dynamic'

/**
 * Is company lookup available on this deployment?
 *
 * The UI has to hide the lookup control entirely when ABR_GUID is unset, and
 * the only honest way for a browser to know that is to ask. The alternative —
 * a NEXT_PUBLIC_ mirror of the flag — is two variables that can disagree, and
 * the one the browser reads would be the one that is wrong.
 *
 * Says whether a key exists, never what it is, and only to signed-in staff.
 */
export async function GET() {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({ configured: isAbrConfigured() })
}
