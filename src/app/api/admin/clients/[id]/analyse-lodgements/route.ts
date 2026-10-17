import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { analyseAndStoreLodgement, findActivityStatementCsv } from '@/lib/analysis/lodgementStore'

/**
 * POST — analyse the client's activity statement export now, with its AI
 * summary: staff pressed the button on the lodgement page. Automatic runs (on
 * upload) store the figures alone; see lib/analysis/autoRun.ts.
 *
 * The export is found by its content, not its filename.
 */

interface Params {
  params: Promise<{ id: string }>
}

async function requireAdmin() {
  const authClient = await getSupabaseAuthClient()
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error) console.error('[requireAdmin] auth error:', error.message)
  if (!user) return null
  if (user.app_metadata?.role === 'client') return null
  return user
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const supabase = getSupabaseServerClient()

    const { data: client } = await supabase.from('clients').select('id').eq('id', id).maybeSingle()
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    }

    const file = await findActivityStatementCsv(supabase, id)
    if (!file) {
      return NextResponse.json(
        { error: 'No Activity Statement Account CSV uploaded for this client.' },
        { status: 404 },
      )
    }

    const outcome = await analyseAndStoreLodgement(supabase, id, file, { aiSummary: true })
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: 500 })
    }
    const { row, result } = outcome

    return NextResponse.json({
      id: row.id,
      clientId: row.client_id,
      documentId: row.document_id,
      sourceFilename: row.source_filename,
      statementLabel: row.statement_label,
      companyNameInCsv: row.company_name_in_csv,
      rowCount: row.row_count,
      summary: {
        numberOfLateLodgements: row.number_of_late_lodgements,
        cumulativeDaysLate: row.cumulative_days_late,
      },
      dpnRisk: result.dpnRisk,
      debtBreakdown: result.debtBreakdown,
      aiSummary: row.ai_summary,
      aiSummaryGeneratedAt: row.ai_summary_generated_at,
      rows: result.rows,
      warnings: result.warnings,
      analysedAt: row.analysed_at,
    })
  } catch (err) {
    console.error('[POST /api/admin/clients/[id]/analyse-lodgements]', err)
    return NextResponse.json({ error: 'Failed to analyse lodgements.' }, { status: 500 })
  }
}
