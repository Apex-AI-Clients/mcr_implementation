import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { parseActivityStatementCsv } from '@/lib/analysis/parseActivityStatement'
import { computeLateLodgement } from '@/lib/analysis/computeLateLodgement'
import { generateLodgementAiSummary } from '@/lib/ai/lodgementSummary'

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

    // Verify the client exists
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    }

    // Find the most recent Activity Statement CSV for this client
    const { data: doc } = await supabase
      .from('documents')
      .select('id, file_path, original_filename')
      .eq('client_id', id)
      .eq('doc_category', 'integrated_client_account')
      .ilike('original_filename', '%activity statement%.csv')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!doc) {
      return NextResponse.json(
        { error: 'No Activity Statement Account CSV uploaded for this client.' },
        { status: 404 },
      )
    }

    // Download the file bytes from Supabase Storage server-side
    const { data: blob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(doc.file_path)

    if (downloadError || !blob) {
      console.error('[POST /api/admin/clients/[id]/analyse-lodgements] download error', downloadError)
      return NextResponse.json({ error: 'Failed to download file from storage.' }, { status: 500 })
    }

    const csvText = await blob.text()

    // Parse and compute
    const parsed = parseActivityStatementCsv(csvText)
    const result = computeLateLodgement(parsed)

    // Generate AI summary — skip if no DPN exposure
    let aiText: string | null = null
    let aiModel: string | null = null

    if (result.dpnRisk.totalGrossLate > 0 || result.summary.numberOfLateLodgements > 0) {
      try {
        const aiResult = await generateLodgementAiSummary({
          dpnRisk: result.dpnRisk,
          debtBreakdown: result.debtBreakdown,
          summary: result.summary,
        })
        aiText = aiResult.text
        aiModel = aiResult.model
      } catch (err) {
        console.error('[POST /api/admin/clients/[id]/analyse-lodgements] AI summary failed', err)
      }
    }

    const now = new Date().toISOString()

    // Upsert into lodgement_analyses keyed by document_id
    const { data: upserted, error: upsertError } = await supabase
      .from('lodgement_analyses')
      .upsert(
        {
          client_id: id,
          document_id: doc.id,
          source_filename: doc.original_filename,
          statement_label: parsed.statementLabel,
          company_name_in_csv: parsed.companyName,
          row_count: result.rows.length,
          number_of_late_lodgements: result.summary.numberOfLateLodgements,
          cumulative_days_late: result.summary.cumulativeDaysLate,
          rows: result.rows as unknown as Record<string, unknown>[],
          warnings: result.warnings as unknown as Record<string, unknown>[],
          dpn_risk: result.dpnRisk as unknown as Record<string, unknown>,
          debt_breakdown: result.debtBreakdown as unknown as Record<string, unknown>,
          ai_summary: aiText ?? null,
          ai_summary_generated_at: aiText ? now : null,
          ai_summary_model: aiModel ?? null,
          analysed_at: now,
        },
        { onConflict: 'document_id' },
      )
      .select()
      .single()

    if (upsertError) {
      console.error(
        '[POST /api/admin/clients/[id]/analyse-lodgements] upsert error',
        upsertError.message,
        upsertError.details,
        upsertError.hint,
        upsertError.code,
      )
      return NextResponse.json({ error: 'Failed to persist analysis.' }, { status: 500 })
    }

    return NextResponse.json({
      id: upserted.id,
      clientId: upserted.client_id,
      documentId: upserted.document_id,
      sourceFilename: upserted.source_filename,
      statementLabel: upserted.statement_label,
      companyNameInCsv: upserted.company_name_in_csv,
      rowCount: upserted.row_count,
      summary: {
        numberOfLateLodgements: upserted.number_of_late_lodgements,
        cumulativeDaysLate: upserted.cumulative_days_late,
      },
      dpnRisk: result.dpnRisk,
      debtBreakdown: result.debtBreakdown,
      aiSummary: aiText,
      aiSummaryGeneratedAt: aiText ? now : null,
      rows: result.rows,
      warnings: result.warnings,
      analysedAt: upserted.analysed_at,
    })
  } catch (err) {
    console.error('[POST /api/admin/clients/[id]/analyse-lodgements]', err)
    return NextResponse.json({ error: 'Failed to analyse lodgements.' }, { status: 500 })
  }
}
