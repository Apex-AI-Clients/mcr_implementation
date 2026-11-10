// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { allFormsSaved, caseJobs, fileNameFor, fillAll, fillJob, warningsFor } from '../generate'
import { context } from './fixtures'

// Each test fills real ASIC PDFs; under full-suite load that can pass 20s.
vi.setConfig({ testTimeout: 60_000 })

/** Preview, print and save: which forms a case prints, and what to check first. Synthetic client file only. */

describe('caseJobs', () => {
  it('prints Form 509, Part A, and one Part B per director, in that order', () => {
    const jobs = caseJobs(context(), [])
    expect(jobs.map((j) => [j.code, j.subject, j.label])).toEqual([
      ['509', 'company', 'Form 509'],
      ['507a', 'company', 'Form 507 Part A'],
      ['507b', 'director:1', 'Form 507 Part B — Jordan Sample'],
      ['507b', 'director:2', 'Form 507 Part B — Casey Example'],
    ])
    expect(jobs.every((j) => !j.fromDraft)).toBe(true)
    // Never opened: the pre-filled answers, the rest blank.
    expect(jobs[2].answers.fields.b1_name).toBe('Jordan Sample')
    expect(jobs[2].answers.fields.b2).toBe('no')
  })

  it('prints a saved draft over the pre-filled answers where they were typed in, and the pre-fill as it is now elsewhere', () => {
    const jobs = caseJobs(context(), [
      {
        form_code: '507b',
        subject: 'director:2',
        form_version: '20220801',
        answers: { fields: { b1_name: 'Casey A. Example', b2: 'yes', company_name: null }, tables: {}, signedBy: null },
        edited_keys: ['b1_name', 'b2'],
      },
    ])
    const two = jobs[3]
    expect(two.fromDraft).toBe(true)
    expect(two.answers.fields.b1_name).toBe('Casey A. Example')
    expect(two.answers.fields.b2).toBe('yes')
    // Saved blank, never typed in: the company name on the file now prints.
    expect(two.answers.fields.company_name).toBe('Example Trading Pty Ltd')
  })
})

describe('warningsFor', () => {
  it('lists overflow and forms never opened, never amounts to place (Form 509’s lodgement details have starting values)', () => {
    const [f509] = caseJobs(context(), [])
    const w = warningsFor(f509, [{ key: 'company_name', q: 'Company details', message: 'Answer is too long for the box and was cut off: attach an annexure.' }])
    expect(w).toEqual([
      'Company details: Answer is too long for the box and was cut off: attach an annexure.',
      'Never opened: printed from the pre-filled answers.',
    ])
    expect(w.join(' ')).not.toMatch(/Gabby/)
  })
})

describe('filling', () => {
  it('fills one Part B per director, each with its own director', async () => {
    const jobs = caseJobs(context(), [])
    const [one, two] = await Promise.all([fillJob(jobs[2]), fillJob(jobs[3])])
    const text = async (pdf: Uint8Array) => (await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true })).text
    expect(await text(one.fill.pdf)).toContain('Jordan Sample')
    expect(await text(two.fill.pdf)).toContain('Casey Example')
    expect(await text(two.fill.pdf)).not.toContain('Jordan Sample')
  })

  it('puts every form in one PDF for "all forms"', async () => {
    const jobs = caseJobs(context(), [])
    const { pdf, filled } = await fillAll(jobs, 'CVL forms — synthetic')
    const doc = await getDocumentProxy(new Uint8Array(pdf))
    expect(doc.numPages).toBe(filled.reduce((s, f) => s + f.fill.pages, 0))
  })
})

describe('allFormsSaved', () => {
  const jobs = caseJobs(context(), [])
  it('is true with an "all forms" file, or one file per form and director', () => {
    expect(allFormsSaved(jobs, [{ form_code: 'all', subject: 'all' }])).toBe(true)
    const each = jobs.map((j) => ({ form_code: j.code, subject: j.subject }))
    expect(allFormsSaved(jobs, each)).toBe(true)
    expect(allFormsSaved(jobs, each.slice(0, 3))).toBe(false)
  })
})

describe('fileNameFor', () => {
  it('names the file by form, person and day', () => {
    expect(fileNameFor('Form 507 Part B — Jordan Sample', new Date('2026-11-03T05:00:00Z'))).toBe('form-507-part-b-jordan-sample-2026-11-03.pdf')
  })
})
