// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { classifyRows } from '../classify'
import { UnknownCorrectionError, buildApplyPayload } from '../payload'
import { existingCase, validated } from './fixtures'

const META = { uploadedBy: 'Sam', uploadedByUserId: null, fileName: 'cases.xlsx' }

function scenario() {
  const alpha = existingCase({ clientName: 'Alpha' })
  const bravo = existingCase({ clientName: 'Bravo' }, { business_type: 'Retail' })
  const preview = classifyRows(
    [
      validated({ clientName: 'Alpha', sbrPayment: '95,000' }), // correction + details
      validated({ clientName: 'Bravo' }), // already have + creditor count
      validated({ clientName: 'Charlie' }, 'Old'), // new
      validated({ clientName: 'Charlie', dpn: 'Y' }, 'New'), // correction of the new case
      validated({ clientName: 'Delta', outcome: 'Cancelled' }), // rejected
    ],
    [alpha, bravo],
    [],
  )
  return { alpha, bravo, preview }
}

describe('buildApplyPayload', () => {
  it('with nothing ticked: new cases and details only', () => {
    const { alpha, bravo, preview } = scenario()
    const payload = buildApplyPayload(preview, new Set(), META)

    expect(payload.p_new_cases.map((c) => [c.client_name, c.dpn])).toEqual([['Charlie', false]])
    // Details go in as corrections whose previous value is null, so undo clears them.
    expect(payload.p_corrections).toEqual([
      {
        case_id: alpha.id,
        expected: { business_type: null, number_of_creditors: null },
        values: { business_type: 'Cafe & Restaurant', number_of_creditors: 3 },
      },
      { case_id: bravo.id, expected: { number_of_creditors: null }, values: { number_of_creditors: 3 } },
    ])
    expect(payload.p_import).toEqual({
      uploaded_by: 'Sam',
      uploaded_by_user_id: null,
      file_name: 'cases.xlsx',
      counts: { added: 1, corrected: 0, details_added: 2, already_have: 1, corrections_not_applied: 2, rejected: 1 },
    })
  })

  it('with everything ticked: one entry per case, and the new case takes the later figures', () => {
    const { alpha, preview } = scenario()
    const payload = buildApplyPayload(preview, new Set(preview.corrections.map((c) => c.key)), META)

    expect(payload.p_new_cases.map((c) => [c.client_name, c.dpn])).toEqual([['Charlie', true]])
    const alphaEntry = payload.p_corrections.find((c) => c.case_id === alpha.id)!
    expect(payload.p_corrections.filter((c) => c.case_id === alpha.id)).toHaveLength(1)
    expect(alphaEntry.values).toMatchObject({ sbr_payment: 95000, business_type: 'Cafe & Restaurant' })
    expect(alphaEntry.expected).toMatchObject({ sbr_payment: 100000, business_type: null })
    // expected and values always name the same columns (the RPC compares them).
    expect(Object.keys(alphaEntry.expected).sort()).toEqual(Object.keys(alphaEntry.values).sort())
    expect(payload.p_import.counts).toMatchObject({ added: 1, corrected: 1, corrections_not_applied: 0 })
  })

  it('refuses a tick the preview did not offer', () => {
    const { preview } = scenario()
    expect(() => buildApplyPayload(preview, new Set(['not offered']), META)).toThrow(UnknownCorrectionError)
  })
})
