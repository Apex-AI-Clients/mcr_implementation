import { describe, expect, it } from 'vitest'
import { prefillForm } from '../prefill'
import { entryState, savedA7Total, savedSummaryDate, toFormData } from '../drafts'
import { jobFor } from '../generate'
import { formVersion, tableDateKey } from '@/lib/forms/registry'
import { context } from './fixtures'

/**
 * Signature dates (Nov 2026): every date beside a signature starts from Form
 * 509's saved "Date to which summary is made up", can be changed on its form,
 * and follows a later change unless changed by hand. Synthetic data only.
 */

const SUMMARY = '2026-11-14'
const withSummary = (date: string | null = SUMMARY) => ({ ...context(), summaryDate: date })
const value = (p: ReturnType<typeof prefillForm>, key: string) => p.fields[key]?.value

function draft509(fields: Record<string, unknown>, editedKeys: string[] = []) {
  return { form_code: '509', subject: 'company', form_version: '2011', answers: { fields, tables: {} }, edited_keys: editedKeys }
}

describe('prefill — signature dates from Form 509', () => {
  it('fills Form 509’s Date signed from its own saved summary date', () => {
    expect(value(prefillForm('509', 'company', withSummary()), 'date_signed')).toBe(SUMMARY)
  })

  it('fills A9, A10, Form 507A and the tables’ "...and dated" on Part A', () => {
    const p = prefillForm('507a', 'company', withSummary())
    for (const key of ['a9_date', 'a10_date', 'f507a_date_signed']) expect(value(p, key)).toBe(SUMMARY)
    // Form 507A's "Date of Report under s475(1)" too.
    expect(value(p, 'f507a_report_date')).toBe(SUMMARY)
    expect(p.fields.f507a_report_date.source.from[1]).toBe('Change it here if the report is dated another day.')
    // One date per table page: A6's two tables share a page.
    expect(Object.keys(p.signedDates)).toEqual(['A4', 'A5', 'A6_unrelated', 'A7'])
    for (const d of Object.values(p.signedDates)) expect(d.value).toBe(SUMMARY)
    expect(p.fields.a9_date.source.from[0]).toBe('Form 509: Date to which summary is made up.')
  })

  it('fills B31 and the tables’ "...and dated" on each director’s Part B', () => {
    for (const subject of ['director:1', 'director:2'] as const) {
      const p = prefillForm('507b', subject, withSummary())
      expect(value(p, 'b31_date')).toBe(SUMMARY)
      expect(Object.keys(p.signedDates)).toEqual(['B2', 'B3', 'B21', 'B28'])
      expect(p.signedDates.B28.value).toBe(SUMMARY)
    }
  })

  it('leaves them blank, with a note, until Form 509 is saved with the date', () => {
    const p = prefillForm('507a', 'company', withSummary(null))
    expect(p.fields.a9_date).toBeUndefined()
    expect(p.signedDates).toEqual({})
    expect(p.notes.a9_date).toContain('once Form 509 is saved')
    expect(p.fields.f507a_report_date).toBeUndefined()
    expect(p.notes.f507a_report_date).toContain('once Form 509 is saved')
    expect(prefillForm('509', 'company', withSummary(null)).notes.date_signed).toContain('above')
  })
})

describe('savedSummaryDate', () => {
  it('reads Form 509’s summary date, never its Date signed', () => {
    expect(savedSummaryDate([draft509({ summary_date: SUMMARY, date_signed: '2026-12-01' })])).toBe(SUMMARY)
    expect(savedSummaryDate([draft509({ date_signed: '2026-12-01' })])).toBeNull()
    expect(savedSummaryDate([])).toBeNull()
    expect(savedSummaryDate([{ ...draft509({ summary_date: SUMMARY }), form_code: '507a' }])).toBeNull()
  })
})

describe('entryState — signature dates follow unless changed by hand', () => {
  const partA = formVersion('507a').map

  it('takes a later summary date on a form saved before it, where the date was never changed', () => {
    const saved = { fields: { a9_date: '2026-10-01' }, tables: {}, signedBy: null, signedDates: { A5: '2026-10-01' }, editedKeys: [] }
    const s = entryState(partA, prefillForm('507a', 'company', withSummary()), saved)
    expect(s.fields.a9_date).toBe(SUMMARY)
    expect(s.signedDates?.A5).toBe(SUMMARY)
  })

  it('keeps a date Gabby changed on the form', () => {
    const saved = {
      fields: { a9_date: '2026-11-20' },
      tables: {},
      signedBy: null,
      signedDates: { A5: '2026-11-21' },
      editedKeys: ['a9_date', tableDateKey('A5')],
    }
    const s = entryState(partA, prefillForm('507a', 'company', withSummary()), saved)
    expect(s.fields.a9_date).toBe('2026-11-20')
    // Only A5's date was changed: the other tables keep following.
    expect(s.signedDates).toEqual({ A4: SUMMARY, A5: '2026-11-21', A6_unrelated: SUMMARY, A7: SUMMARY })
  })

  it('has no tables’ date on Form 509, which has no tables', () => {
    expect(entryState(formVersion('509').map, prefillForm('509', 'company', withSummary()), null).signedDates).toEqual({})
  })
})

describe('jobFor — the printout takes the saved summary date', () => {
  it('dates Part A and Part B from Form 509’s saved summary date, whatever 509’s Date signed says', () => {
    // Gabby changed 509's Date signed by hand.
    const drafts = [draft509({ summary_date: SUMMARY, date_signed: '2026-12-01' }, ['summary_date', 'date_signed'])]
    const partA = jobFor(context(), drafts, '507a', 'company')
    expect(partA.answers.fields.a9_date).toBe(SUMMARY)
    expect(partA.answers.signedDates?.A7).toBe(SUMMARY)
    expect(toFormData(partA.answers).signedDates?.A7).toBe(SUMMARY)
    const partB = jobFor(context(), drafts, '507b', 'director:1')
    expect(partB.answers.fields.b31_date).toBe(SUMMARY)
    // 509 itself prints the Date signed it was given.
    expect(jobFor(context(), drafts, '509', 'company').answers.fields.date_signed).toBe('2026-12-01')
  })

  it('prints no signature date while Form 509 has no summary date', () => {
    const partA = jobFor(context(), [], '507a', 'company')
    expect(partA.answers.fields.a9_date ?? null).toBeNull()
    expect(Object.values(partA.answers.signedDates ?? {}).every((d) => d === null)).toBe(true)
  })
})

describe('Yes/No questions answered Yes to start with (Nov 2026)', () => {
  const partA = formVersion('507a').map
  const partB = formVersion('507b').map

  it('starts A2 and A8 at Yes, and every other Part A Yes/No at No', () => {
    const s = entryState(partA, prefillForm('507a', 'company', context()), null)
    expect(s.fields.a2).toBe('yes')
    expect(s.fields.a8).toBe('yes')
    const others = partA.fields.filter((f) => f.type === 'yesno' && !['a2', 'a8'].includes(f.key))
    expect(others.length).toBeGreaterThan(0)
    expect(others.every((f) => s.fields[f.key] === 'no')).toBe(true)
  })

  it('starts B8, B9, B14, B15, B27 and B30 (with its permission) at Yes on each director’s Part B', () => {
    const yes = ['b8', 'b9', 'b14', 'b15', 'b27', 'b30', 'b30_permission']
    const s = entryState(partB, prefillForm('507b', 'director:2', context()), null)
    for (const key of yes) expect(s.fields[key]).toBe('yes')
    const others = partB.fields.filter((f) => f.type === 'yesno' && !yes.includes(f.key))
    expect(others.every((f) => s.fields[f.key] === 'no')).toBe(true)
  })

  it('reaches a form saved before, unless the answer was changed by hand', () => {
    const saved = { fields: { b8: 'no', b14: 'no' }, tables: {}, signedBy: null, editedKeys: ['b14'] }
    const s = entryState(partB, prefillForm('507b', 'director:1', context()), saved)
    expect(s.fields.b8).toBe('yes')
    expect(s.fields.b14).toBe('no')
  })
})

describe('B30 — MCR Partners helped (Nov 2026)', () => {
  it('answers Yes, gives permission, and fills in MCR Partners’ details on each director’s Part B', () => {
    const s = entryState(formVersion('507b').map, prefillForm('507b', 'director:2', context()), null)
    expect(s.fields).toMatchObject({
      b30: 'yes',
      b30_permission: 'yes',
      b30_name: 'MCR Partners Pty Ltd',
      b30_street: 'PO Box 2100',
      b30_suburb: 'Gladstone Park',
      b30_state: 'VIC',
      b30_postcode: '3043',
      b30_phone: '03 8672 7979',
      b30_email: 'assist@mcrpartners.com.au',
    })
  })

  it('keeps what Gabby changed by hand', () => {
    const saved = { fields: { b30_name: 'Someone Else' }, tables: {}, signedBy: null, editedKeys: ['b30_name'] }
    const s = entryState(formVersion('507b').map, prefillForm('507b', 'director:1', context()), saved)
    expect(s.fields.b30_name).toBe('Someone Else')
    expect(s.fields.b30_street).toBe('PO Box 2100')
  })

  it('prints them on the PDF', async () => {
    const { jobFor, fillJob } = await import('../generate')
    const { fill } = await fillJob(jobFor(context(), [], '507b', 'director:1'))
    expect(fill.warnings.filter((w) => w.key.startsWith('b30'))).toEqual([])
  })
})

describe('Form 509 row 6 — Part A Table A7 "Amount owing", added up (Nov 2026)', () => {
  const partA = (rows: Record<string, unknown>[]) => ({
    form_code: '507a',
    subject: 'company',
    form_version: '20220801',
    answers: { fields: {}, tables: { A7: rows } },
    edited_keys: ['table:A7'],
  })

  it('adds up the saved amounts, in either column’s form', () => {
    expect(savedA7Total([partA([{ name: 'A', amount: 40_000 }, { name: 'B', amount: '35,000.50' }, { name: 'C', amount: 24_999.5 }])])).toBe(100_000)
    expect(savedA7Total([partA([{ name: 'No amount' }])])).toBeNull()
    expect(savedA7Total([])).toBeNull()
  })

  it('fills both columns of row 6 on Form 509, and its printout', () => {
    const drafts = [partA([{ name: 'A', amount: 60_000 }, { name: 'B', amount: 40_000 }])]
    const job = jobFor(context(), drafts, '509', 'company')
    expect(job.answers.fields.r6_val).toBe(100_000)
    expect(job.answers.fields.r6).toBe(100_000)
    expect(job.prefill.fields.r6.source.from[0]).toContain('Table A7')
  })

  it('leaves row 6 to be typed, with no note, until Part A is saved with amounts', () => {
    const p = prefillForm('509', 'company', context())
    expect(p.fields.r6_val).toBeUndefined()
    expect(p.notes.r6_val).toBeUndefined()
  })

  it('keeps a row 6 Gabby typed himself', () => {
    const map = formVersion('509').map
    const saved = { fields: { r6_val: 90_000, r6: 90_000 }, tables: {}, signedBy: null, editedKeys: ['r6_val', 'r6'] }
    const s = entryState(map, prefillForm('509', 'company', { ...context(), a7Total: 100_000 }), saved)
    expect([s.fields.r6_val, s.fields.r6]).toEqual([90_000, 90_000])
  })
})

describe('Part B — B1 contact and B5 Manager 1 (Nov 2026)', () => {
  const withContact = () => {
    const ctx = context()
    ctx.company!.phone = '02 9000 0000'
    ctx.company!.email = 'office@example.test'
    return ctx
  }

  it('fills B1’s phone and email with the company’s, from the client file', () => {
    const p = prefillForm('507b', 'director:1', withContact())
    expect(value(p, 'b1_phone')).toBe('02 9000 0000')
    expect(value(p, 'b1_email')).toBe('office@example.test')
    expect(p.fields.b1_phone.source.from[0]).toBe('The company phone on the client file (Company details).')
  })

  it('makes Manager 1 this Part B’s director, with the company’s phone and email; Manager 2 is left blank', () => {
    const p = prefillForm('507b', 'director:2', withContact())
    expect(value(p, 'b5_m1_name')).toBe('Casey Example')
    expect(value(p, 'b5_m1_role')).toBe('Director')
    expect(value(p, 'b5_m1_duties')).toBe('Day to day operation')
    expect(value(p, 'b5_m1_phone')).toBe('02 9000 0000')
    expect(value(p, 'b5_m1_email')).toBe('office@example.test')
    for (const key of ['b5_m2_name', 'b5_m2_role', 'b5_m2_duties', 'b5_m2_phone', 'b5_m2_email']) expect(p.fields[key]).toBeUndefined()
  })

  it('leaves the phone and email blank when the client file has none', () => {
    const p = prefillForm('507b', 'director:1', context())
    for (const key of ['b1_phone', 'b1_email', 'b5_m1_phone', 'b5_m1_email']) expect(p.fields[key]).toBeUndefined()
    expect(value(p, 'b5_m1_name')).toBe('Jordan Sample')
  })
})
