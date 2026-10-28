import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { combinePdfs } from '../engine'
import { fillOfficialForm } from '../fill'
import { OVERFLOW_PARTB } from './fixtures/samples'
import { SAMPLES } from './snapshots'

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
    const overflow = await fillOfficialForm('507b', OVERFLOW_PARTB)
    writeFileSync(path.join(OUT, 'sample-overflow-form507-partb.pdf'), overflow.pdf)
    writeFileSync(path.join(OUT, 'sample-all-forms.pdf'), await combinePdfs(parts, 'CVL forms (synthetic sample)'))
  })
})
