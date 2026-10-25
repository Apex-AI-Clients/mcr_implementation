import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { FINANCIAL_STATEMENT_CATEGORIES } from '@/lib/constants'
import { PdfTooLongError, PdfUnreadableError, readPrintedStatements } from './readPdf'
import { buildPrintedComparison, type ComparisonDocument, type PrintedComparison } from './compare'
import type { PrintedRead } from './types'

/**
 * Server-only. A client's financial statement PDFs, read as printed and kept
 * in printed_reads (migration 0033), and the comparison built from them.
 *
 * A PDF is read when it has no read by the current READER_VERSION, so a
 * reader fix reaches every client the next time their page opens. Reading is
 * on our own server, in memory: no file or figure is sent anywhere. If the
 * read cannot be kept (the table not there yet), it is still used.
 */

/** Bump when the reader changes what it reads: every PDF is then read again. */
export const READER_VERSION = '2026-10-24.2'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export interface FinancialDocumentRow {
  id: string
  original_filename: string
  uploaded_at: string
  file_path: string
}

export interface StoredRead {
  documentId: string
  read: PrintedRead
  readAt: string
}

export async function loadFinancialDocuments(supabase: ServerClient, clientId: string): Promise<FinancialDocumentRow[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, original_filename, uploaded_at, file_path')
    .eq('client_id', clientId)
    .in('doc_category', FINANCIAL_STATEMENT_CATEGORIES as string[])
    .order('uploaded_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as FinancialDocumentRow[]
}

/** Reads by the current reader. A missing table reads as none. */
export async function loadStoredReads(supabase: ServerClient, clientId: string): Promise<Map<string, StoredRead>> {
  const { data, error } = await supabase
    .from('printed_reads')
    .select('document_id, reader_version, status, page_count, statements, issues, read_at')
    .eq('client_id', clientId)
  const out = new Map<string, StoredRead>()
  if (error) return out
  for (const row of data ?? []) {
    if (row.reader_version !== READER_VERSION) continue
    out.set(row.document_id, {
      documentId: row.document_id,
      readAt: row.read_at,
      read: {
        status: row.status as PrintedRead['status'],
        pageCount: row.page_count ?? 0,
        statements: row.statements as unknown as PrintedRead['statements'],
        issues: row.issues as unknown as PrintedRead['issues'],
      },
    })
  }
  return out
}

/** Downloads and reads one PDF, then keeps the read. Never throws: a failure is a 'failed' read with why. */
export async function readAndStore(supabase: ServerClient, clientId: string, doc: FinancialDocumentRow): Promise<StoredRead> {
  const readAt = new Date().toISOString()
  let read: PrintedRead
  try {
    const { data: blob, error } = await supabase.storage.from('documents').download(doc.file_path)
    if (error || !blob) throw new Error('The file could not be downloaded.')
    read = await readPrintedStatements(new Uint8Array(await blob.arrayBuffer()))
  } catch (err) {
    const message =
      err instanceof PdfTooLongError
        ? 'This PDF is too long to read.'
        : err instanceof PdfUnreadableError
          ? 'This PDF could not be opened (password-protected or damaged).'
          : err instanceof Error
            ? err.message
            : 'The file could not be read.'
    read = { status: 'failed', pageCount: 0, statements: [], issues: [{ kind: 'unreadable_file', page: null, text: null, message }] }
    const { error } = await supabase.from('printed_reads').upsert({
      document_id: doc.id,
      client_id: clientId,
      reader_version: READER_VERSION,
      status: 'failed',
      page_count: null,
      statements: [],
      issues: read.issues as unknown as never,
      read_at: readAt,
    })
    if (error) console.error('[printed-reads] could not keep a failed read:', error.message)
    return { documentId: doc.id, read, readAt }
  }
  const { error } = await supabase.from('printed_reads').upsert({
    document_id: doc.id,
    client_id: clientId,
    reader_version: READER_VERSION,
    status: read.status,
    page_count: read.pageCount,
    statements: read.statements as unknown as never,
    issues: read.issues as unknown as never,
    read_at: readAt,
  })
  if (error) console.error('[printed-reads] could not keep the read:', error.message)
  return { documentId: doc.id, read, readAt }
}

export interface LoadedComparison {
  comparison: PrintedComparison
  /** The latest read: the comparison as built now, for the "I've checked these figures" tick. */
  builtAt: string | null
  /** Financial documents with no read by the current reader. */
  unread: number
}

/**
 * The comparison from the stored reads. With `readMissing`, PDFs without a
 * current read are read now first (each well under a second); without it,
 * they are left out and counted in `unread`.
 */
export async function loadPrintedComparison(
  supabase: ServerClient,
  clientId: string,
  { readMissing = false, force = false }: { readMissing?: boolean; force?: boolean } = {},
): Promise<LoadedComparison> {
  const [docs, stored] = await Promise.all([loadFinancialDocuments(supabase, clientId), loadStoredReads(supabase, clientId)])
  const reads = new Map(stored)
  if (readMissing || force) {
    for (const doc of docs) {
      if (force || !reads.has(doc.id)) reads.set(doc.id, await readAndStore(supabase, clientId, doc))
    }
  }
  const input: ComparisonDocument[] = docs.map((d) => ({
    documentId: d.id,
    filename: d.original_filename,
    uploadedAt: d.uploaded_at,
    read: reads.get(d.id)?.read ?? null,
  }))
  const builtAt = [...reads.values()].map((r) => r.readAt).sort().pop() ?? null
  return { comparison: buildPrintedComparison(input), builtAt, unread: docs.filter((d) => !reads.has(d.id)).length }
}
