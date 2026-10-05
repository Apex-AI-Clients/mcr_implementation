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
 * Per document: the text pre-pass (prepass.ts) says what the file is and
 * where its statements are; documents that are not statements stop there.
 * The rest are extracted, and each column is written half by half
 * (halfWrites.ts), so a P&L file and a Balance Sheet file for the same year
 * fill the same slot instead of overwriting each other. What the pre-pass
 * found is recorded per document in financial_document_extractions.
 *
 * Nothing in this module does auth — callers are responsible for that.
 */
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { generateFinancialsComparisonSummary } from '@/lib/ai/financialsComparisonSummary'
import { extractFinancialStatementFromPdf } from '@/lib/financials/extractFromPdf'
import { assembleComparison, entityIsTrust } from '@/lib/financials/assembleComparison'
import { type CompanyDetailsForCheck, type DocumentRecordForCheck } from '@/lib/financials/checks'
import { planDocument } from '@/lib/financials/documentPlan'
import { planSlotWrite, type WritingDocument } from '@/lib/financials/halfWrites'
import { runFinancialsPrepass, type FinancialsPrepass } from '@/lib/financials/prepass'
import { loadStoredSlots } from '@/lib/financials/storedStatements'
import type {
  ExtractedFinancialStatement,
  ExtractionWarning,
  FinancialDocumentKind,
  FinancialsComparison,
  HeadingEntity,
  StoredStatementSlot,
} from '@/lib/financials/types'
import type { Json } from '@/types/database'

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
  uploaded_at: string | null
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
    .select('id, file_path, original_filename, doc_category, uploaded_at')
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

  // When each of the client's documents was uploaded, so a half already stored
  // from another file is replaced only by a more recent upload — also when
  // only a subset of documents is being re-extracted.
  const { data: allDocs } = await supabase
    .from('documents')
    .select('id, uploaded_at')
    .eq('client_id', clientId)
  const uploadedAt = new Map((allDocs ?? []).map((d) => [d.id, d.uploaded_at ?? null]))
  const uploadedAtOf = (documentId: string) => uploadedAt.get(documentId) ?? null

  // A trust pays no tax itself: its net profit after tax is its profit before tax.
  const isTrust = entityIsTrust(await loadCompanyDetails(supabase, clientId), [])

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
      const result = await processDocument(doc, i + 1, documents.length, clientId, supabase, uploadedAtOf, isTrust)
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
  uploadedAtOf: (documentId: string) => string | null,
  isTrust: boolean,
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

    // Our own read of the text layer first: what the file is, and where.
    const prepass = await runFinancialsPrepass(pdfBytes)
    const plan = planDocument(prepass)
    console.log(
      `${tag} downloaded ${sizeMb}MB; pre-pass kind=${prepass.classification.kind} failure=${prepass.failure ?? 'none'} encrypted=${prepass.encrypted}`,
    )

    if (!plan.extract) {
      await recordDocumentExtraction(supabase, { clientId, documentId: doc.id, prepass, warnings: plan.warnings })
      console.log(`${tag} SKIPPED (${prepass.classification.kind}) — nothing stored`)
      return { wrote: 0, skipped: 0, error: null }
    }

    console.log(`${tag} calling OpenRouter`)
    const result = await withTimeout(
      extractFinancialStatementFromPdf({
        pdfBytes,
        sourceFilename: doc.original_filename,
        prepass,
        entityIsTrust: isTrust,
      }),
      PER_DOCUMENT_TIMEOUT_MS,
      `extraction timed out after ${PER_DOCUMENT_TIMEOUT_MS / 1000}s`,
    )

    const apiElapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(
      `${tag} extracted ${result.statements.length} statement(s) in ${apiElapsed}s; persisting`,
    )

    const document: WritingDocument = {
      id: doc.id,
      filename: doc.original_filename,
      uploadedAt: doc.uploaded_at,
    }
    let wrote = 0
    let skipped = 0
    for (const statement of result.statements) {
      const decisions = await writeStatementHalves({ supabase, clientId, document, statement, uploadedAtOf })
      for (const decision of Object.values(decisions)) {
        if (decision === 'written') wrote++
        else if (decision === 'kept_newer_upload') skipped++
      }
    }

    await recordDocumentExtraction(supabase, {
      clientId,
      documentId: doc.id,
      prepass,
      warnings: [...plan.warnings, ...result.documentWarnings],
      rawResponse: result.rawResponse,
      model: result.model,
    })

    const totalElapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`${tag} DONE halves wrote=${wrote} kept-newer=${skipped} elapsed=${totalElapsed}s`)

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

/**
 * Write one extracted column into its slot, half by half (see halfWrites.ts).
 * Read-then-write without a lock: a client has one extraction job at a time
 * (the start route refuses a second), so nothing races this.
 */
async function writeStatementHalves(input: {
  supabase: SupabaseClient
  clientId: string
  document: WritingDocument
  statement: ExtractedFinancialStatement
  uploadedAtOf: (documentId: string) => string | null
}) {
  const { supabase, clientId, document, statement, uploadedAtOf } = input

  const { data: existing, error: readError } = await supabase
    .from('financial_statements')
    .select('*')
    .eq('client_id', clientId)
    .eq('financial_year', statement.financialYear)
    .eq('source_column', statement.sourceColumn)
    .maybeSingle()
  if (readError) {
    throw new Error(`Failed to read statement for FY${statement.financialYear}: ${readError.message}`)
  }

  const plan = planSlotWrite({
    clientId,
    existing,
    statement,
    document,
    uploadedAtOf,
    now: new Date().toISOString(),
  })

  if (plan.op === 'insert') {
    const { error } = await supabase.from('financial_statements').insert(plan.values)
    if (error) throw new Error(`Failed to persist statement for FY${statement.financialYear}: ${error.message}`)
  } else if (plan.op === 'update') {
    const { error } = await supabase.from('financial_statements').update(plan.values).eq('id', plan.id)
    if (error) throw new Error(`Failed to persist statement for FY${statement.financialYear}: ${error.message}`)
  }
  return plan.decisions
}

/** What the pre-pass found about a document, and its document-level warnings. */
async function recordDocumentExtraction(
  supabase: SupabaseClient,
  input: {
    clientId: string
    documentId: string
    prepass: FinancialsPrepass
    warnings: ExtractionWarning[]
    rawResponse?: unknown
    model?: string
  },
): Promise<void> {
  const { clientId, documentId, prepass, warnings, rawResponse, model } = input
  const c = prepass.classification
  const { error } = await supabase.from('financial_document_extractions').upsert(
    {
      document_id: documentId,
      client_id: clientId,
      kind: c.kind,
      page_map: c.pages.map((p) => ({ page: p.page, class: p.class, ...(p.section ? { section: p.section } : {}) })) as unknown as Json,
      heading_years: [...c.headingYears, ...(c.currentPeriodYear !== null ? [c.currentPeriodYear] : [])],
      heading_entity: c.entity as unknown as Json,
      encrypted: prepass.encrypted,
      warnings: warnings as unknown as Json,
      raw_response: (rawResponse ?? null) as Json,
      model: model ?? null,
      extracted_at: new Date().toISOString(),
    },
    { onConflict: 'document_id' },
  )
  // The statements are already stored; losing this record only loses the
  // coverage details, so it is logged rather than failing the document.
  if (error) console.error(`[extract-financials] failed to record extraction for ${documentId}: ${error.message}`)
}

// ─── Comparison build ──────────────────────────────────────────────────────────

/**
 * Read the extracted statements for a client, compute the comparison, generate
 * the AI narrative (best-effort), and upsert the result into
 * financial_comparisons. Returns the same payload the old synchronous route did.
 */
export async function buildAndPersistComparison(
  clientId: string,
  supabase: SupabaseClient,
): Promise<BuildComparisonResult> {
  let slots: StoredStatementSlot[]
  try {
    slots = await loadStoredSlots(supabase, clientId)
  } catch (err) {
    console.error('[financials-comparison] statements query failed', err)
    return { ok: false, status: 500, error: 'Failed to load statements.', extractedCount: 0 }
  }

  // One statement per annual FY, each half from the best source (the year's
  // own file, else the next year's comparative column), plus the current period.
  const [records, company] = await Promise.all([
    loadDocumentRecords(supabase, clientId),
    loadCompanyDetails(supabase, clientId),
  ])

  // Corrections first, then the figures, the checks — and the AI summary below
  // is built from this comparison only (see assembleComparison.ts).
  const assembled = assembleComparison({ slots, records, company })
  if (!assembled.ok) {
    return {
      ok: false,
      status: 400,
      error:
        'Need at least 2 extracted annual statements to compare. Run extraction first.',
      extractedCount: assembled.statementCount,
    }
  }
  const { comparison, statementCount } = assembled

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
      // Rebuilt from the documents as they are now.
      stale_since: null,
    },
    { onConflict: 'client_id' },
  )

  if (upsertError) {
    console.error('[financials-comparison] upsert failed', upsertError)
    return { ok: false, status: 500, error: 'Failed to persist comparison.', extractedCount: statementCount }
  }

  return {
    ok: true,
    payload: {
      clientId,
      comparison,
      aiSummary: aiText,
      aiSummaryGeneratedAt: aiText ? now : null,
      generatedAt: now,
      statementCount,
    },
  }
}

/**
 * What the pre-pass recorded about each of the client's financials documents,
 * for the document and entity checks. A failed read only loses those checks.
 */
async function loadDocumentRecords(
  supabase: SupabaseClient,
  clientId: string,
): Promise<DocumentRecordForCheck[]> {
  const [{ data: records, error }, { data: documents }] = await Promise.all([
    supabase
      .from('financial_document_extractions')
      .select('document_id, kind, heading_entity, warnings')
      .eq('client_id', clientId),
    supabase.from('documents').select('id, original_filename').eq('client_id', clientId),
  ])
  if (error) {
    console.error('[financials-comparison] document records query failed', error)
    return []
  }
  const names = new Map((documents ?? []).map((d) => [d.id, d.original_filename]))
  return (records ?? []).map((r) => ({
    documentId: r.document_id,
    filename: names.get(r.document_id) ?? 'A document',
    kind: r.kind as FinancialDocumentKind,
    headingEntity: (r.heading_entity as unknown as HeadingEntity | null) ?? null,
    warnings: Array.isArray(r.warnings) ? (r.warnings as unknown as ExtractionWarning[]) : [],
  }))
}

async function loadCompanyDetails(
  supabase: SupabaseClient,
  clientId: string,
): Promise<CompanyDetailsForCheck | null> {
  const { data, error } = await supabase
    .from('company_details')
    .select('entity_type, company_name, abn_number, trust_name, trust_abn_number')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) console.error('[financials-comparison] company details query failed', error)
  if (!data) return null
  return {
    entityType: data.entity_type,
    companyName: data.company_name,
    abnNumber: data.abn_number,
    trustName: data.trust_name,
    trustAbnNumber: data.trust_abn_number,
  }
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
