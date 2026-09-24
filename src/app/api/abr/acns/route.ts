import { NextRequest, NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { checkAbrRateLimit } from '@/lib/abr/rateLimit'
import { MAX_ACN_BATCH, abrGuid, fetchAcnsForAbns } from '@/lib/abr/service'
import { NOT_CONFIGURED } from '@/lib/abr/messages'

export const dynamic = 'force-dynamic'

/**
 * GET /api/abr/acns?abns=12345678901,98765432109
 *
 * The ACNs behind a page of name-search results, so each suggestion can show
 * one. A separate call rather than part of the search, so the matches render
 * straight away and the ACNs fill in behind them.
 *
 * Counts as one lookup against the rate limit, like the search it follows.
 * Answers `{ acns: { [abn]: acn } }` — see fetchAcnsForAbns for what an empty
 * or absent entry means.
 */

const ABN_DIGITS = 11

export async function GET(req: NextRequest) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const guid = abrGuid()
  if (!guid) {
    return NextResponse.json({ error: NOT_CONFIGURED, configured: false }, { status: 503 })
  }

  const abns = (req.nextUrl.searchParams.get('abns') ?? '')
    .split(',')
    .map((abn) => abn.replace(/\D/g, ''))
    .filter(Boolean)

  if (abns.length === 0 || abns.length > MAX_ACN_BATCH) {
    return NextResponse.json(
      { error: `Send between 1 and ${MAX_ACN_BATCH} ABNs.` },
      { status: 400 },
    )
  }
  if (abns.some((abn) => abn.length !== ABN_DIGITS)) {
    return NextResponse.json({ error: `An ABN is ${ABN_DIGITS} digits.` }, { status: 400 })
  }

  const limit = checkAbrRateLimit(staff.id)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many lookups. Try again in a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  // Never throws: per-ABN failures are simply absent from the answer.
  return NextResponse.json({ acns: await fetchAcnsForAbns(abns, guid) })
}
