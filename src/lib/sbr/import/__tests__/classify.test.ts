// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { classifyRows } from '../classify'
import type { CaseRecord, ExistingCase, ImportPreview } from '../types'
import { existingCase, validated } from './fixtures'

const TABS: ImportPreview['tabs'] = []
const classify = (rows: ReturnType<typeof validated>[], existing: ExistingCase[] = []) =>
  classifyRows(rows, existing, TABS)

/** The stored cases after a preview is confirmed with these ticks. */
function afterImport(existing: ExistingCase[], preview: ImportPreview, ticked: string[] = []): ExistingCase[] {
  const out = existing.map((e) => ({ ...e, record: { ...e.record } }))
  for (const c of preview.corrections) {
    if (!ticked.includes(c.key) || c.caseId === null) continue
    const target = out.find((e) => e.id === c.caseId)!
    target.record = { ...target.record, ...c.values } as CaseRecord
  }
  for (const d of preview.detailsAdded) {
    const target = out.find((e) => e.id === d.caseId)!
    target.record = { ...target.record, ...d.values }
  }
  preview.added.forEach((n, i) =>
    out.push({ id: `added-${i}`, name_key: n.key, excluded: false, excluded_reason: null, record: n.record }),
  )
  return out
}

describe('classifyRows: against the stored cases', () => {
  it('sorts rows into new, already have and correction', () => {
    const stored = [
      existingCase({ clientName: 'Alpha Pty Ltd' }),
      existingCase({ clientName: 'Bravo Pty Ltd' }),
    ]
    const preview = classify(
      [
        validated({ clientName: 'Alpha Pty Ltd' }),
        validated({ clientName: 'BRAVO PTY LIMITED', sbrPayment: '95,000' }), // 92.1%: accepted
        validated({ clientName: 'Charlie Pty Ltd' }),
      ],
      stored,
    )
    expect(preview.counts).toEqual({ added: 1, corrections: 1, already_have: 1, details_added: 2, rejected: 0 })
    expect(preview.added[0].record.client_name).toBe('Charlie Pty Ltd')
    expect(preview.alreadyHave[0].clientName).toBe('Alpha Pty Ltd')

    const [correction] = preview.corrections
    expect(correction.caseId).toBe(stored[1].id)
    expect(correction.changes).toEqual([
      { column: 'sbr_payment', label: 'SBR payment', from: '$100,000.00', to: '$95,000.00' },
    ])
    // It carries what the case holds now, so a change since the preview is caught.
    expect(correction.expected.sbr_payment).toBe(100000)
    expect(correction.values.sbr_payment).toBe(95000)
    expect(correction.values).not.toHaveProperty('client_name')
    expect(correction.values).not.toHaveProperty('business_type')
  })

  it('ignores spreadsheet float noise when comparing', () => {
    const stored = [existingCase({ creditorAmount: '250000.6' })]
    const preview = classify([validated({ creditorAmount: 250000.60000000003 })], stored)
    expect(preview.counts.already_have).toBe(1)
  })

  it('fills business type and number of creditors only where the case has none', () => {
    const empty = existingCase({ clientName: 'Alpha' })
    const typed = existingCase({ clientName: 'Bravo' }, { business_type: 'Retail', number_of_creditors: null })
    const full = existingCase({ clientName: 'Charlie' }, { business_type: 'Retail', number_of_creditors: 5 })
    const preview = classify(
      [validated({ clientName: 'Alpha' }), validated({ clientName: 'Bravo' }), validated({ clientName: 'Charlie' })],
      [empty, typed, full],
    )
    expect(preview.detailsAdded).toEqual([
      { caseId: empty.id, clientName: 'Alpha', values: { business_type: 'Cafe & Restaurant', number_of_creditors: 3 } },
      { caseId: typed.id, clientName: 'Bravo', values: { number_of_creditors: 3 } },
    ])
    // Different details never make a correction.
    expect(preview.counts.already_have).toBe(3)
    expect(preview.counts.corrections).toBe(0)
  })

  it('rejects a name the table marks as excluded', () => {
    const stored = [existingCase({ clientName: 'Alpha' }, { excluded: true, excluded_reason: 'duplicate of another case' })]
    const preview = classify([validated({ clientName: 'Alpha', sbrPayment: '95,000' })], stored)
    expect(preview.rejected[0].reasons).toEqual([
      { code: 'excluded', message: 'On the excluded list: duplicate of another case.' },
    ])
  })

  it('keeps rows that failed validation as rejected, with all their reasons', () => {
    const preview = classify([validated({ outcome: 'Cancelled', paymentType: 'Upfront and Plan' })])
    expect(preview.rejected[0].reasons.map((r) => r.code)).toEqual(['outcome', 'payment_type'])
    expect(preview.rejected[0].raw['Accepted/Rejected']).toBe('Cancelled')
  })
})

describe('classifyRows: repeats within the file', () => {
  it('rejects a repeat with the same figures, wherever it is', () => {
    const preview = classify([
      validated({ clientName: 'Alpha Pty Ltd' }, 'Old'),
      validated({ clientName: 'Alpha Pty Limited', businessType: 'Other' }, 'New'),
    ])
    expect(preview.counts).toMatchObject({ added: 1, rejected: 1 })
    expect(preview.rejected[0].reasons[0].code).toBe('duplicate_in_file')
    expect(preview.rejected[0].reasons[0].message).toMatch(/^Appears twice in this file \(same figures as row \d+ of "Old"\)\.$/)
  })

  it('makes a cross-tab repeat with different figures a correction of the stored case', () => {
    const stored = [existingCase({ clientName: 'Alpha' })]
    const preview = classify(
      [validated({ clientName: 'Alpha' }, 'Old'), validated({ clientName: 'Alpha', creditorAmount: '260,000' }, 'New')],
      stored,
    )
    expect(preview.counts).toMatchObject({ added: 0, already_have: 1, corrections: 1, rejected: 0 })
    const [c] = preview.corrections
    expect(c.caseId).toBe(stored[0].id)
    expect(c.changes.map((x) => x.column)).toEqual(['creditor_amount'])
    expect(c.notes[0]).toEqual({
      code: 'repeat_with_different_figures',
      message: 'Appears in two tabs with different figures — check which is right.',
    })
  })

  it('says "twice in this file" when both rows are on one tab', () => {
    const preview = classify([validated({ clientName: 'Alpha' }, 'Data'), validated({ clientName: 'Alpha', cumulativeDaysLate: '460' }, 'Data')])
    expect(preview.corrections[0].notes[0].message).toBe(
      'Appears twice in this file with different figures — check which is right.',
    )
  })

  it('makes a repeat of a new case a correction of that new case', () => {
    const preview = classify([validated({ clientName: 'Alpha' }, 'Old'), validated({ clientName: 'Alpha', dpn: 'Y' }, 'New')])
    expect(preview.counts).toMatchObject({ added: 1, corrections: 1 })
    const [c] = preview.corrections
    expect(c.caseId).toBeNull()
    expect(c.key).toBe(preview.added[0].key)
    expect(c.changes).toEqual([{ column: 'dpn', label: 'DPN', from: 'No', to: 'Yes' }])
    expect(c.values.dpn).toBe(true)
  })

  it('rejects a third version of a case, and a repeat of a row that is itself a correction', () => {
    const third = classify([
      validated({ clientName: 'Alpha' }),
      validated({ clientName: 'Alpha', dpn: 'Y' }),
      validated({ clientName: 'Alpha', cumulativeDaysLate: '999' }),
    ])
    expect(third.counts).toMatchObject({ added: 1, corrections: 1, rejected: 1 })
    expect(third.rejected[0].reasons[0].code).toBe('conflicting_repeat')

    const stored = [existingCase({ clientName: 'Bravo' })]
    const repeatOfCorrection = classify(
      [validated({ clientName: 'Bravo', dpn: 'Y' }), validated({ clientName: 'Bravo', cumulativeDaysLate: '999' })],
      stored,
    )
    expect(repeatOfCorrection.counts).toMatchObject({ corrections: 1, rejected: 1 })
    expect(repeatOfCorrection.rejected[0].reasons[0].code).toBe('conflicting_repeat')
  })

  it('lets the later row win when it already matches the stored case', () => {
    // The re-upload after the cross-tab correction above was ticked.
    const stored = [existingCase({ clientName: 'Alpha', creditorAmount: '260,000' })]
    const preview = classify(
      [validated({ clientName: 'Alpha' }, 'Old'), validated({ clientName: 'Alpha', creditorAmount: '260,000' }, 'New')],
      stored,
    )
    expect(preview.counts).toMatchObject({ added: 0, corrections: 0, already_have: 2, rejected: 0 })
  })

  it('compares a repeat with the first row that was accepted', () => {
    // The first row is rejected on its own, so the second is just a new case.
    const preview = classify([validated({ clientName: 'Alpha', dpn: '?' }), validated({ clientName: 'Alpha' })])
    expect(preview.counts).toMatchObject({ added: 1, rejected: 1, corrections: 0 })
  })
})

describe('classifyRows: the same file twice', () => {
  it('adds nothing the second time', () => {
    const stored = [existingCase({ clientName: 'Alpha' }), existingCase({ clientName: 'Bravo' })]
    const rows = () => [
      validated({ clientName: 'Alpha' }),
      validated({ clientName: 'Bravo', sbrPayment: '95,000' }),
      validated({ clientName: 'Charlie' }),
      validated({ clientName: 'Delta', paymentType: 'Upfront and Plan' }),
    ]
    const first = classify(rows(), stored)
    expect(first.counts).toEqual({ added: 1, corrections: 1, already_have: 1, details_added: 2, rejected: 1 })

    // Correction left unticked: it is offered again, nothing else changes.
    const unticked = classify(rows(), afterImport(stored, first))
    expect(unticked.counts).toEqual({ added: 0, corrections: 1, already_have: 2, details_added: 0, rejected: 1 })

    // Correction ticked: the second upload changes nothing at all.
    const ticked = classify(rows(), afterImport(stored, first, [first.corrections[0].key]))
    expect(ticked.counts).toEqual({ added: 0, corrections: 0, already_have: 3, details_added: 0, rejected: 1 })
  })
})
