import { NextRequest, NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { checkAbrRateLimit } from '@/lib/abr/rateLimit'
import { abrGuid, fetchAbnDetails } from '@/lib/abr/service'
import { abrFailureResponse } from '@/lib/abr/routeError'
import { NOT_CONFIGURED } from '@/lib/abr/messages'

export const dynamic = 'force-dynamic'

/**
 * Full registration details for one ABN.
 *
 * Successful lookups are cached in the service layer — see the note there on
 * what that cache is and is not.
 */

const ABN_DIGITS = 11

export async function GET(req: NextRequest) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const guid = abrGuid()
  if (!guid) {
    return NextResponse.json({ error: NOT_CONFIGURED, configured: false }, { status: 503 })
  }

  // Whatever spacing came off a result row or a paste.
  const abn = (req.nextUrl.searchParams.get('abn') ?? '').replace(/\D/g, '')
  if (abn.length !== ABN_DIGITS) {
    return NextResponse.json({ error: `An ABN is ${ABN_DIGITS} digits.` }, { status: 400 })
  }

  const limit = checkAbrRateLimit(staff.id)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many lookups. Try again in a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  try {
    const { details } = await fetchAbnDetails(abn, guid)
    if (!details) {
      return NextResponse.json({ error: 'The ABR has no entity for that ABN.' }, { status: 404 })
    }
    return NextResponse.json({ details })
  } catch (err) {
    return abrFailureResponse('GET /api/abr/abn', err)
  }
}
