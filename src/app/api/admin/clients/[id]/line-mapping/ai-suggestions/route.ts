import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadMapping } from '@/lib/printed/mappingStore'
import { suggestMapping } from '@/lib/printed/dictionary'
import { aiSummariesEnabled } from '@/lib/ai/openrouterClient'
import { suggestUnknownLabels } from '@/lib/ai/labelSuggestions'

/**
 * POST — Claude's suggestions for the key figures the dictionary found no
 * line for (labelSuggestions.ts): the printed labels and headings only, no
 * figures. Nothing is stored: staff confirm a suggestion like any other.
 */

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!aiSummariesEnabled()) return NextResponse.json({ suggestions: {} })

  const { id } = await params
  const supabase = getSupabaseServerClient()
  const [{ comparison }, mapping] = await Promise.all([loadPrintedComparison(supabase, id), loadMapping(supabase, id)])
  try {
    return NextResponse.json({ suggestions: await suggestUnknownLabels(comparison, mapping, suggestMapping(comparison)) })
  } catch (err) {
    console.error('[line-mapping ai-suggestions] failed', err instanceof Error ? err.name : 'unknown')
    return NextResponse.json({ error: 'No AI suggestions just now.' }, { status: 502 })
  }
}
