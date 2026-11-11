import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireStaffUser } from '@/lib/auth/staff'
import { runRawStateRenormalise, runStateBackfill } from '@/lib/leads/stateBackfill'

export const dynamic = 'force-dynamic'
// Re-reads each lead from Meta one at a time.
export const maxDuration = 60

/**
 * ONE-OFF, Nov 2026. Two State repairs, in this order:
 *
 *  1. `form`: re-read every enquiry from Facebook form 1751128836351174 from
 *     Meta and fill State where all three State columns are empty. Must run
 *     before early February 2027, when Meta stops returning these leads.
 *  2. `rawText`: re-read State text stored as unrecognised with the current
 *     normaliser (no Meta call); update only rows that now read as one state.
 *
 * Staff session only. A dry run unless the body says `{ "apply": true }`, so a
 * stray call changes nothing. Answers with counts only — no answers, names or
 * ids. Delete this route once it has run.
 */

const BodySchema = z.object({ apply: z.boolean().optional() }).strict()

export async function POST(req: NextRequest) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const raw = await req.text()
    const parsed = BodySchema.safeParse(raw.trim() ? JSON.parse(raw) : {})
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const dryRun = parsed.data.apply !== true
    const form = await runStateBackfill({ dryRun })
    const rawText = await runRawStateRenormalise({ dryRun })
    const result = { dryRun, form, rawText }
    console.info(`[leads/backfill-state] ${JSON.stringify(result)}`)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'Body was not valid JSON' }, { status: 400 })
    }
    console.error('[leads/backfill-state] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 })
  }
}
