import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { PdfTooLongError, PdfUnreadableError, readDirectorPenaltyNotice } from './extractText'
import { noticeFieldsFromParse, type NoticeStatus, type StoredManualReason } from './stored'

/**
 * Server-only. Reading an uploaded notice into director_penalty_notices, and
 * the "No director penalty notice has been issued" tick.
 *
 * Logs carry ids and outcomes only — never a field from the notice. The PDF
 * stays where it was uploaded, in the client's private document storage.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export const DPN_CATEGORY = 'director_penalty_notices'

export type ReadOutcome =
  | { kind: 'stored'; status: NoticeStatus; manualReason: StoredManualReason | null }
  /** Staff entered or corrected it by hand; a re-read never overwrites that. */
  | { kind: 'kept_manual' }
  | { kind: 'failed' }

/**
 * Read one uploaded DPN and store what it says. Safe to call again: it
 * replaces an earlier automatic read, but never a manual entry.
 */
export async function readAndStoreNotice(
  supabase: ServerClient,
  doc: { id: string; client_id: string; file_path: string },
): Promise<ReadOutcome> {
  const { data: existing } = await supabase
    .from('director_penalty_notices')
    .select('source')
    .eq('document_id', doc.id)
    .maybeSingle()
  if (existing?.source === 'manual') return { kind: 'kept_manual' }

  const { data: blob, error: downloadError } = await supabase.storage
    .from('documents')
    .download(doc.file_path)
  if (downloadError || !blob) {
    console.error('[dpn] download failed', { documentId: doc.id })
    return { kind: 'failed' }
  }

  let fields
  try {
    const result = await readDirectorPenaltyNotice(new Uint8Array(await blob.arrayBuffer()))
    fields = noticeFieldsFromParse(result)
  } catch (err) {
    if (!(err instanceof PdfUnreadableError) && !(err instanceof PdfTooLongError)) {
      // The message is pdf.js's own and carries no notice text, but log the
      // kind only, to be sure.
      console.error('[dpn] read threw', { documentId: doc.id, error: err instanceof Error ? err.name : 'unknown' })
    }
    fields = noticeFieldsFromParse({ kind: 'pdf_unreadable' })
  }

  const { error } = await supabase
    .from('director_penalty_notices')
    .upsert({ ...fields, client_id: doc.client_id, document_id: doc.id }, { onConflict: 'document_id' })
  if (error) {
    console.error('[dpn] store failed', { documentId: doc.id, code: error.code })
    return { kind: 'failed' }
  }

  console.info('[dpn] read', { documentId: doc.id, status: fields.status, reason: fields.manual_reason })
  return {
    kind: 'stored',
    status: fields.status as NoticeStatus,
    manualReason: (fields.manual_reason ?? null) as StoredManualReason | null,
  }
}

const NOTE_DATE = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Australia/Sydney',
})

/** "Cleared automatically on 17 Oct 2026 when …". */
export function clearedNote(clearedAt: Date, confirmedBy: string, confirmedAt: string): string {
  return (
    `"No director penalty notice has been issued" was cleared automatically on ` +
    `${NOTE_DATE.format(clearedAt)}, when a director penalty notice was uploaded. ` +
    `It had been ticked by ${confirmedBy} on ${NOTE_DATE.format(new Date(confirmedAt))}.`
  )
}

/**
 * A notice has been uploaded, so "none issued" can no longer be true. Clears
 * the tick, if set, and leaves a note saying who had ticked it and when.
 */
export async function clearNoneIssued(supabase: ServerClient, clientId: string): Promise<void> {
  const { data: client } = await supabase
    .from('clients')
    .select('no_dpn_confirmed_at, no_dpn_confirmed_by')
    .eq('id', clientId)
    .maybeSingle()
  if (!client?.no_dpn_confirmed_at || !client.no_dpn_confirmed_by) return

  const now = new Date()
  const { error } = await supabase
    .from('clients')
    .update({
      no_dpn_confirmed_at: null,
      no_dpn_confirmed_by: null,
      no_dpn_cleared_at: now.toISOString(),
      no_dpn_cleared_note: clearedNote(now, client.no_dpn_confirmed_by, client.no_dpn_confirmed_at),
    })
    .eq('id', clientId)
  if (error) console.error('[dpn] clearing the none-issued tick failed', { clientId, code: error.code })
}
