import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser, staffAuthorName } from '@/lib/auth/staff'
import { loadPrintedComparison } from '@/lib/printed/store'
import { checkSourceChoice, saveSourceChoice, SourceChoiceError, STATEMENT_KINDS } from '@/lib/printed/sourceChoices'
import { alertFailedCrossChecks } from '@/lib/printed/crossCheckAlerts'

/**
 * POST — "Use this source instead" (Gabby, 25 Nov 2026): which file a period's profit and loss or
 * balance sheet is taken from, when several print it. `statement: 'both'` is "Use the same source
 * for both". `documentId: null` goes back to the rules. Who chose comes from the session; the
 * choice is checked against the comparison as it is now, and kept as a new row (the log).
 */

interface Params {
  params: Promise<{ id: string }>
}

const BodySchema = z.object({
  column: z.string().regex(/^(FY\d{4}|current)$/),
  statement: z.enum(['profit_and_loss', 'balance_sheet', 'both']),
  documentId: z.string().uuid().nullable(),
})

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id: clientId } = await params
    const parsed = BodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { column, statement, documentId } = parsed.data
    const statements = statement === 'both' ? STATEMENT_KINDS : [statement]

    const supabase = getSupabaseServerClient()
    // With earlier years, so a year shown only on request can be chosen too.
    const { comparison } = await loadPrintedComparison(supabase, clientId, { comparativeYears: true })
    checkSourceChoice(comparison, column, statements, documentId)
    await saveSourceChoice(supabase, clientId, staffAuthorName(staff), { column, statements, documentId })
    // The new source may make a cross-check fail: alert once, as after a read.
    const { comparison: after } = await loadPrintedComparison(supabase, clientId, { comparativeYears: true })
    await alertFailedCrossChecks(supabase, clientId, after)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof SourceChoiceError) return NextResponse.json({ error: err.message }, { status: 422 })
    console.error('[POST comparison-sources]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to save the choice' }, { status: 500 })
  }
}
