import { NextRequest, NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { checkAbrRateLimit } from '@/lib/abr/rateLimit'
import { abrGuid, searchAbrNames } from '@/lib/abr/service'
import { abrFailureResponse } from '@/lib/abr/routeError'
import { NOT_CONFIGURED } from '@/lib/abr/messages'

export const dynamic = 'force-dynamic'

/**
 * Company name search against the Australian Business Register.
 *
 * A proxy, not an API of our own: the only reason it exists is that ABR_GUID
 * is registered to the practice and must not be served to a browser.
 *
 * Staff-only. The matcher in src/proxy.ts skips /api, so the guard is here.
 */

/** Below this, ABR returns noise and the call is not worth making. */
const MIN_TERM_LENGTH = 3

export async function GET(req: NextRequest) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const guid = abrGuid()
  if (!guid) {
    return NextResponse.json({ error: NOT_CONFIGURED, configured: false }, { status: 503 })
  }

  const name = (req.nextUrl.searchParams.get('name') ?? '').trim()
  if (name.length < MIN_TERM_LENGTH) {
    return NextResponse.json(
      { error: `Enter at least ${MIN_TERM_LENGTH} characters to search.` },
      { status: 400 },
    )
  }

  const limit = checkAbrRateLimit(staff.id)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many lookups. Try again in a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  try {
    return NextResponse.json(await searchAbrNames(name, guid))
  } catch (err) {
    // Classified rather than flattened, and the search term is deliberately
    // left out of the log line.
    return abrFailureResponse('GET /api/abr/search', err)
  }
}
