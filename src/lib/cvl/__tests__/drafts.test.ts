// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { cleanAnswers, cleanEditedKeys, entryState, readDraft, toFormData } from '../drafts'
import { entryMap } from '../entryMap'
import { prefillForm } from '../prefill'
import { readCvlSettings } from '../settings'
import { caseJobs, fillJob } from '../generate'
import { formVersion, handwrittenKeys } from '@/lib/forms/registry'
import { fillOfficialForm } from '@/lib/forms/fill'
import { context } from './fixtures'

// Each test fills real ASIC PDFs; under full-suite load that can pass 20s.
vi.setConfig({ testTimeout: 60_000 })

/** Drafts of the CVL entry screens. Synthetic client file only. */

const partB = formVersion('507b').map
const partA = formVersion('507a').map

describe('entryState', () => {
  it('opens with the pre-filled answers, and every Yes/No at "No"', () => {
    const s = entryState(partB, prefillForm('507b', 'director:1', context()), null)
    expect(s.fields.b1_name).toBe('Jordan Sample')
    const yesNo = partB.fields.filter((f) => f.type === 'yesno').map((f) => s.fields[f.key])
    expect(yesNo).toHaveLength(32)
    expect(yesNo.every((v) => v === 'no')).toBe(true)
    expect(s.signedBy).toBe('Jordan Sample')
    expect(s.editedKeys).toEqual([])
  })

  it('takes the draft’s answer over the pre-filled one where it was typed in, blank included', () => {
    const draft = { fields: { b1_name: 'Jordan A. Sample', b1_phone: null, b2: 'yes' }, tables: {}, signedBy: null, editedKeys: ['b1_name', 'b1_phone', 'b2'] }
    const s = entryState(partB, prefillForm('507b', 'director:1', context()), draft)
    expect(s.fields.b1_name).toBe('Jordan A. Sample')
    expect(s.fields.b1_phone).toBeNull()
    expect(s.fields.b2).toBe('yes')
    // The name on the tables was never typed: it follows the pre-fill.
    expect(s.signedBy).toBe('Jordan Sample')
    expect(s.editedKeys).toEqual(['b1_name', 'b1_phone', 'b2'])
  })

  it('fills a box never typed in from the pre-fill as it is now, though the draft was saved before (a CVL setting changed later)', () => {
    // Saved while the External Administrator was not set: its boxes blank, none typed in.
    const draft = { fields: { ea_name: null, ea_phone: null, ea_contact: 'Typed Contact' }, tables: {}, signedBy: null, editedKeys: ['ea_contact'] }
    const settings = readCvlSettings([
      { key: 'external_administrator', value: { name: 'Alex Liquidator', phone: '02 0000 0000', contact: 'Sam Contact' }, confirmed: false, updated_by: 'staff', updated_at: '2026-11-04T00:00:00Z' },
    ])
    const s = entryState(partA, prefillForm('507a', 'company', context({ settings })), draft)
    expect(s.fields.ea_name).toBe('Alex Liquidator')
    expect(s.fields.ea_phone).toBe('02 0000 0000')
    // Typed in on the form: kept, over the setting.
    expect(s.fields.ea_contact).toBe('Typed Contact')
  })

  it('never carries a handwritten field', () => {
    const s = entryState(partB, prefillForm('507b', 'director:1', context()), null)
    for (const key of handwrittenKeys('507b')) expect(key in s.fields).toBe(false)
  })
})

describe('cleanAnswers', () => {
  it('keeps the form’s own fields and columns only, never a handwritten one or signedDate', () => {
    const cleaned = cleanAnswers('507b', '20220801', {
      fields: { b1_name: 'Jordan Sample', b6_username: 'nope', b6_password: 'nope', b1_street: '1 Home St', b31_date: '2026-10-29', made_up: 'x' },
      tables: {
        B28: [{ name: 'Adviser', amount: 100, injected: 'x' }, { name: '', amount: null }],
        ZZ: [{ a: 1 }],
      },
      signedBy: ' Jordan Sample ',
      signedDate: '2026-10-29',
    })
    expect(cleaned).toEqual({
      fields: { b1_name: 'Jordan Sample' },
      tables: { B28: [{ name: 'Adviser', amount: 100 }] },
      signedBy: 'Jordan Sample',
    })
  })

  it('refuses a body that is not answers', () => {
    expect(() => cleanAnswers('509', '2011', { fields: 'x' })).toThrow()
    expect(() => cleanAnswers('509', '2011', { fields: { a: { nested: true } } })).toThrow()
  })

  it('keeps changed keys only for the form’s own answers', () => {
    expect(cleanEditedKeys('507a', '20220801', ['a9_name', 'a9_date', 'table:A7', 'signedBy', 'other', 7])).toEqual(['a9_name', 'table:A7', 'signedBy'])
  })

  it('reads back what it saved', () => {
    const cleaned = cleanAnswers('507a', '20220801', { fields: { a2: 'yes' }, tables: { A7: [{ name: 'X', amount: 5 }] }, signedBy: 'Jordan Sample' })
    expect(readDraft(cleaned)).toEqual(cleaned)
    expect(readDraft({ nonsense: true })).toBeNull()
  })
})

describe('entryMap', () => {
  it('lists Part A page by page, as the PDF: every printed page has its place, each table at its appendix page', () => {
    const m = entryMap(partA)
    expect(m.sections.map((s) => [s.page, s.q])).toEqual([
      [1, 'Page 1'],
      [2, 'External Administrator'],
      [3, 'A2'],
      [3, 'A3'],
      [4, 'A4'],
      [4, 'A5'],
      [5, 'A6'],
      [5, 'A7'],
      [6, 'A8'],
      [6, 'A9'],
      [6, 'A10'],
      [7, 'Form 507A'],
      [8, 'Page 8'],
      [9, 'Table A4'],
      [10, 'Table A5'],
      [11, 'Table A6 unrelated'],
      [11, 'Table A6 related'],
      [12, 'Table A7'],
    ])
    // Nothing is asked on a cover; each question says where its table is.
    expect(m.sections.find((s) => s.q === 'Page 8')).toMatchObject({ kind: 'page', fields: [], tables: [] })
    expect(m.sections.find((s) => s.q === 'A7')!.tableRefs).toEqual([{ id: 'A7', title: expect.any(String), page: 12 }])
  })

  it('asks every page of Part A, page 7 (Form 507A) included, and prints it', async () => {
    const m = entryMap(partA)
    const f507a = m.sections.find((s) => s.q === 'Form 507A')!
    expect(f507a.fields.filter((f) => !f.handwritten).map((f) => f.key)).toEqual([
      'f507a_company_name',
      'f507a_company_acn',
      'f507a_report_date',
      'f507a_name',
      'f507a_capacity',
    ])
    expect(m.sections.flatMap((s) => s.tables.map((t) => t.id))).toEqual(['A4', 'A5', 'A6_unrelated', 'A6_related', 'A7'])
    // The CVL printout: pages 1 to 7, the appendix after.
    const [, partAJob] = caseJobs(context(), [])
    expect(partAJob.code).toBe('507a')
    expect(partAJob.answers.fields.f507a_company_name).toBe('Example Trading Pty Ltd')
    const { fill } = await fillJob(partAJob)
    expect(fill.pageSources.slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    // Then the appendix cover and every table page, A4 to A7, rows or not (as the official PDF).
    for (const page of [8, 9, 10, 11, 12]) expect(fill.pageSources).toContain(page)
  })

  it('lists the questions in the form’s order and numbering, without box geometry', () => {
    const m = entryMap(partA)
    expect(m.sections.map((s) => s.q).slice(0, 4)).toEqual(['Page 1', 'External Administrator', 'A2', 'A3'])
    const role = m.sections.find((s) => s.q === 'External Administrator')!.fields.find((f) => f.key === 'ea_role')!
    expect(role.type).toBe('choice')
    // Asked and labelled in the form's own words (no "Type of appointment" on the form).
    expect(role.label).toBe('Please tick appropriate box')
    expect(role.options).toEqual([
      ['receiver_manager', 'Receiver and Manager - s421A(1) 507G'],
      ['managing_controller', 'Managing Controller of property - s421A(1) 507H'],
      ['controller_director_report', 'Receiver, Receiver and Manager or Controller (Director Report) - s429(2)(b) 507F'],
      ['court_liquidator', 'Liquidator/Provisional Liquidator appointed by the court - s475(1) 507C'],
      ['cvl_liquidator', 'Liquidator – creditors’ voluntary winding up – s497(4) 507D'],
      ['voluntary_administrator', 'Voluntary Administrator - s438B(2) 507K'],
    ])
    expect(m.sections.find((s) => s.q === 'A9')!.fields.find((f) => f.key === 'a9_date')!.handwritten).toBe(true)
    // Only where each answer starts on its page (for the preview to follow), never the boxes themselves.
    expect(JSON.stringify(m)).not.toMatch(/"x0"|"x1"|"bot"|"slashes"|"cells"/)
    const name = m.sections.find((s) => s.q === 'A3')!.fields.find((f) => f.key === 'company_name')!
    expect(name.page).toBe(3)
    expect(name.top).toBeGreaterThan(0)
    expect(m.sections.find((s) => s.q === 'Table A7')!.tables[0]).toMatchObject({ id: 'A7', rowsPerPage: 6, page: 12 })
  })
})

describe('a pre-filled draft on the official form', () => {
  it('prints what was pre-filled, and nothing written by hand', async () => {
    const ctx = context()
    const s = entryState(partA, prefillForm('507a', 'company', ctx), null)
    const r = await fillOfficialForm('507a', toFormData(s))
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(r.pdf)), { mergePages: true })
    expect(text).toContain('Example Trading Pty Ltd')
    expect(text).toContain('North Melbourne')
    expect(text).toContain('172,320.55')
    // 6 form pages, the appendix cover, A4, and A7 on two pages: 7 creditors, 6 a page.
    expect(r.pages).toBe(10)
    expect(r.warnings).toEqual([expect.objectContaining({ key: 'A7', message: expect.stringMatching(/7 rows; the form holds 6 a page/) })])
    // The appendix tables carry the name, never a date beside it.
    expect(text).toContain('Jordan Sample')
  })
})
