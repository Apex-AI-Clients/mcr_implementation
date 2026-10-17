// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readDirectorPenaltyNotice } from '../extractText'
import { EXPECTED_TOTALS, PAGE3_ROWS, PAGE4_ROWS, SYNTHETIC, buildNoticePdf } from './fixtures/notice'

/**
 * PDF -> positioned cells -> parse, end to end, on a SYNTHETIC notice drawn
 * with pdf-lib, right-aligned figures included.
 *
 * fetch is replaced with one that fails the test: a DPN must be read entirely
 * in memory, with no network call of any kind.
 */

const fetchSpy = vi.fn(() => {
  throw new Error('extractText must not make network calls')
})

beforeEach(() => {
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

describe('readDirectorPenaltyNotice', () => {
  it('reads a synthetic notice drawn as a real PDF', async () => {
    const result = await readDirectorPenaltyNotice(await buildNoticePdf())
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    const { notice } = result
    expect(notice.reference).toBe(SYNTHETIC.reference)
    expect(notice.directorName).toBe(SYNTHETIC.director)
    expect(notice.companyName).toBe(SYNTHETIC.company)
    expect(notice.acn).toBe(SYNTHETIC.acn)
    expect(notice.rows).toHaveLength(PAGE3_ROWS.length + PAGE4_ROWS.length)
    expect(notice.totals).toEqual(EXPECTED_TOTALS)
  })

  it('never returns the address', async () => {
    const result = await readDirectorPenaltyNotice(await buildNoticePdf())
    const everything = JSON.stringify(result)
    expect(everything).not.toContain(SYNTHETIC.street)
    expect(everything).not.toContain(SYNTHETIC.suburb)
  })

  it('reads a GST notice', async () => {
    const result = await readDirectorPenaltyNotice(
      await buildNoticePdf({ noticeFor: 'GST', subtitle: 'Assessed net goods and services tax amounts' }),
    )
    expect(result.kind === 'parsed' && result.notice.type).toBe('gst')
  })
})
