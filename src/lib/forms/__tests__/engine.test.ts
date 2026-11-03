// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { PDFDocument } from 'pdf-lib'
import { dateParts, formatAmount, withComputed } from '../engine'
import { fillOfficialForm, readTemplate } from '../fill'
import { FORM_CODES, TABLE_DATED_KEY, formVersion, handwrittenKeys } from '../registry'
import type { FormCode, FormData, FormMap } from '../types'
import { OVERFLOW_PARTB, SAMPLE_509, SAMPLE_PARTA, SAMPLE_PARTB } from './fixtures/samples'

async function pageTexts(pdf: Uint8Array): Promise<string[]> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: false })
  return text
}

describe('value helpers', () => {
  it('reads ISO and Australian dates, and refuses impossible ones', () => {
    expect(dateParts('2026-10-27')).toEqual({ d: '27', m: '10', y: '2026' })
    expect(dateParts('7/3/26')).toEqual({ d: '07', m: '03', y: '2026' })
    expect(dateParts('2026-13-01')).toBeNull()
    expect(dateParts('next week')).toBeNull()
  })

  it('formats amounts without cents when whole, negatives in brackets', () => {
    expect(formatAmount(12480.5)).toBe('12,480.50')
    expect(formatAmount(150)).toBe('150')
    expect(formatAmount(-3204.17, true)).toBe('($3,204.17)')
  })

  it('fills Form 509 totals only when they are not given', () => {
    const { map } = formVersion('509')
    expect(withComputed(map, { b_val: 100, d_val: 50.25 }).total_assets).toBe(150.25)
    expect(withComputed(map, { b_val: 100, total_assets: 7 }).total_assets).toBe(7)
    expect(withComputed(map, {}).total_assets).toBeUndefined()
  })
})

describe('maps', () => {
  const maps: [FormCode, FormMap][] = FORM_CODES.map((c) => [c, formVersion(c).map])

  it.each(maps)('%s: unique keys, every box on its page, every field on a printed page', async (code, map) => {
    const doc = await PDFDocument.load(await readTemplate(code))
    expect(doc.getPageCount()).toBe(map.pageCount)
    const keys = map.fields.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    const printable = new Set([...map.formPages, ...(map.optionalPages ?? []).map((p) => p.page)])
    for (const f of map.fields) {
      expect(printable.has(f.page), f.key).toBe(true)
      const { width, height } = doc.getPage(f.page - 1).getSize()
      const boxes =
        f.type === 'lines' ? f.lines : f.type === 'datecells' ? f.cells : f.type === 'yesno' ? [f.yes, f.no]
          : f.type === 'choice' ? Object.values(f.options) : [f]
      for (const b of boxes) {
        expect(b.x0, f.key).toBeGreaterThanOrEqual(0)
        expect(b.x1, f.key).toBeLessThanOrEqual(width)
        expect(b.top, f.key).toBeGreaterThanOrEqual(0)
        expect(b.bot, f.key).toBeLessThanOrEqual(height)
        expect(b.x1, f.key).toBeGreaterThan(b.x0)
      }
    }
    for (const t of map.tables) {
      const { width } = doc.getPage(t.page - 1).getSize()
      expect(t.rows.length, t.id).toBeGreaterThan(0)
      for (const c of t.columns) expect(c.x1, `${t.id}.${c.key}`).toBeLessThanOrEqual(width)
    }
  })

  it('maps every Yes/No question on both parts of Form 507', () => {
    const yesNo = (c: FormCode) => formVersion(c).map.fields.filter((f) => f.type === 'yesno').length
    expect(yesNo('507a')).toBe(32)
    expect(yesNo('507b')).toBe(32)
  })

  it('maps the appendix tables of both parts', () => {
    expect(formVersion('507a').map.tables.map((t) => t.id)).toEqual(['A4', 'A5', 'A6_unrelated', 'A6_related', 'A7'])
    expect(formVersion('507b').map.tables.map((t) => t.id)).toEqual(['B2', 'B3', 'B21', 'B28'])
  })

  it('marks B6, the B1 address and every date beside a signature as handwritten', () => {
    expect(handwrittenKeys('507b').sort()).toEqual(
      ['b1_address', 'b1_postcode', 'b1_state', 'b1_street', 'b1_suburb', 'b31_date', 'b6_password', 'b6_username', TABLE_DATED_KEY].sort(),
    )
    expect(handwrittenKeys('507a').sort()).toEqual(['a10_date', 'a9_date', 'f507a_date_signed', TABLE_DATED_KEY].sort())
    expect(handwrittenKeys('509')).toEqual(['date_signed'])
  })

  it('has no signature field on any form: signatures are by hand', () => {
    for (const c of FORM_CODES) {
      expect(formVersion(c).map.fields.some((f) => /signature/i.test(f.key))).toBe(false)
    }
  })
})

describe('fill', () => {
  it('prints Form 509 without its guide page', async () => {
    const r = await fillOfficialForm('509', SAMPLE_509)
    expect(r.pages).toBe(2)
    expect(r.warnings).toEqual([])
    const [p1, p2] = await pageTexts(r.pdf)
    expect(p1).toContain('Example Trading Pty Ltd (In Liquidation)')
    expect(p2).toContain('$48,334.67') // computed total of the valuations
  })

  it('starts Form 509 amounts at the left of their column, under its heading', async () => {
    const r = await fillOfficialForm('509', SAMPLE_509)
    const doc = await getDocumentProxy(new Uint8Array(r.pdf))
    const items = (await (await doc.getPage(2)).getTextContent()).items.flatMap((i) => ('str' in i ? [i] : []))
    const { map } = formVersion('509')
    for (const [text, key] of [['$12,480.50', 'b_val'], ['$150', 'c_val'], ['$286,412.33', 'r6']] as const) {
      const f = map.fields.find((x) => x.key === key)!
      const x = items.find((i) => i.str === text)!.transform[4]
      expect(x, key).toBeCloseTo((f as { x0: number }).x0 + 5, 0)
    }
  })

  it('prints Part A without Form 507A unless asked, with only the tables that have rows', async () => {
    const r = await fillOfficialForm('507a', SAMPLE_PARTA)
    // 6 form pages + appendix cover + A4, A5, A6 (both grids on one page), A7
    expect(r.pages).toBe(11)
    // Which template page each output page is: the form pages, the appendix cover, then each table's page.
    const { map } = formVersion('507a')
    expect(r.pageSources).toHaveLength(r.pages)
    expect(r.pageSources.slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, map.appendixCoverPage])
    expect(new Set(r.pageSources.slice(7))).toEqual(new Set(map.tables.map((t) => t.page)))
    const withA = await fillOfficialForm('507a', SAMPLE_PARTA, { include: ['507a'] })
    expect(withA.pages).toBe(12)
    const texts = await pageTexts(r.pdf)
    expect(texts.some((t) => t.includes('Statement verifying Report under s475(1)'))).toBe(false)
  })

  it('titles each form as itself (not every output "Part B")', async () => {
    for (const [code, data] of [['509', SAMPLE_509], ['507a', SAMPLE_PARTA], ['507b', SAMPLE_PARTB]] as const) {
      const r = await fillOfficialForm(code, data)
      const doc = await PDFDocument.load(r.pdf)
      expect(doc.getTitle()).toBe(formVersion(code).map.title)
    }
  })

  it('writes the form’s own page count in the appendix header ("of 6" on Part A, "of 9" on Part B)', async () => {
    const a = await pageTexts((await fillOfficialForm('507a', SAMPLE_PARTA)).pdf)
    const tableA4 = a.find((t) => t.includes('Table A4'))!
    expect(tableA4).toMatch(/\b4\b[\s\S]*\b6\b/)
    expect(tableA4).not.toMatch(/\b9\b/)
    const b = await pageTexts((await fillOfficialForm('507b', SAMPLE_PARTB)).pdf)
    expect(b.find((t) => t.includes('Table B2'))).toMatch(/\b9\b/)
  })

  it('never draws handwritten fields, whatever the data holds', async () => {
    const r = await fillOfficialForm('507b', SAMPLE_PARTB)
    const all = (await pageTexts(r.pdf)).join('\n')
    expect(all).not.toContain('should-not-print')
    expect(all).not.toContain('Should Not Print')
    expect(all).toContain('Casey Bookkeeper')
  })

  it.each([['509', SAMPLE_509], ['507a', SAMPLE_PARTA], ['507b', SAMPLE_PARTB]] as const)(
    '%s: handwritten answers in the data change nothing on the printout (signature dates, table "and dated")',
    async (code, sample) => {
      const keys = handwrittenKeys(code)
      const withAll = { ...sample, fields: { ...sample.fields }, [TABLE_DATED_KEY]: '2026-10-20' } as FormData
      for (const k of keys) if (k !== TABLE_DATED_KEY) withAll.fields[k] ??= '2026-10-20'
      const without = { ...sample, fields: Object.fromEntries(Object.entries(sample.fields).filter(([k]) => !keys.includes(k))) }
      const opts = { include: ['507a'] }
      const a = await pageTexts((await fillOfficialForm(code, withAll, opts)).pdf)
      const b = await pageTexts((await fillOfficialForm(code, without, opts)).pdf)
      expect(a).toEqual(b)
      // the signing name is still printed
      expect(a.join('\n')).toContain('Jordan Sample')
    },
  )

  it('a blank fill adds no text to any page', async () => {
    for (const code of FORM_CODES) {
      const blank = await fillOfficialForm(code, { fields: {} }, { tables: 'all', include: ['507a'] })
      const original = await pageTexts(await readTemplate(code))
      const { map } = formVersion(code)
      const order = [...map.formPages, ...(map.optionalPages ?? []).map((p) => p.page),
        ...(map.appendixCoverPage ? [map.appendixCoverPage] : []), ...new Set(map.tables.map((t) => t.page))]
      const filled = await pageTexts(blank.pdf)
      expect(filled).toEqual(order.map((p) => original[p - 1]))
    }
  })

  it('warns about a choice value that has no box', async () => {
    const r = await fillOfficialForm('507a', { fields: { ea_role: 'trustee' } })
    expect(r.warnings).toEqual([expect.objectContaining({ key: 'ea_role' })])
  })
})

describe('overflow', () => {
  it('cuts long answers, warns per question, and adds pages for 17+ table rows', async () => {
    const r = await fillOfficialForm('507b', OVERFLOW_PARTB)
    expect(r.warnings.map((w) => w.key).sort()).toEqual(['B28', 'b14_reasons', 'company_name'])
    // 9 form pages + appendix cover + two copies of the B28 page
    expect(r.pages).toBe(12)
    const texts = await pageTexts(r.pdf)
    const b28 = texts.filter((t) => t.includes('Table B28'))
    expect(b28).toHaveLength(2)
    expect(b28[0]).toContain('Example Adviser 17')
    expect(b28[0]).not.toContain('Example Adviser 18')
    expect(b28[1]).toContain('Example Adviser 20')
  })

  it('numbers continuation pages "Page 1 of 2", "Page 2 of 2"', async () => {
    const r = await fillOfficialForm('507b', OVERFLOW_PARTB)
    // The two B28 copies are the last two pages; read what is written in the
    // footer's "Page ___ of ___" (bottom right, below the grid).
    const doc = await getDocumentProxy(new Uint8Array(r.pdf))
    const footer = async (n: number) => {
      const content = await (await doc.getPage(n)).getTextContent()
      return content.items
        .flatMap((i) => ('str' in i && /^\d+$/.test(i.str) && i.transform[4] > 700 && i.transform[5] < 70 ? [i.str] : []))
    }
    expect(await footer(r.pages - 1)).toEqual(['1', '2'])
    expect(await footer(r.pages)).toEqual(['2', '2'])
  })

  it('keeps shrunk text centred on its row (A7 row 2: a long email beside full-size cells)', async () => {
    const r = await fillOfficialForm('507a', SAMPLE_PARTA)
    const t = formVersion('507a').map.tables.find((x) => x.id === 'A7')!
    const doc = await getDocumentProxy(new Uint8Array(r.pdf))
    const texts = await pageTexts(r.pdf)
    const page = await doc.getPage(texts.findIndex((s) => s.includes('Table A7')) + 1)
    const height = page.view[3]
    const items = (await page.getTextContent()).items.flatMap((i) => ('str' in i ? [i] : []))
    // Where the middle of the capitals sits, measured from the top of the page.
    const middle = (str: string) => {
      const it = items.find((i) => i.str === str)!
      const size = it.transform[3]
      return { size, top: height - (it.transform[5] + size * 0.359) }
    }
    const expected = (key: string) => {
      const col = t.columns.find((c) => c.key === key)!
      return t.rows[1].bot + t.skew! * (col.x0 - t.skewOrigin!) - 5.5 - 8 * 0.359
    }
    const email = middle('collections@example.com')
    const name = middle('Sample Finance Pty Ltd')
    expect(email.size).toBeLessThan(8) // it was shrunk to fit
    expect(name.size).toBe(8)
    expect(email.top).toBeCloseTo(expected('email'), 1)
    expect(name.top).toBeCloseTo(expected('name'), 1)
  })

  it('totals Part A A6 across all its rows on the last page', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ name: `Worker ${i + 1}`, wages: 100, total: 100 }))
    const r = await fillOfficialForm('507a', { fields: {}, tables: { A6_unrelated: rows } })
    const a6 = (await pageTexts(r.pdf)).filter((t) => t.includes('Table A6'))
    expect(a6).toHaveLength(2)
    expect(a6[0]).not.toContain('500')
    expect(a6[1]).toContain('500')
  })
})
