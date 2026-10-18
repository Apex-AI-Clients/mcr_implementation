import { describe, it, expect } from 'vitest'
import { lastReadAt } from '../readState'
import { decideWork } from '@/lib/analysis/autoRun'
import type { StoredStatementSlot } from '../types'

/** When each financial statement file was last read. Synthetic data only. */

function slot(doc: string | null, extractedAt: string | null): StoredStatementSlot {
  const half = { data: {} as never, documentId: doc, sourceFilename: null, extractedAt, warnings: [] }
  return {
    id: `s-${doc}`,
    financialYear: 2025,
    periodEndDate: '2025-06-30',
    periodStartDate: null,
    periodLabel: null,
    sourceColumn: 'primary',
    incomeStatement: half,
    balanceSheet: null,
    slotWarnings: [],
    legacy: extractedAt === null,
    extractionModel: null,
  }
}

describe('lastReadAt', () => {
  it('counts a file read before migration 0026 (no extraction record) as read', () => {
    const readAt = lastReadAt([], [slot('old.pdf', '2026-09-01T00:00:00Z')])
    expect(readAt.get('old.pdf')).toBe('2026-09-01T00:00:00Z')
  })

  it('counts a legacy row with no read time as read long ago', () => {
    expect(lastReadAt([], [slot('legacy.pdf', null)]).get('legacy.pdf')).toBe('1970-01-01T00:00:00.000Z')
  })

  it('takes the latest of the record and the halves', () => {
    const readAt = lastReadAt(
      [{ document_id: 'a.pdf', extracted_at: '2026-10-10T00:00:00Z' }],
      [slot('a.pdf', '2026-09-01T00:00:00Z')],
    )
    expect(readAt.get('a.pdf')).toBe('2026-10-10T00:00:00Z')
  })

  it('keeps an automatic run from sending an older file to the model again', () => {
    const work = decideWork({
      dpnDocumentIds: [],
      readNoticeDocumentIds: new Set(),
      activityStatementDocumentId: null,
      analysedDocumentIds: new Set(),
      financialDocuments: [{ id: 'old.pdf', overrideAt: null }],
      extractedAt: lastReadAt([], [slot('old.pdf', '2026-09-01T00:00:00Z')]),
      comparison: { exists: true, staleSince: null },
    })
    expect(work.extract).toEqual([])
    expect(work.compare).toBe(false)
  })
})
