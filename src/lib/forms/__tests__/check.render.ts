import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fillOfficialForm, readTemplate } from '../fill'
import { FORM_CODES, formVersion } from '../registry'
import type { FormCode } from '../types'
import { comparePngs, renderPages } from './render'
import { SAMPLES, SNAPSHOT_SCALE, snapshotFile } from './snapshots'

/**
 * Render tests for the official forms: `npm run forms:check`. Approve new
 * snapshots with `npm run forms:snapshot` (snapshot.render.ts), after
 * looking at every page.
 *
 * 1. A blank fill renders pixel-identical to the official PDF, page by page:
 *    the pages are copied, never redrawn.
 * 2. Each form filled with the synthetic sample matches its approved
 *    snapshot in __tests__/snapshots/.
 *
 * Pages are rendered with pdf.js (unpdf) on @napi-rs/canvas. Our answers use
 * PDF's standard Helvetica, which the renderer draws with a system font, so
 * the sample snapshots are compared with pixelmatch's anti-aliasing
 * tolerance (0.1); the blank comparison allows none.
 */

/** The template pages a fill prints, in output order, when every table page is included. */
function printedOrder(code: FormCode): number[] {
  const { map } = formVersion(code)
  return [
    ...map.formPages,
    ...(map.optionalPages ?? []).map((p) => p.page),
    ...(map.appendixCoverPage ? [map.appendixCoverPage] : []),
    ...new Set(map.tables.map((t) => t.page)),
  ]
}

describe('a blank fill is the official PDF, pixel for pixel', () => {
  it.each(FORM_CODES)('%s', async (code) => {
    const blank = await fillOfficialForm(code, { fields: {} }, { tables: 'all', include: ['507a'] })
    const order = printedOrder(code)
    const filled = await renderPages(blank.pdf)
    const original = await renderPages(await readTemplate(code), order)
    expect(filled).toHaveLength(order.length)
    order.forEach((page, i) => {
      const d = comparePngs(original[i], filled[i], 0)
      expect({ page, differing: d.differing }).toEqual({ page, differing: 0 })
    })
  })
})

describe('synthetic samples match their approved snapshots', () => {
  it.each(SAMPLES)('%s', async (name, code, data) => {
    const r = await fillOfficialForm(code, data)
    expect(r.warnings).toEqual([])
    const pages = await renderPages(r.pdf, undefined, SNAPSHOT_SCALE)
    pages.forEach((png, i) => {
      const file = snapshotFile(name, i + 1)
      expect(existsSync(file), `${file} missing: run npm run forms:snapshot and check it`).toBe(true)
      const d = comparePngs(readFileSync(file), png, 0.1)
      if (d.diffPng) writeFileSync(file.replace(/\.png$/, '.diff.png'), d.diffPng)
      expect({ page: i + 1, differing: d.differing }).toEqual({ page: i + 1, differing: 0 })
    })
  })
})
