import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { combinePdfs } from '../engine'
import { fillOfficialForm } from '../fill'
import { OVERFLOW_PARTB, SAMPLE_PARTB } from './fixtures/samples'
import { UNSURE } from '../unsure'
import { SAMPLES } from './snapshots'
import { caseJobs, fillAll } from '@/lib/cvl/generate'
import { context } from '@/lib/cvl/__tests__/fixtures'

/**
 * `npm run forms:samples`: writes the synthetic samples as PDFs to
 * verified-figures/cvl/samples/ (gitignored) for checking by eye.
 */
const OUT = path.join(__dirname, '..', '..', '..', '..', 'verified-figures', 'cvl', 'samples')

describe('write the sample PDFs', () => {
  it('writes each form, the overflow case and all forms together', async () => {
    mkdirSync(OUT, { recursive: true })
    const parts: Uint8Array[] = []
    for (const [name, code, data] of SAMPLES) {
      const r = await fillOfficialForm(code, data)
      expect(r.warnings).toEqual([])
      writeFileSync(path.join(OUT, `sample-${name}.pdf`), r.pdf)
      parts.push(r.pdf)
    }
    // Gabby's 24 Nov items on Part B in one page set: B1 address, B10 date, B24 "Unsure" (the income
    // tax return dates) beside B24 real dates (the BAS dates). Its own file: the snapshots are unchanged.
    const unsure = await fillOfficialForm('507b', {
      ...SAMPLE_PARTB,
      fields: { ...SAMPLE_PARTB.fields, b24_itr_start: UNSURE, b24_itr_end: UNSURE, b24_bas_start: '2026-04-01', b24_bas_end: '2026-06-30' },
    })
    expect(unsure.warnings).toEqual([])
    writeFileSync(path.join(OUT, 'sample-form507-partb-b24-unsure.pdf'), unsure.pdf)
    parts.push(unsure.pdf)
    const overflow = await fillOfficialForm('507b', OVERFLOW_PARTB)
    writeFileSync(path.join(OUT, 'sample-overflow-form507-partb.pdf'), overflow.pdf)
    writeFileSync(path.join(OUT, 'sample-all-forms.pdf'), await combinePdfs(parts, 'CVL forms (synthetic sample)'))
  })
})

describe('write a pre-filled CVL case', () => {
  it('writes every form of a synthetic two-director case, as pre-fill alone prints it', async () => {
    mkdirSync(OUT, { recursive: true })
    const { pdf, filled } = await fillAll(caseJobs(context(), []), 'CVL forms (synthetic pre-filled case)')
    writeFileSync(path.join(OUT, 'sample-cvl-case-prefilled-all-forms.pdf'), pdf)
    expect(filled.map((f) => f.job.label)).toHaveLength(4)
  })
})
