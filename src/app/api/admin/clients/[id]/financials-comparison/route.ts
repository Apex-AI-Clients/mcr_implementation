/**
 * POST /api/admin/clients/[id]/financials-comparison
 *
 * Admin-only. Reads all previously-extracted financial_statements rows for the
 * client, runs computeFinancialsComparison, generates an AI narrative summary
 * (best-effort — failures don't break the response), and upserts the result
 * into financial_comparisons (one row per client_id).
 *
 * Requires that extract-financials has already been run for at least 2 years.
 * Returns 400 if fewer than 2 statements are available.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { computeFinancialsComparison } from '@/lib/financials/computeComparison'
import { generateFinancialsComparisonSummary } from '@/lib/ai/financialsComparisonSummary'
import type {
  ExtractedFinancialStatement,
  FinancialsComparison,
} from '@/lib/financials/types'

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

    const { id: clientId } = await params
    const supabase = getSupabaseServerClient()

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle()
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    }

    // Load extracted statements for this client, FY-ascending.
    const { data: allStatements, error: stmtError } = await supabase
      .from('financial_statements')
      .select('*')
      .eq('client_id', clientId)
      .order('financial_year', { ascending: true })

    if (stmtError) {
      console.error('[POST financials-comparison] statements query failed', stmtError)
      return NextResponse.json({ error: 'Failed to load statements.' }, { status: 500 })
    }

    // Build the comparison view from the years matching uploaded PDFs:
    //   - A year is INCLUDED if it has a primary extraction with data.
    //   - A year with only a comparative-source row is also INCLUDED — that
    //     covers years where Claude mis-tagged the primary (e.g. recorded
    //     it under sourceColumn='comparative' instead of 'primary'). The
    //     filename of a comparative row points back to an UPLOADED PDF, so
    //     this year is still "intended" by the user.
    //   - Rows with no meaningful data are EXCLUDED (e.g. stub extractions
    //     where Claude returned null values).
    //   - Pure-comparative years that came as the "prior-year column" of an
    //     uploaded PDF (e.g. FY21 from a 2022 PDF) are EXCLUDED — they
    //     weren't explicitly uploaded.
    const rawStatements = filterToUploadedYears(allStatements ?? [])

    if (!rawStatements || rawStatements.length < 2) {
      return NextResponse.json(
        {
          error:
            'Need at least 2 extracted annual statements to compare. Click "Extract All Financials" first.',
          extractedCount: rawStatements?.length ?? 0,
        },
        { status: 400 },
      )
    }

    const statements: ExtractedFinancialStatement[] = rawStatements.map((row) => ({
      financialYear: row.financial_year,
      periodEndDate: row.period_end_date,
      sourceFilename: row.source_filename,
      sourceColumn: row.source_column as 'primary' | 'comparative',
      incomeStatement:
        row.income_statement as unknown as ExtractedFinancialStatement['incomeStatement'],
      balanceSheet:
        row.balance_sheet as unknown as ExtractedFinancialStatement['balanceSheet'],
      rawExtraction: (row.raw_extraction as unknown as ExtractedFinancialStatement['rawExtraction']) ?? [],
      warnings:
        (row.extraction_warnings as unknown as ExtractedFinancialStatement['warnings']) ?? [],
      extractionModel: row.extraction_model ?? undefined,
    }))

    const comparison = computeFinancialsComparison(statements)

    // AI summary — best-effort
    let aiText: string | null = null
    let aiModel: string | null = null
    try {
      const summary = await generateFinancialsComparisonSummary({ comparison })
      aiText = summary.text
      aiModel = summary.model
    } catch (err) {
      console.error('[POST financials-comparison] AI summary failed', err)
    }

    const now = new Date().toISOString()

    const { error: upsertError } = await supabase
      .from('financial_comparisons')
      .upsert(
        {
          client_id: clientId,
          financial_years: comparison.years,
          computed: comparison as unknown as Record<string, unknown>,
          ai_summary: aiText,
          ai_summary_generated_at: aiText ? now : null,
          ai_summary_model: aiModel,
          generated_at: now,
        },
        { onConflict: 'client_id' },
      )

    if (upsertError) {
      console.error('[POST financials-comparison] upsert failed', upsertError)
      return NextResponse.json({ error: 'Failed to persist comparison.' }, { status: 500 })
    }

    return NextResponse.json({
      clientId,
      comparison,
      aiSummary: aiText,
      aiSummaryGeneratedAt: aiText ? now : null,
      generatedAt: now,
      statementCount: statements.length,
    } satisfies ComparisonPayload)
  } catch (err) {
    console.error('[POST financials-comparison] unexpected', err)
    return NextResponse.json({ error: 'Failed to compute comparison.' }, { status: 500 })
  }
}

/**
 * Decide which financial_statements rows belong in the comparison.
 *
 * The truth source for "did the user intend this year?" is the SET of
 * filenames in the historical_financials uploads. Each filename usually
 * encodes the year as a 4-digit number. We build that set, then keep only
 * rows whose financial_year falls within it.
 *
 * Why we don't just trust source_column='primary':
 *   - Claude sometimes mis-tags a PDF's primary column as 'comparative'.
 *     The resulting row is real data from an uploaded PDF, just labelled
 *     wrong. We still want it in the view.
 *   - Claude sometimes hallucinates a wrong year on a primary row. That
 *     row carries a filename whose year DOESN'T match, so we drop it.
 *   - The comparative column from an uploaded PDF (e.g. FY21 inside the
 *     FY22 PDF) is real data, but represents a year the user did NOT
 *     upload. Drop those.
 *
 * Rows with no income/balance-sheet data are also dropped — those are
 * stub extractions and shouldn't displace real ones.
 */
function filterToUploadedYears(allRows: RawStatementRow[]): RawStatementRow[] {
  // The set of years implied by the uploaded filenames.
  const uploadedYears = new Set<number>()
  for (const row of allRows) {
    const filenameYear = inferYearFromFilenameForRoute(row.source_filename)
    if (filenameYear !== null) uploadedYears.add(filenameYear)
  }

  // Filter to rows whose financial_year matches an uploaded year and that
  // actually carry data.
  const candidates = allRows.filter((r) => {
    if (!uploadedYears.has(r.financial_year)) return false
    return rowHasMeaningfulData(r)
  })

  // For each year, prefer the row whose source_filename's year MATCHES the
  // financial_year (the "real" extraction for that uploaded PDF). Otherwise
  // accept whatever is available. Resolves the case where Claude wrote two
  // rows for the same FY across different PDFs.
  const byYear = new Map<number, RawStatementRow>()
  for (const row of candidates) {
    const filenameYear = inferYearFromFilenameForRoute(row.source_filename)
    const existing = byYear.get(row.financial_year)
    if (!existing) {
      byYear.set(row.financial_year, row)
      continue
    }
    // Prefer the row whose filename year matches the FY (the PDF "for" that year).
    const existingMatches =
      inferYearFromFilenameForRoute(existing.source_filename) === existing.financial_year
    const newMatches = filenameYear === row.financial_year
    if (newMatches && !existingMatches) {
      byYear.set(row.financial_year, row)
    }
    // Otherwise keep existing.
  }

  return Array.from(byYear.values()).sort((a, b) => a.financial_year - b.financial_year)
}

interface RawStatementRow {
  financial_year: number
  source_column: string
  source_filename: string
  period_end_date: string
  income_statement: unknown
  balance_sheet: unknown
  raw_extraction: unknown
  extraction_warnings: unknown
  extraction_model: string | null
}

function inferYearFromFilenameForRoute(filename: string): number | null {
  // Digit-aware boundary: matches "20XX" anywhere, treating "_" as a separator.
  const match = filename.match(/(?<!\d)(20\d{2})(?!\d)/)
  if (!match) return null
  const y = parseInt(match[1], 10)
  if (y < 2000 || y > new Date().getFullYear() + 1) return null
  return y
}

function rowHasMeaningfulData(row: RawStatementRow): boolean {
  const is = (row.income_statement ?? {}) as {
    income?: { sales?: number | null }
    totals?: { totalIncome?: number | null }
  }
  const bs = (row.balance_sheet ?? {}) as {
    totals?: { totalAssets?: number | null; netAssets?: number | null }
  }
  return (
    is.income?.sales != null ||
    is.totals?.totalIncome != null ||
    bs.totals?.totalAssets != null ||
    bs.totals?.netAssets != null
  )
}

export interface ComparisonPayload {
  clientId: string
  comparison: FinancialsComparison
  aiSummary: string | null
  aiSummaryGeneratedAt: string | null
  generatedAt: string
  statementCount: number
}
