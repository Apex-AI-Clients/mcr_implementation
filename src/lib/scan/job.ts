import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { askClaudeImage, scanReadingEnabled } from '@/lib/ai/openrouterClient'
import { SCAN_PAGE_PROMPT } from '@/lib/ai/prompts'
import type { PrintedRead } from '@/lib/printed/types'
import { tesseractEngine } from './ocr'
import { readScannedPdf, type PageReading, type SecondReader } from './readScanned'
export { latestScanJob, scanJobAlive, SCAN_JOB_MAX_AGE_MS, type ScanJob } from './jobState'

/**
 * Server-only. The background reading of a PDF's scanned pages (B3, B8): one
 * job per document and reader version, progress kept in scan_read_jobs, each
 * reader's output and cost in scan_page_readings, the reconciled read in
 * printed_reads (it replaces the 'scan_pending' read).
 *
 * Claude reads at most SCAN_DAILY_PAGE_CAP pages per client per day (Sydney
 * time); past it, or when Claude is unavailable, Tesseract reads alone and
 * every figure says "single reading — check". Nothing but the page image of a
 * scanned statement page is sent, and only through askClaudeImage.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/** Claude pages per client per day (Gabby, 4 Nov 2026). */
export const SCAN_DAILY_PAGE_CAP = 60

/** Claude Sonnet 5.5 list price, US$ per million tokens (input, output), for the cost log. */
const PRICE_PER_MTOK = { in: 2, out: 10 }
export const pageCost = (tokensIn: number, tokensOut: number) => Math.round(((tokensIn * PRICE_PER_MTOK.in + tokensOut * PRICE_PER_MTOK.out) / 1e6) * 10000) / 10000

function sydneyDayStart(now = new Date()): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  // Midnight in Sydney, as an instant: search back from now in hours (DST-safe).
  for (let h = 0; h <= 26; h++) {
    const t = new Date(now.getTime() - h * 3600_000)
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t)
    if (d !== day) return new Date(t.getTime() + 3600_000 - (t.getTime() % 3600_000)).toISOString()
  }
  return new Date(now.getTime() - 24 * 3600_000).toISOString()
}

export async function claudePagesLeftToday(supabase: ServerClient, clientId: string): Promise<number> {
  const { count, error } = await supabase
    .from('scan_page_readings')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('reader', 'claude')
    .gte('created_at', sydneyDayStart())
  if (error) return 0
  return Math.max(0, SCAN_DAILY_PAGE_CAP - (count ?? 0))
}

/**
 * Reads the document's scanned pages and keeps the result. Never throws: a
 * failure is kept on the job and on the read ("could not be read", with why).
 */
export async function runScanJob(
  supabase: ServerClient,
  { clientId, documentId, filePath, readerVersion }: { clientId: string; documentId: string; filePath: string; readerVersion: string },
): Promise<void> {
  const { data: job, error: jobError } = await supabase
    .from('scan_read_jobs')
    .insert({ client_id: clientId, document_id: documentId, reader_version: readerVersion, status: 'running', stage: 'starting' })
    .select('id')
    .single()
  if (jobError || !job) {
    console.error('[scan] could not start a job:', jobError?.message)
    return
  }
  const progress = async (stage: string, done: number, total: number) => {
    await supabase.from('scan_read_jobs').update({ stage, done, total, updated_at: new Date().toISOString() }).eq('id', job.id)
  }
  const ocr = await tesseractEngine()
  try {
    const { data: blob, error } = await supabase.storage.from('documents').download(filePath)
    if (error || !blob) throw new Error('The file could not be downloaded.')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const allowed = scanReadingEnabled() ? await claudePagesLeftToday(supabase, clientId) : 0
    const second: SecondReader = scanReadingEnabled()
      ? (image) => askClaudeImage({ prompt: SCAN_PAGE_PROMPT, image: image.bytes, mediaType: image.mediaType, maxTokens: 16000, label: 'scan-page' })
      : null
    const result = await readScannedPdf(bytes, {
      ocr,
      second,
      secondPagesAllowed: allowed,
      onProgress: (p) => progress(p.stage, p.done, p.total),
    })
    if (!result) throw new Error('No scanned pages were found after all.')
    if (scanReadingEnabled() && allowed < result.read.scan!.pages.filter((p) => p.role === 'statement').length) {
      result.read.scan!.message = `${result.read.scan!.message ?? ''} The daily limit of ${SCAN_DAILY_PAGE_CAP} pages for the second reading was reached.`.trim()
    }
    await keepReadings(supabase, { jobId: job.id, clientId, documentId }, result.readings)
    await keepRead(supabase, { clientId, documentId, readerVersion }, result.read)
    await supabase
      .from('scan_read_jobs')
      .update({ status: 'done', stage: 'done', message: result.read.scan?.message ?? null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', job.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The scanned pages could not be read.'
    console.error('[scan] job failed:', err instanceof Error ? err.name : 'unknown')
    await supabase.from('scan_read_jobs').update({ status: 'failed', message, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', job.id)
  } finally {
    await ocr.close()
  }
}

async function keepReadings(supabase: ServerClient, ids: { jobId: string; clientId: string; documentId: string }, readings: PageReading[]) {
  if (readings.length === 0) return
  const { error } = await supabase.from('scan_page_readings').insert(
    readings.map((r) => ({
      job_id: ids.jobId,
      client_id: ids.clientId,
      document_id: ids.documentId,
      page: r.page,
      reader: r.reader,
      model: r.model ?? null,
      generation_id: r.generationId ?? null,
      tokens_in: r.tokensIn ?? null,
      tokens_out: r.tokensOut ?? null,
      cost_usd: r.reader === 'claude' && r.tokensIn !== undefined ? pageCost(r.tokensIn, r.tokensOut ?? 0) : null,
      output: (r.lines ?? r.answer ?? null) as never,
      error: r.error ?? null,
    })),
  )
  if (error) console.error('[scan] could not keep the page readings:', error.message)
}

async function keepRead(supabase: ServerClient, ids: { clientId: string; documentId: string; readerVersion: string }, read: PrintedRead) {
  const { error } = await supabase.from('printed_reads').upsert({
    document_id: ids.documentId,
    client_id: ids.clientId,
    reader_version: ids.readerVersion,
    status: read.status,
    page_count: read.pageCount,
    statements: read.statements as unknown as never,
    issues: read.issues as unknown as never,
    scan: (read.scan ?? null) as unknown as never,
    read_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Could not keep the read: ${error.message}`)
}
