import type { Database } from '@/types/database'
import { toStoredSlot, warningHalf, type FinancialStatementRow } from './halves'
import type {
  ExtractedFinancialStatement,
  ExtractionWarning,
  StatementHalfKey,
  StoredHalf,
} from './types'

/**
 * How one extracted column is written to its slot (client, FY, source column),
 * half by half. Pure: the caller reads the existing row, applies the plan, and
 * nothing here touches the database.
 *
 * Per half:
 *   - Not in this document's column: the stored half is left alone. A P&L
 *     file never touches the balance sheet, and vice versa.
 *   - Nothing stored yet, or stored from this same document: written.
 *   - Stored from another document: the more recent UPLOAD wins. A re-uploaded
 *     corrected file replaces the old one's half; re-running extraction over
 *     the old file afterwards does not put it back.
 *
 * A legacy row (written whole, before 0026 or by the old code during the
 * release window) is converted the first time it is written: each of its
 * halves takes the row's document as owner if it holds real data, and a stub
 * half is cleared.
 *
 * Every half written stamps its own extracted_at. The release-window guard
 * trigger relies on that to tell this code's writes from the old code's.
 */

type Insert = Database['public']['Tables']['financial_statements']['Insert']
type Update = Database['public']['Tables']['financial_statements']['Update']

export interface WritingDocument {
  id: string
  filename: string
  /** documents.uploaded_at; null when unknown (treated as newest). */
  uploadedAt: string | null
}

export type HalfDecision = 'written' | 'not_in_document' | 'kept_newer_upload'

export type SlotWritePlan =
  | { op: 'insert'; values: Insert; decisions: Record<StatementHalfKey, HalfDecision> }
  | { op: 'update'; id: string; values: Update; decisions: Record<StatementHalfKey, HalfDecision> }
  | { op: 'skip'; decisions: Record<StatementHalfKey, HalfDecision> }

const HALVES: StatementHalfKey[] = ['income_statement', 'balance_sheet']

const COLUMNS = {
  income_statement: {
    data: 'income_statement',
    documentId: 'is_document_id',
    filename: 'is_source_filename',
    extractedAt: 'is_extracted_at',
    warnings: 'is_warnings',
  },
  balance_sheet: {
    data: 'balance_sheet',
    documentId: 'bs_document_id',
    filename: 'bs_source_filename',
    extractedAt: 'bs_extracted_at',
    warnings: 'bs_warnings',
  },
} as const

function storedHalf(slot: ReturnType<typeof toStoredSlot> | null, half: StatementHalfKey) {
  if (!slot) return null
  return (half === 'income_statement' ? slot.incomeStatement : slot.balanceSheet) as StoredHalf<unknown> | null
}

/** The column's warnings that belong to one half: its own, plus any that name neither half. */
function warningsFor(warnings: ExtractionWarning[], half: StatementHalfKey): ExtractionWarning[] {
  return warnings.filter((w) => {
    const of = warningHalf(w.section)
    return of === half || of === null
  })
}

function decide(
  half: StatementHalfKey,
  present: boolean,
  stored: StoredHalf<unknown> | null,
  document: WritingDocument,
  uploadedAtOf: (documentId: string) => string | null,
): HalfDecision {
  if (!present) return 'not_in_document'
  if (!stored || stored.documentId === null || stored.documentId === document.id) return 'written'
  const ownerUploadedAt = uploadedAtOf(stored.documentId)
  if (ownerUploadedAt === null || document.uploadedAt === null) return 'written'
  return document.uploadedAt >= ownerUploadedAt ? 'written' : 'kept_newer_upload'
}

export function planSlotWrite(input: {
  clientId: string
  existing: FinancialStatementRow | null
  statement: ExtractedFinancialStatement
  document: WritingDocument
  uploadedAtOf: (documentId: string) => string | null
  now: string
}): SlotWritePlan {
  const { clientId, existing, statement, document, uploadedAtOf, now } = input
  const slot = existing ? toStoredSlot(existing) : null
  const present = statement.present ?? { income_statement: true, balance_sheet: true }

  const decisions = {} as Record<StatementHalfKey, HalfDecision>
  for (const half of HALVES) {
    decisions[half] = decide(half, present[half], storedHalf(slot, half), document, uploadedAtOf)
  }
  const writes = HALVES.filter((half) => decisions[half] === 'written')
  if (writes.length === 0) return { op: 'skip', decisions }

  const values: Record<string, unknown> = {
    // The legacy whole-row columns still name the last file written, so the
    // old code reading during the release window always finds a filename.
    document_id: document.id,
    source_filename: document.filename,
    extracted_at: now,
    extraction_model: statement.extractionModel ?? null,
  }

  for (const half of writes) {
    const c = COLUMNS[half]
    values[c.data] = half === 'income_statement' ? statement.incomeStatement : statement.balanceSheet
    values[c.documentId] = document.id
    values[c.filename] = document.filename
    values[c.extractedAt] = now
    values[c.warnings] = warningsFor(statement.warnings, half)
  }

  // The P&L names the period (and a current period's start); a balance sheet
  // alone only sets the end date, and only when no P&L is there to set it.
  const writesIncome = writes.includes('income_statement')
  if (!existing || writesIncome || !slot?.incomeStatement) {
    values.period_end_date = statement.periodEndDate
  }
  if (!existing || writesIncome) {
    values.period_start_date = statement.periodStartDate ?? null
    values.period_label = statement.periodLabel ?? null
  }

  if (!existing) {
    for (const half of HALVES) {
      if (writes.includes(half)) continue
      const c = COLUMNS[half]
      values[c.data] = null
    }
    return {
      op: 'insert',
      decisions,
      values: {
        ...(values as Insert),
        client_id: clientId,
        financial_year: statement.financialYear,
        source_column: statement.sourceColumn,
        extraction_warnings: [],
      } as Insert,
    }
  }

  // First write to a legacy row: give its other half an owner, or clear it.
  if (slot?.legacy) {
    for (const half of HALVES) {
      if (writes.includes(half)) continue
      const c = COLUMNS[half]
      const kept = storedHalf(slot, half)
      if (kept) {
        values[c.documentId] = kept.documentId
        values[c.filename] = kept.sourceFilename
        values[c.extractedAt] = kept.extractedAt
        values[c.warnings] = kept.warnings
      } else {
        values[c.data] = null
        values[c.documentId] = null
        values[c.filename] = null
        values[c.extractedAt] = null
        values[c.warnings] = []
      }
    }
  }

  return { op: 'update', id: existing.id, decisions, values: values as Update }
}
