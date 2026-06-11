/**
 * Shared orchestration for the multi-year financials comparison.
 *
 * The work here is slow (3-5 minutes): OCR + AI extraction over several PDFs,
 * then building + persisting the comparison. It is invoked from two places:
 *
 *   1. The background job runner — runComparisonJob() — called from the
 *      /financials-comparison/start route inside Next.js after(). This is the
 *      path the UI uses: start returns a jobId immediately and the work runs
 *      in the background, updating the financial_comparison_jobs row as it goes.
 *   2. The legacy synchronous routes (extract-financials, financials-comparison)
 *      which now delegate here so there is a single implementation.
 *
 * Nothing in this module does auth — callers are responsible for that.
 */
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { computeFinancialsComparison } from '@/lib/financials/computeComparison'
import { generateFinancialsComparisonSummary } from '@/lib/ai/financialsComparisonSummary'
import { extractFinancialStatementFromPdf } from '@/lib/financials/extractFromPdf'
import type {
  ExtractedFinancialStatement,
  FinancialsComparison,
} from '@/lib/financials/types'

type SupabaseClient = ReturnType<typeof getSupabaseServerClient>

// ─── Public types ────────────────────────────────────────────────────────────

export interface ExtractError {
  documentId: string
  filename: string
  error: string
}

export interface ExtractResult {
  extracted: number
  skipped: number
  errors: ExtractError[]
}

export interface ComparisonPayload {
  clientId: string
  comparison: FinancialsComparison
  aiSummary: string | null
  aiSummaryGeneratedAt: string | null
  generatedAt: string
  statementCount: number
}

export type BuildComparisonResult =
  | { ok: true; payload: ComparisonPayload }
  | { ok: false; status: number; error: string; extractedCount: number }

// ─── Tuning ──────────────────────────────────────────────────────────────────

const PER_DOCUMENT_TIMEOUT_MS = 180_000 // 3 min — Gemini through OpenRouter is faster than Anthropic was
/** Default pause between PDFs. The synchronous route keeps the original 10s for
 *  readable logs; the background job overrides this to a smaller value to leave
 *  more of the function's duration budget for real work. */
const DEFAULT_INTER_DOCUMENT_DELAY_MS = 10_000

// ─── Extraction ────────────────────────────────────────────────────────────────

interface DocumentRow {
  id: string
  file_path: string
  original_filename: string
  doc_category: string
}

interface ExtractOptions {
  documentIds?: string[]
  interDocumentDelayMs?: number
}

/**
 * Extract every (or a named subset of) historical/current financials PDF for a
 * client and persist the canonical line-item data into financial_statements.
 * Documents are processed sequentially; per-document failures are collected and
 * returned rather than aborting the whole batch.
 */
export async function extractAllFinancials(
  clientId: string,
  supabase: SupabaseClient,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const interDocumentDelayMs = options.interDocumentDelayMs ?? DEFAULT_INTER_DOCUMENT_DELAY_MS
  const requestStart = Date.now()

  let docsQuery = supabase
    .from('documents')
    .select('id, file_path, original_filename, doc_category')
    .eq('client_id', clientId)
    .in('doc_category', ['historical_financials', 'current_financials'])
    .order('uploaded_at', { ascending: true })

  if (Array.isArray(options.documentIds) && options.documentIds.length > 0) {
    docsQuery = docsQuery.in('id', options.documentIds)
  }

  const { data: documents, error: docsError } = await docsQuery
  if (docsError) {
    throw new Error(`Failed to load documents: ${docsError.message}`)
  }
  if (!documents || documents.length === 0) {
    throw new Error('No financials documents found for this client.')
  }

  console.log(
    `[extract-financials] processing ${documents.length} document(s) sequentially`,
  )

  let extracted = 0
  let skipped = 0
  const errors: ExtractError[] = []

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i] as DocumentRow

    console.log(
      `[extract-financials] processing ${doc.doc_category} document: ${doc.original_filename}`,
    )

    // Inter-document delay (skip before the first PDF) — light pacing so we
    // don't burst the AI provider; kept small in the background job so most of
    // the duration budget goes to real extraction work.
    if (i > 0 && interDocumentDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, interDocumentDelayMs))
    }

    try {
      const result = await processDocument(doc, i + 1, documents.length, clientId, supabase)
      extracted += result.wrote
      skipped += result.skipped
      if (result.error) {
        errors.push({ documentId: doc.id, filename: doc.original_filename, error: result.error })
      }
    } catch (err) {
      errors.push({
        documentId: doc.id,
        filename: doc.original_filename,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const elapsed = ((Date.now() - requestStart) / 1000).toFixed(1)
  console.log(
    `[extract-financials] DONE client=${clientId} extracted=${extracted} skipped=${skipped} errors=${errors.length} elapsed=${elapsed}s`,
  )

  return { extracted, skipped, errors }
}

interface ProcessResult {
  wrote: number
  skipped: number
  error: string | null
}

async function processDocument(
  doc: DocumentRow,
  index: number,
  total: number,
  clientId: string,
  supabase: SupabaseClient,
): Promise<ProcessResult> {
  const tag = `[extract-financials][${index}/${total}]`
  const start = Date.now()
  console.log(`${tag} START id=${doc.id} file="${doc.original_filename}"`)

  try {
    console.log(`${tag} downloading from storage`)
    const { data: blob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(doc.file_path)
    if (downloadError || !blob) {
      throw new Error(downloadError?.message ?? 'Failed to download file from storage.')
    }

    const arrayBuffer = await blob.arrayBuffer()
    const pdfBytes = new Uint8Array(arrayBuffer)
    const sizeMb = (pdfBytes.length / (1024 * 1024)).toFixed(2)
    console.log(`${tag} downloaded ${sizeMb}MB, calling OpenRouter`)

    const result = await withTimeout(
      extractFinancialStatementFromPdf({
        pdfBytes,
        sourceFilename: doc.original_filename,
      }),
      PER_DOCUMENT_TIMEOUT_MS,
      `extraction timed out after ${PER_DOCUMENT_TIMEOUT_MS / 1000}s`,
    )

    const apiElapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(
      `${tag} extracted ${result.statements.length} statement(s) in ${apiElapsed}s; persisting`,
    )

    let wrote = 0
    let skipped = 0
    for (const statement of result.statements) {
      const action = await upsertWithPrimaryWins({
        supabase,
        clientId,
        documentId: doc.id,
        sourceFilename: doc.original_filename,
        statement,
        rawResponse: result.rawResponse,
      })
      if (action === 'wrote') wrote++
      else skipped++
    }

    const totalElapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`${tag} DONE wrote=${wrote} skipped=${skipped} elapsed=${totalElapsed}s`)

    return { wrote, skipped, error: null }
  } catch (err) {
    const totalElapsed = ((Date.now() - start) / 1000).toFixed(1)
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${tag} FAILED after ${totalElapsed}s: ${message}`)
    return { wrote: 0, skipped: 0, error: message }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms)
    promise
      .then((v) => {
        clearTimeout(t)
        resolve(v)
      })
      .catch((e) => {
        clearTimeout(t)
        reject(e)
      })
  })
}

interface UpsertInput {
  supabase: SupabaseClient
  clientId: string
  documentId: string
  sourceFilename: string
  statement: ExtractedFinancialStatement
  rawResponse: unknown
}

/**
 * Source-column-aware upsert for financial statements.
 *
 * Each (client, financial_year, source_column) is its own slot. The legacy
 * "primary wins over comparative" and "real data wins over empty" guards apply
 * WITHIN a single source_column slot.
 */
async function upsertWithPrimaryWins(input: UpsertInput): Promise<'wrote' | 'skipped'> {
  const { supabase, clientId, documentId, sourceFilename, statement, rawResponse } = input

  const { data: existing } = await supabase
    .from('financial_statements')
    .select('id, source_column, income_statement, balance_sheet')
    .eq('client_id', clientId)
    .eq('financial_year', statement.financialYear)
    .eq('source_column', statement.sourceColumn)
    .maybeSingle()

  // Rule 1: never overwrite a primary with a comparative.
  if (
    existing &&
    existing.source_column === 'primary' &&
    statement.sourceColumn === 'comparative'
  ) {
    return 'skipped'
  }

  // Rule 2: never overwrite a row that has real data with one that doesn't.
  if (existing && hasMeaningfulData(existing.income_statement, existing.balance_sheet)) {
    const newHasData = hasMeaningfulData(
      statement.incomeStatement as unknown as Record<string, unknown>,
      statement.balanceSheet as unknown as Record<string, unknown>,
    )
    if (!newHasData) {
      return 'skipped'
    }
  }

  const payload = {
    client_id: clientId,
    document_id: documentId,
    source_filename: sourceFilename,
    financial_year: statement.financialYear,
    period_end_date: statement.periodEndDate,
    period_start_date: statement.periodStartDate ?? null,
    period_label: statement.periodLabel ?? null,
    source_column: statement.sourceColumn,
    income_statement: statement.incomeStatement as unknown as Record<string, unknown>,
    balance_sheet: statement.balanceSheet as unknown as Record<string, unknown>,
    raw_extraction: rawResponse as Record<string, unknown> | null,
    extraction_warnings: statement.warnings as unknown as Record<string, unknown>[],
    extracted_at: new Date().toISOString(),
    extraction_model: statement.extractionModel ?? null,
  }

  const { error } = await supabase
    .from('financial_statements')
    .upsert(payload, { onConflict: 'client_id,financial_year,source_column' })

  if (error) {
    throw new Error(`Failed to persist statement for FY${statement.financialYear}: ${error.message}`)
  }

  return 'wrote'
}

function hasMeaningfulData(incomeStatement: unknown, balanceSheet: unknown): boolean {
  const is = (incomeStatement ?? {}) as {
    income?: { sales?: number | null }
    totals?: { totalIncome?: number | null }
  }
  const bs = (balanceSheet ?? {}) as {
    totals?: { totalAssets?: number | null; netAssets?: number | null }
  }
  return (
    is.income?.sales != null ||
    is.totals?.totalIncome != null ||
    bs.totals?.totalAssets != null ||
    bs.totals?.netAssets != null
  )
}

// ─── Comparison build ──────────────────────────────────────────────────────────

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

/**
 * Read the extracted statements for a client, compute the comparison, generate
 * the AI narrative (best-effort), and upsert the result into
 * financial_comparisons. Returns the same payload the old synchronous route did.
 */
export async function buildAndPersistComparison(
  clientId: string,
  supabase: SupabaseClient,
): Promise<BuildComparisonResult> {
  const { data: allStatements, error: stmtError } = await supabase
    .from('financial_statements')
    .select('*')
    .eq('client_id', clientId)
    .order('financial_year', { ascending: true })

  if (stmtError) {
    console.error('[financials-comparison] statements query failed', stmtError)
    return { ok: false, status: 500, error: 'Failed to load statements.', extractedCount: 0 }
  }

  const rawStatements = filterToUploadedYears(allStatements ?? [])

  if (!rawStatements || rawStatements.length < 2) {
    return {
      ok: false,
      status: 400,
      error:
        'Need at least 2 extracted annual statements to compare. Run extraction first.',
      extractedCount: rawStatements?.length ?? 0,
    }
  }

  const statements: ExtractedFinancialStatement[] = rawStatements.map((row) => ({
    financialYear: row.financial_year,
    periodEndDate: row.period_end_date,
    sourceFilename: row.source_filename,
    sourceColumn: row.source_column as 'primary' | 'comparative',
    incomeStatement:
      row.income_statement as unknown as ExtractedFinancialStatement['incomeStatement'],
    balanceSheet: row.balance_sheet as unknown as ExtractedFinancialStatement['balanceSheet'],
    rawExtraction:
      (row.raw_extraction as unknown as ExtractedFinancialStatement['rawExtraction']) ?? [],
    warnings: (row.extraction_warnings as unknown as ExtractedFinancialStatement['warnings']) ?? [],
    extractionModel: row.extraction_model ?? undefined,
  }))

  const comparison = computeFinancialsComparison(statements)

  // AI summary — best-effort; a failure here must not fail the job.
  let aiText: string | null = null
  let aiModel: string | null = null
  try {
    const summary = await generateFinancialsComparisonSummary({ comparison })
    aiText = summary.text
    aiModel = summary.model
  } catch (err) {
    console.error('[financials-comparison] AI summary failed', err)
  }

  const now = new Date().toISOString()

  const { error: upsertError } = await supabase.from('financial_comparisons').upsert(
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
    console.error('[financials-comparison] upsert failed', upsertError)
    return { ok: false, status: 500, error: 'Failed to persist comparison.', extractedCount: statements.length }
  }

  return {
    ok: true,
    payload: {
      clientId,
      comparison,
      aiSummary: aiText,
      aiSummaryGeneratedAt: aiText ? now : null,
      generatedAt: now,
      statementCount: statements.length,
    },
  }
}

/**
 * Decide which financial_statements rows belong in the comparison. The truth
 * source for "did the user intend this year?" is the SET of years implied by
 * the uploaded filenames; rows are kept only when their financial_year is in
 * that set AND they carry meaningful data. See the original route comment for
 * the full rationale on mis-tagged primaries vs. borrowed comparatives.
 */
function filterToUploadedYears(allRows: RawStatementRow[]): RawStatementRow[] {
  const uploadedYears = new Set<number>()
  for (const row of allRows) {
    const filenameYear = inferYearFromFilename(row.source_filename)
    if (filenameYear !== null) uploadedYears.add(filenameYear)
  }

  const candidates = allRows.filter((r) => {
    if (!uploadedYears.has(r.financial_year)) return false
    return rowHasMeaningfulData(r)
  })

  const byYear = new Map<number, RawStatementRow>()
  for (const row of candidates) {
    const filenameYear = inferYearFromFilename(row.source_filename)
    const existing = byYear.get(row.financial_year)
    if (!existing) {
      byYear.set(row.financial_year, row)
      continue
    }
    const existingMatches =
      inferYearFromFilename(existing.source_filename) === existing.financial_year
    const newMatches = filenameYear === row.financial_year
    if (newMatches && !existingMatches) {
      byYear.set(row.financial_year, row)
    }
  }

  return Array.from(byYear.values()).sort((a, b) => a.financial_year - b.financial_year)
}

function inferYearFromFilename(filename: string): number | null {
  const match = filename.match(/(?<!\d)(20\d{2})(?!\d)/)
  if (!match) return null
  const y = parseInt(match[1], 10)
  if (y < 2000 || y > new Date().getFullYear() + 1) return null
  return y
}

function rowHasMeaningfulData(row: RawStatementRow): boolean {
  return hasMeaningfulData(row.income_statement, row.balance_sheet)
}

// ─── Background job runner ───────────────────────────────────────────────────

/**
 * Run a comparison job to completion, updating the financial_comparison_jobs
 * row as it progresses. Designed to be called from Next.js after() so it runs
 * in the background after the start route has already returned the jobId.
 *
 * Never throws — every failure path marks the job 'failed' with a message.
 */
export async function runComparisonJob(params: {
  jobId: string
  clientId: string
  mode: 'full' | 'compare'
  supabase: SupabaseClient
}): Promise<void> {
  const { jobId, clientId, mode, supabase } = params

  const markFailed = async (message: string, extractErrors: ExtractError[] = []) => {
    await supabase
      .from('financial_comparison_jobs')
      .update({
        status: 'failed',
        error: message,
        extract_errors: extractErrors as unknown as Record<string, unknown>[],
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  }

  try {
    await supabase
      .from('financial_comparison_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    let extractErrors: ExtractError[] = []
    if (mode === 'full') {
      // Keep pacing light in the background so most of the duration budget goes
      // to extraction rather than idle waiting.
      const ext = await extractAllFinancials(clientId, supabase, { interDocumentDelayMs: 2_000 })
      extractErrors = ext.errors
    }

    const built = await buildAndPersistComparison(clientId, supabase)
    if (!built.ok) {
      await markFailed(built.error, extractErrors)
      return
    }

    await supabase
      .from('financial_comparison_jobs')
      .update({
        status: 'done',
        result: built.payload as unknown as Record<string, unknown>,
        extract_errors: extractErrors as unknown as Record<string, unknown>[],
        error: null,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    console.log(`[comparison-job] DONE job=${jobId} client=${clientId} mode=${mode}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[comparison-job] FAILED job=${jobId} client=${clientId}: ${message}`)
    await markFailed(message)
  }
}
