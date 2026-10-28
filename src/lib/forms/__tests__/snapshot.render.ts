import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fillOfficialForm } from '../fill'
import { renderPages } from './render'
import { SAMPLES, SNAPSHOT_DIR, SNAPSHOT_SCALE, snapshotFile } from './snapshots'

/**
 * `npm run forms:snapshot`: renders each synthetic sample and writes it as the
 * approved snapshot. Look at every page before committing them;
 * `npm run forms:check` then holds the forms to these images.
 */
describe('write the approved snapshots', () => {
  it.each(SAMPLES)('%s', async (name, code, data) => {
    mkdirSync(SNAPSHOT_DIR, { recursive: true })
    for (const f of readdirSync(SNAPSHOT_DIR)) {
      if (f.startsWith(`${name}-p`)) rmSync(path.join(SNAPSHOT_DIR, f))
    }
    const r = await fillOfficialForm(code, data)
    expect(r.warnings).toEqual([])
    const pages = await renderPages(r.pdf, undefined, SNAPSHOT_SCALE)
    pages.forEach((png, i) => writeFileSync(snapshotFile(name, i + 1), png))
  })
})
