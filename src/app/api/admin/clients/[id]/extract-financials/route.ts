/**
 * POST /api/admin/clients/[id]/extract-financials
 *
 * Admin-only. Runs the OpenRouter + Gemini 2.5 Flash PDF extractor over
 * uploaded historical-financials documents and persists the canonical
 * line-item data into financial_statements.
 *
 * Performance:
 *   - Documents are extracted SEQUENTIALLY with a 10s delay between PDFs.
 *     Sequential processing keeps server-side logs and error attribution
 *     simple. The 10s buffer is well under Gemini's per-minute rate limits
 *     on the paid tier; the previous 65s delay was sized for Anthropic
 *     Tier 1 and is no longer necessary.
 *   - Each per-document extraction has a 180s safety cap. The OpenAI SDK
 *     itself uses 300s per attempt with 2 retries, so the outer 180s timeout
 *     is a final escape if even the SDK retries don't resolve. Gemini
 *     typically completes a PARKCON-sized PDF in 15-40 seconds.
 *   - Total worst-case elapsed: 4 PDFs × ~60s + 3 delays × 10s ≈ 270s.
 *     maxDuration=300 still gives headroom.
 *   - Per-document progress is logged so a stuck route is visible in the
 *     server terminal.
 *
 * Body (optional): { documentIds?: string[] }
 *   - If omitted, extracts all historical-financials documents for this client.
 *   - If provided, restricts the batch to the named documents.
 *
 * Returns: { extracted: number, skipped: number, errors: [{ documentId, error }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient, getSupabaseAuthClient } from '@/lib/supabase/server'
import { extractFinancialStatementFromPdf } from '@/lib/financials/extractFromPdf'
import type { ExtractedFinancialStatement } from '@/lib/financials/types'

// Vercel serverless functions default to 10s. We need enough headroom for:
//   - Up to 4 sequential PDF extractions @ ~60s each = 240s
//   - 3 inter-document delays @ 10s = 30s
//   - Some headroom for downloads + DB writes
// Total: ~270s. 300s gives modest headroom and fits within Vercel Pro's cap.
// Local dev (Next.js) does not enforce maxDuration.
export const maxDuration = 300

interface Params {
  params: Promise<{ id: string }>
}

const PER_DOCUMENT_TIMEOUT_MS = 180_000 // 3 min — Gemini through OpenRouter is faster than Anthropic was
const INTER_DOCUMENT_DELAY_MS = 10_000 // 10s between PDFs — sequential pacing for log clarity

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

interface ExtractError {
  documentId: string
  filename: string
  error: string
}

interface DocumentRow {
  id: string
  file_path: string
  original_filename: string
}

export async function POST(req: NextRequest, { params }: Params) {
  const requestStart = Date.now()
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: clientId } = await params
    let body: { documentIds?: string[] } = {}
    try {
      body = (await req.json()) as { documentIds?: string[] }
    } catch {
      // optional body
    }

    console.log(`[extract-financials] START client=${clientId}`)

    const supabase = getSupabaseServerClient()
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle()
    if (!client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 })
    }

    let docsQuery = supabase
      .from('documents')
      .select('id, file_path, original_filename')
      .eq('client_id', clientId)
      .eq('doc_category', 'historical_financials')
      .order('uploaded_at', { ascending: true })

    if (Array.isArray(body.documentIds) && body.documentIds.length > 0) {
      docsQuery = docsQuery.in('id', body.documentIds)
    }

    const { data: documents, error: docsError } = await docsQuery
    if (docsError) {
      console.error('[extract-financials] documents query failed', docsError)
      return NextResponse.json({ error: 'Failed to load documents.' }, { status: 500 })
    }
    if (!documents || documents.length === 0) {
      return NextResponse.json(
        { error: 'No historical-financials documents found for this client.' },
        { status: 404 },
      )
    }

    console.log(
      `[extract-financials] processing ${documents.length} document(s) sequentially`,
    )

    let extracted = 0
    let skipped = 0
    const errors: ExtractError[] = []

    // Sequential processing keeps server-side logs and error attribution
    // simple; parallel calls would interleave per-document log lines.
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i] as DocumentRow

      // Inter-document delay (skip before the first PDF) to pace sequential
      // PDF processing — keeps logs readable and gives the operator a clear
      // per-document boundary.
      if (i > 0) {
        const delaySec = Math.round(INTER_DOCUMENT_DELAY_MS / 1000)
        console.log(
          `[extract-financials] waiting ${delaySec}s before next PDF to pace sequential processing`,
        )
        await new Promise((resolve) => setTimeout(resolve, INTER_DOCUMENT_DELAY_MS))
      }

      try {
        const result = await processDocument(
          doc,
          i + 1,
          documents.length,
          clientId,
          supabase,
        )
        extracted += result.wrote
        skipped += result.skipped
        if (result.error) {
          errors.push({
            documentId: doc.id,
            filename: doc.original_filename,
            error: result.error,
          })
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

    return NextResponse.json({ extracted, skipped, errors })
  } catch (err) {
    console.error('[extract-financials] unexpected error', err)
    return NextResponse.json({ error: 'Failed to extract financials.' }, { status: 500 })
  }
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
  supabase: ReturnType<typeof getSupabaseServerClient>,
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

// ─── Upsert with primary-wins precedence ────────────────────────────────────

type SupabaseClient = ReturnType<typeof getSupabaseServerClient>

interface UpsertInput {
  supabase: SupabaseClient
  clientId: string
  documentId: string
  sourceFilename: string
  statement: ExtractedFinancialStatement
  rawResponse: unknown
}

async function upsertWithPrimaryWins(input: UpsertInput): Promise<'wrote' | 'skipped'> {
  const { supabase, clientId, documentId, sourceFilename, statement, rawResponse } = input

  const { data: existing } = await supabase
    .from('financial_statements')
    .select('id, source_column, income_statement, balance_sheet')
    .eq('client_id', clientId)
    .eq('financial_year', statement.financialYear)
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
  // The model has occasionally returned empty-but-correctly-shaped payloads
  // (all values null). Without this guard, a later empty extraction can
  // destroy good data via UNIQUE(client_id, financial_year) upsert.
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
    .upsert(payload, { onConflict: 'client_id,financial_year' })

  if (error) {
    throw new Error(`Failed to persist statement for FY${statement.financialYear}: ${error.message}`)
  }

  return 'wrote'
}

/** True if either the income statement has totalIncome / sales, or the
 *  balance sheet has totalAssets / netAssets. Used to decide whether an
 *  existing row should be protected from an incoming empty extraction. */
function hasMeaningfulData(
  incomeStatement: unknown,
  balanceSheet: unknown,
): boolean {
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
