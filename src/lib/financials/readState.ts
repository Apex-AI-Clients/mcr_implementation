import type { StoredStatementSlot } from './types'

/**
 * When each financial statement file was last read. Pure.
 *
 * Its extraction record (financial_document_extractions) says so — but files
 * read before migration 0026 have none: 0026 split their statements into
 * halves without recording the extraction. Such a file still supplies
 * statements, and each half names it and when it was read, so that counts as
 * read too. The comparison page has always counted it that way.
 *
 * Without this, every older file looked unread: the readiness checklist said
 * "Processing" for good, and the next automatic run would have extracted all
 * of them again, sending them to the model a second time.
 */

/** A file that supplies statements but whose read time was never stored. */
const LONG_AGO = '1970-01-01T00:00:00.000Z'

export function lastReadAt(
  extractions: readonly { document_id: string; extracted_at: string }[],
  slots: readonly StoredStatementSlot[],
): Map<string, string> {
  const readAt = new Map<string, string>()
  const note = (documentId: string | null, at: string | null) => {
    if (!documentId) return
    const when = at ?? LONG_AGO
    const before = readAt.get(documentId)
    if (!before || when > before) readAt.set(documentId, when)
  }
  for (const slot of slots) {
    note(slot.incomeStatement?.documentId ?? null, slot.incomeStatement?.extractedAt ?? null)
    note(slot.balanceSheet?.documentId ?? null, slot.balanceSheet?.extractedAt ?? null)
  }
  // The record wins: it is written on every read, including one that stored nothing.
  for (const e of extractions) {
    const before = readAt.get(e.document_id)
    if (!before || e.extracted_at > before) readAt.set(e.document_id, e.extracted_at)
  }
  return readAt
}
