import { createHash } from 'node:crypto'
import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { askClaudeImage, claudeModel, scanReadingEnabled } from '@/lib/ai/openrouterClient'
import { SCAN_PAGE_PROMPT } from '@/lib/ai/prompts'
import { parseScanAnswer, type ScanPageAnswer } from './claudeReader'
import { tesseractTitles } from './ocr'
import type { PrintedRead } from '@/lib/printed/types'
import { readScannedPdf, type KeptReading, type PageReading, type ScanReader } from './readScanned'
export { closeDeadScanJobs, latestScanJob, scanJobAlive, SCAN_JOB_MAX_AGE_MS, type ScanJob } from './jobState'

/**
 * Server-only. The background reading of a PDF's scanned pages: Tesseract on
 * our server reads each page's title (which pages are statements), Claude
 * reads the statement pages. One job per document and reader version,
 * progress kept in scan_read_jobs, each transcription (with its cost) in
 * scan_page_readings, the read in printed_reads (it replaces the
 * 'scan_pending' read).
 *
 * Claude transcribes at most SCAN_DAILY_PAGE_CAP pages per client per day
 * (Sydney time). Nothing but the page images of scanned STATEMENT pages is
 * sent, and only through askClaudeImage (CLAUDE.md rule 12).
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/** Pages Claude transcribes per client per day (Gabby, 4 Nov 2026). */
export const SCAN_DAILY_PAGE_CAP = 60

/** Claude Sonnet 5.5 list price, US$ per million tokens (input, output), for the cost log. */
const PRICE_PER_MTOK = { in: 2, out: 10 }
export const pageCost = (tokensIn: number, tokensOut: number) => Math.round(((tokensIn * PRICE_PER_MTOK.in + tokensOut * PRICE_PER_MTOK.out) / 1e6) * 10000) / 10000

/** Which prompt a transcription answered (migration 0046): a changed prompt is never matched with an old answer. */
export const SCAN_PROMPT_VERSION = createHash('sha256').update(SCAN_PAGE_PROMPT).digest('hex').slice(0, 12)

/**
 * Claude's earlier answers for this file's pages, same model and prompt: the
 * latest good one per page. Reused instead of sending the page again. None
 * before migration 0046.
 */
async function kept<T>(supabase: ServerClient, documentId: string, promptVersion: string, model: string, parse: (text: string) => T): Promise<Map<number, KeptReading<T>>> {
  const out = new Map<number, KeptReading<T>>()
  const { data, error } = await supabase
    .from('scan_page_readings')
    .select('page, model, generation_id, output, created_at')
    .eq('document_id', documentId)
    .eq('reader', 'claude')
    .eq('prompt_version', promptVersion)
    .is('error', null)
    .order('created_at', { ascending: false })
  if (error) return out
  for (const r of data ?? []) {
    if (out.has(r.page) || !r.output || r.model !== model) continue
    try {
      out.set(r.page, { answer: parse(JSON.stringify(r.output)), model: r.model, generationId: r.generation_id ?? '' })
    } catch {
      // Not the schema any more: ask again.
    }
  }
  return out
}

export async function keptReadings(supabase: ServerClient, documentId: string) {
  let model: string
  try {
    model = claudeModel('scan')
  } catch {
    return {}
  }
  return { transcriptions: await kept<ScanPageAnswer>(supabase, documentId, SCAN_PROMPT_VERSION, model, parseScanAnswer) }
}

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

/** Transcriptions left today for the client. */
export async function claudePagesLeftToday(supabase: ServerClient, clientId: string): Promise<number> {
  const { count, error } = await supabase
    .from('scan_page_readings')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('reader', 'claude')
    .eq('prompt_version', SCAN_PROMPT_VERSION)
    .gte('created_at', sydneyDayStart())
  if (error) return 0
  return Math.max(0, SCAN_DAILY_PAGE_CAP - (count ?? 0))
}

/** Claude, through the approved OpenRouter client: the transcription of a statement page. */
export function claudeScanReader(): ScanReader | null {
  if (!scanReadingEnabled()) return null
  return {
    transcribe: (image, _page, context) =>
      askClaudeImage({ prompt: SCAN_PAGE_PROMPT.replace('{context}', context), image: image.bytes, mediaType: image.mediaType, maxTokens: 16000, label: 'scan-page' }),
  }
}

/**
 * Reads the document's scanned pages and keeps the result. Never throws: a
 * failure is kept on the job ("could not be read", with why).
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
    // 23505: this file is already being read (migration 0045): that reading carries on, this one stops.
    if (jobError?.code !== '23505') console.error('[scan] could not start a job:', jobError?.message)
    return
  }
  const progress = async (stage: string, done: number, total: number) => {
    await supabase.from('scan_read_jobs').update({ stage, done, total, updated_at: new Date().toISOString() }).eq('id', job.id)
  }
  const titles = await tesseractTitles()
  try {
    const { data: blob, error } = await supabase.storage.from('documents').download(filePath)
    if (error || !blob) throw new Error('The file could not be downloaded.')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const reader = claudeScanReader()
    const result = await readScannedPdf(bytes, {
      titles,
      reader,
      pagesAllowed: reader ? await claudePagesLeftToday(supabase, clientId) : 0,
      reuse: await keptReadings(supabase, documentId),
      onProgress: (p) => progress(p.stage, p.done, p.total),
    })
    if (!result) throw new Error('No scanned pages were found after all.')
    await keepReadings(supabase, { jobId: job.id, clientId, documentId }, result.readings)
    await keepRead(supabase, { clientId, documentId, readerVersion }, result.read)
    await supabase
      .from('scan_read_jobs')
      .update({
        status: result.unread.length ? 'failed' : 'done',
        stage: 'done',
        message: result.read.scan?.message ?? null,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The scanned pages could not be read.'
    console.error('[scan] job failed:', err instanceof Error ? err.name : 'unknown')
    await supabase.from('scan_read_jobs').update({ status: 'failed', message, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', job.id)
  } finally {
    await titles.close()
  }
}

async function keepReadings(supabase: ServerClient, ids: { jobId: string; clientId: string; documentId: string }, readings: PageReading[]) {
  // A reused transcription was kept already (and is not a new page against the daily cap).
  const fresh = readings.filter((r) => !r.reused)
  if (fresh.length === 0) return
  const { error } = await supabase.from('scan_page_readings').insert(
    fresh.map((r) => ({
      job_id: ids.jobId,
      client_id: ids.clientId,
      document_id: ids.documentId,
      page: r.page,
      reader: 'claude',
      model: r.model ?? null,
      generation_id: r.generationId ?? null,
      tokens_in: r.tokensIn ?? null,
      tokens_out: r.tokensOut ?? null,
      cost_usd: r.tokensIn !== undefined ? pageCost(r.tokensIn, r.tokensOut ?? 0) : null,
      output: (r.answer ?? null) as never,
      error: r.error ?? null,
      prompt_version: SCAN_PROMPT_VERSION,
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
