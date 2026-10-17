import type { ClientFileForDpn } from './checks'
import { noticeDeadline, noticeIssues, toStoredNotice, type NoticeRow, type StoredNotice } from './stored'

/**
 * What the client page's Director Penalty Notices card shows, worked out on
 * the server from the documents, the stored notices, the client's file and
 * the "none issued" tick. Pure.
 */

export interface DpnNoticeView {
  documentId: string
  filename: string
  /** Null until the file has been read. */
  notice: StoredNotice | null
  /** Plain-English warnings: review reasons and checks against the file. */
  issues: string[]
  /** ISO date: issue date + 21 days. */
  deadline: string | null
}

export interface DpnPanelData {
  notices: DpnNoticeView[]
  /** Who ticked "No director penalty notice has been issued", and when. */
  noneIssued: { by: string; at: string } | null
  /** Left when an upload cleared the tick. */
  clearedNote: string | null
  /** Today in Sydney, ISO, for days remaining. */
  todayIso: string
}

export function buildDpnPanel(input: {
  documents: readonly { id: string; originalFilename: string }[]
  noticeRows: readonly NoticeRow[]
  client: {
    no_dpn_confirmed_at: string | null
    no_dpn_confirmed_by: string | null
    no_dpn_cleared_note: string | null
  }
  file: ClientFileForDpn
  todayIso: string
}): DpnPanelData {
  const byDocument = new Map(input.noticeRows.map((row) => [row.document_id, toStoredNotice(row)]))
  return {
    notices: input.documents.map((doc) => {
      const notice = byDocument.get(doc.id) ?? null
      return {
        documentId: doc.id,
        filename: doc.originalFilename,
        notice,
        issues: notice ? noticeIssues(notice, input.file) : [],
        deadline: notice ? noticeDeadline(notice) : null,
      }
    }),
    noneIssued:
      input.client.no_dpn_confirmed_at && input.client.no_dpn_confirmed_by
        ? { by: input.client.no_dpn_confirmed_by, at: input.client.no_dpn_confirmed_at }
        : null,
    // ?? null: before migration 0030 the client row has no such column.
    clearedNote: input.client.no_dpn_cleared_note ?? null,
    todayIso: input.todayIso,
  }
}

/** Today's date in Sydney, as YYYY-MM-DD. */
export function sydneyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Cents as dollars: 1234567 -> "$12,345.67". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
