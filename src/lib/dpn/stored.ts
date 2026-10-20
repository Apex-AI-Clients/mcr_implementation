import { z } from 'zod'
import { formatAcn } from '@/lib/asic/fill'
import type { Database, Json } from '@/types/database'
import { checkDirectorPenaltyNotice, dpnDeadline, type ClientFileForDpn, type DpnCheck } from './checks'
import { sumRows } from './parse'
import { DPN_TYPE_LABEL, type DpnAmounts, type DpnManualReason, type DpnParseResult, type DpnRow, type DpnType } from './types'

/**
 * Notices as stored (director_penalty_notices, migration 0030): the row a
 * parse result becomes, the row read back, and the plain-English issues shown
 * on a notice. Pure, so safe in components and tests.
 */

/** Bump when the parser changes what it reads, so stored notices can be re-read. */
export const DPN_PARSER_VERSION = 1

type NoticeTable = Database['public']['Tables']['director_penalty_notices']
export type NoticeRow = NoticeTable['Row']
export type NoticeFields = Omit<NoticeTable['Insert'], 'id' | 'client_id' | 'document_id' | 'created_at' | 'updated_at'>

export type StoredManualReason = DpnManualReason | 'pdf_unreadable' | 'not_a_dpn'
export type NoticeStatus = 'read' | 'needs_review' | 'needs_manual'
export type NoticeSource = 'parsed' | 'manual'

/** Something on a complete notice that a person must look at. */
export type DpnReviewReason = { code: 'negative_amount'; rowIndexes: number[] }

export interface StoredNotice {
  id: string
  documentId: string
  source: NoticeSource
  status: NoticeStatus
  manualReason: StoredManualReason | null
  reviewReasons: DpnReviewReason[]
  reference: string | null
  issuedOn: string | null
  type: DpnType | null
  companyName: string | null
  acn: string | null
  directorName: string | null
  rows: DpnRow[]
  totals: DpnAmounts | null
  enteredBy: string | null
  enteredAt: string | null
}

const RowSchema = z.object({
  periodFrom: z.string(),
  periodTo: z.string(),
  column2: z.number().int(),
  column3: z.number().int(),
  column4: z.number().int(),
  column5: z.number().int(),
})

const ReviewReasonSchema = z.object({
  code: z.literal('negative_amount'),
  rowIndexes: z.array(z.number().int()),
})

/** Rows with a negative figure in any column. */
export function negativeRowIndexes(rows: readonly DpnRow[]): number[] {
  return rows.flatMap((row, index) =>
    [row.column2, row.column3, row.column4, row.column5].some((value) => value < 0) ? [index] : [],
  )
}

/**
 * What a parse becomes, as columns. A parse that read everything but found a
 * negative figure is kept, and flagged for review: no notice has shown one
 * yet, so the format is not trusted.
 */
export function noticeFieldsFromParse(
  result: DpnParseResult | { kind: 'pdf_unreadable' },
): NoticeFields {
  const base = { source: 'parsed', parser_version: DPN_PARSER_VERSION, entered_by: null, entered_at: null }

  if (result.kind === 'pdf_unreadable' || result.kind === 'not_a_dpn') {
    return {
      ...base,
      status: 'needs_manual',
      manual_reason: result.kind,
      review_reasons: [],
      ...fieldColumns({}),
    }
  }

  if (result.kind === 'needs_manual') {
    return {
      ...base,
      status: 'needs_manual',
      manual_reason: result.reason,
      review_reasons: [],
      ...fieldColumns(result.partial),
    }
  }

  const negatives = negativeRowIndexes(result.notice.rows)
  const reviewReasons: DpnReviewReason[] =
    negatives.length > 0 ? [{ code: 'negative_amount', rowIndexes: negatives }] : []
  return {
    ...base,
    status: reviewReasons.length > 0 ? 'needs_review' : 'read',
    manual_reason: null,
    review_reasons: reviewReasons as unknown as Json,
    ...fieldColumns(result.notice),
  }
}

/** The notice's own fields, as columns. Rows and totals travel together. */
export function fieldColumns(notice: Partial<{
  reference: string
  issuedOn: string
  type: DpnType
  companyName: string
  acn: string
  directorName: string
  rows: DpnRow[]
}>) {
  const rows = notice.rows ?? []
  const totals = rows.length > 0 ? sumRows(rows) : null
  return {
    reference: notice.reference ?? null,
    issued_on: notice.issuedOn ?? null,
    notice_type: notice.type ?? null,
    company_name: notice.companyName ?? null,
    acn: notice.acn ?? null,
    director_name: notice.directorName ?? null,
    rows: rows as unknown as Json,
    total_column2: totals?.column2 ?? null,
    total_column3: totals?.column3 ?? null,
    total_column4: totals?.column4 ?? null,
    total_column5: totals?.column5 ?? null,
  }
}

export function toStoredNotice(row: NoticeRow): StoredNotice {
  const rows = z.array(RowSchema).safeParse(row.rows)
  const reasons = z.array(ReviewReasonSchema).safeParse(row.review_reasons)
  const hasTotals =
    row.total_column2 !== null &&
    row.total_column3 !== null &&
    row.total_column4 !== null &&
    row.total_column5 !== null
  return {
    id: row.id,
    documentId: row.document_id,
    source: row.source as NoticeSource,
    status: row.status as NoticeStatus,
    manualReason: row.manual_reason as StoredManualReason | null,
    reviewReasons: reasons.success ? reasons.data : [],
    reference: row.reference,
    issuedOn: row.issued_on,
    type: row.notice_type as DpnType | null,
    companyName: row.company_name,
    acn: row.acn,
    directorName: row.director_name,
    rows: rows.success ? rows.data : [],
    totals: hasTotals
      ? {
          column2: Number(row.total_column2),
          column3: Number(row.total_column3),
          column4: Number(row.total_column4),
          column5: Number(row.total_column5),
        }
      : null,
    enteredBy: row.entered_by,
    enteredAt: row.entered_at,
  }
}

const MANUAL_REASON_TEXT: Record<StoredManualReason, string> = {
  sgc: 'Super guarantee charge notices are entered by hand until we have seen one.',
  table_unreadable: "The notice's table could not be read.",
  missing_fields: 'Some details could not be found on the notice.',
  pdf_unreadable: 'The PDF could not be opened. It may be damaged, password-protected or a scan.',
  not_a_dpn: "This file doesn't look like a director penalty notice.",
}

export function describeManualReason(reason: StoredManualReason): string {
  return MANUAL_REASON_TEXT[reason]
}

function periodText(row: Pick<DpnRow, 'periodFrom' | 'periodTo'>): string {
  return `${row.periodFrom} to ${row.periodTo}`
}

/**
 * Everything on a notice that needs a person's attention, in plain English:
 * its review reasons, and the checks against itself and the client's file. A
 * mismatch with the file is a warning on the notice, never a rejection — the
 * notice still counts until staff resolve it.
 */
export function noticeIssues(notice: StoredNotice, file: ClientFileForDpn): string[] {
  const issues: string[] = []

  for (const reason of notice.reviewReasons) {
    if (reason.code === 'negative_amount') {
      const rows = reason.rowIndexes.map((i) => i + 1).join(', ')
      issues.push(
        `Row${reason.rowIndexes.length > 1 ? 's' : ''} ${rows} show${reason.rowIndexes.length > 1 ? '' : 's'} a negative amount. No notice has shown one before, so check the figures against the PDF.`,
      )
    }
  }

  if (notice.status === 'needs_manual' || !notice.acn || !notice.directorName) return issues

  const checks: DpnCheck[] = checkDirectorPenaltyNotice(
    { acn: notice.acn, directorName: notice.directorName, rows: notice.rows },
    file,
  )
  for (const check of checks) {
    switch (check.code) {
      case 'row_does_not_add_up':
        issues.push(
          `Row ${check.rowIndex + 1} (${periodText(check)}): the unpaid amount is not the notified and not-notified amounts added together.`,
        )
        break
      case 'acn_invalid':
        issues.push(`The ACN on this notice (${formatAcn(notice.acn)}) fails its check digit. Check it against the PDF.`)
        break
      case 'acn_not_on_file':
        issues.push(`This notice is for ACN ${formatAcn(notice.acn)}, but the client file has no ACN to compare with.`)
        break
      case 'acn_mismatch':
        issues.push(
          `This notice is for ACN ${formatAcn(notice.acn)}, but the client file has ACN ${formatAcn(file.acn ?? '')}.`,
        )
        break
      case 'no_directors_on_file':
        issues.push(`This notice is addressed to ${notice.directorName}, but the client file lists no directors.`)
        break
      case 'director_not_on_file':
        issues.push(`This notice is addressed to ${notice.directorName}, who is not among the directors on the client file.`)
        break
    }
  }
  return issues
}

/** "PAYG withholding", or null before the type is known. */
export function noticeTypeLabel(notice: Pick<StoredNotice, 'type'>): string | null {
  return notice.type ? DPN_TYPE_LABEL[notice.type] : null
}

export function noticeDeadline(notice: Pick<StoredNotice, 'issuedOn'>): string | null {
  return notice.issuedOn ? dpnDeadline(notice.issuedOn) : null
}
