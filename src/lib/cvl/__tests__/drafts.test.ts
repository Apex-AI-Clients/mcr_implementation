// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { cleanAnswers, cleanEditedKeys, entryState, readDraft, toFormData } from '../drafts'
import { entryMap } from '../entryMap'
import { prefillForm } from '../prefill'
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

  it('takes the draft’s answer over the pre-filled one, blank included', () => {
    const draft = { fields: { b1_name: 'Jordan A. Sample', b1_phone: null, b2: 'yes' }, tables: {}, signedBy: null, editedKeys: ['b1_name', 'b1_phone', 'b2'] }
    const s = entryState(partB, prefillForm('507b', 'director:1', context()), draft)
    expect(s.fields.b1_name).toBe('Jordan A. Sample')
    expect(s.fields.b1_phone).toBeNull()
    expect(s.fields.b2).toBe('yes')
    expect(s.signedBy).toBeNull()
    expect(s.editedKeys).toEqual(['b1_name', 'b1_phone', 'b2'])
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
  it('lists the questions in the form’s order and numbering, without page coordinates', () => {
    const m = entryMap(partA)
    expect(m.sections.map((s) => s.q).slice(0, 4)).toEqual(['External Administrator', 'A2', 'A3', 'A4'])
    const role = m.sections[0].fields.find((f) => f.key === 'ea_role')!
    expect(role.type).toBe('choice')
    expect(role.options).toContainEqual(['cvl_liquidator', 'Liquidator, creditors’ voluntary winding up s497(4) (507D)'])
    expect(m.sections.find((s) => s.q === 'A9')!.fields.find((f) => f.key === 'a9_date')!.handwritten).toBe(true)
    expect(JSON.stringify(m)).not.toMatch(/"x0"|"top"/)
    expect(m.sections.find((s) => s.q === 'A7')!.tables[0]).toMatchObject({ id: 'A7', rowsPerPage: 6 })
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
