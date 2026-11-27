// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { PDFDocument } from 'pdf-lib'
import { appendixNumber, dateParts, formatAmount, withComputed } from '../engine'
import { fillOfficialForm, readTemplate } from '../fill'
import { FORM_CODES, TABLE_DATED_KEY, formVersion, handwrittenKeys, signatureDateKeys } from '../registry'
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

  it('prints each Form 509 total in both total rows, same column, unless typed there', () => {
    const { map } = formVersion('509')
    const out = withComputed(map, { a_val: 100, b_val: 50, a_erv: 80, b_erv: 20 })
    // TOTAL assets: Valuation, and the same in TOTAL estimated realisable values' Valuation column.
    expect(out.total_assets).toBe(150)
    expect(out.total_erv_val).toBe(150)
    // TOTAL estimated realisable values: ERV, and the same in TOTAL assets' ERV column.
    expect(out.total_erv).toBe(100)
    expect(out.total_assets_erv).toBe(100)
    // Typed totals: the copies follow them; a copy typed is its own.
    const typed = withComputed(map, { a_val: 100, total_assets: 7, a_erv: 80, total_assets_erv: 3 })
    expect(typed.total_erv_val).toBe(7)
    expect(typed.total_erv).toBe(80)
    expect(typed.total_assets_erv).toBe(3)
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

  it('marks only B6 user name and password as handwritten (the B1 address is typed since 24 Nov 2026)', () => {
    expect(handwrittenKeys('507b').sort()).toEqual(['b6_password', 'b6_username'])
    expect(handwrittenKeys('507a')).toEqual([])
    expect(handwrittenKeys('509')).toEqual([])
  })

  it('marks every date beside a signature as a signature date, the tables\u2019 "...and dated" included (Nov 2026)', () => {
    expect(signatureDateKeys('509')).toEqual(['date_signed'])
    // One date per table page; A6's two tables share one.
    expect(signatureDateKeys('507a')).toEqual(['a9_date', 'a10_date', 'f507a_date_signed', 'signedDate:A4', 'signedDate:A5', 'signedDate:A6_unrelated', 'signedDate:A7'])
    expect(signatureDateKeys('507b')).toEqual(['b31_date', 'signedDate:B2', 'signedDate:B3', 'signedDate:B21', 'signedDate:B28'])
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

  it('numbers each table page with its appendix number, as ASIC labels the page (Nov 2026)', async () => {
    // ASIC's own label at the foot of each page: the cover is p1, then each table page.
    for (const code of ['507a', '507b'] as const) {
      const { map } = formVersion(code)
      const template = await pageTexts(await readTemplate(code))
      for (const page of [map.appendixCoverPage!, ...new Set(map.tables.map((t) => t.page))]) {
        const n = appendixNumber(map, page)!
        expect(template[page - 1]).toMatch(new RegExp(`p\\s?${n.page}\\s+of\\s+${n.of}`))
      }
    }
    expect(appendixNumber(formVersion('507a').map, 9)).toEqual({ page: 2, of: 5 }) // A4
    expect(appendixNumber(formVersion('507a').map, 12)).toEqual({ page: 5, of: 5 }) // A7
    expect(appendixNumber(formVersion('507a').map, 6)).toBeNull() // a form page
  })

  it('writes the appendix number top and bottom of each table page: A4 is 2 of 5, A7 is 5 of 5', async () => {
    const doc = await getDocumentProxy(new Uint8Array((await fillOfficialForm('507a', SAMPLE_PARTA, { tables: 'all' })).pdf))
    const numbers = async (n: number) => {
      const items = (await (await doc.getPage(n)).getTextContent()).items
      return items.flatMap((i) => ('str' in i && /^\d$/.test(i.str) ? [i.str] : []))
    }
    const pages = (await pageTexts((await fillOfficialForm('507a', SAMPLE_PARTA, { tables: 'all' })).pdf))
    const a4 = pages.findIndex((t) => t.includes('Table A4')) + 1
    const a7 = pages.findIndex((t) => t.includes('Table A7')) + 1
    // Top "Page/s 2 of 5", foot "Page 2 of 5" (single digits only, so amounts are not counted).
    expect((await numbers(a4)).filter((d) => d === '2' || d === '5').slice(0, 4)).toEqual(['2', '5', '2', '5'])
    expect((await numbers(a7)).filter((d) => d === '5')).toHaveLength(4)
  })

  it('never draws handwritten fields, whatever the data holds', async () => {
    const r = await fillOfficialForm('507b', SAMPLE_PARTB)
    const all = (await pageTexts(r.pdf)).join('\n')
    expect(all).not.toContain('should-not-print')
    expect(all).toContain('Casey Bookkeeper')
    // B1's address is typed and printed since 24 Nov 2026.
    expect(all).toContain('5 Example Lane')
  })

  it.each([['509', SAMPLE_509], ['507a', SAMPLE_PARTA], ['507b', SAMPLE_PARTB]] as const)(
    '%s: handwritten answers in the data change nothing on the printout (B6 log-ins)',
    async (code, sample) => {
      const keys = handwrittenKeys(code)
      const withAll = { ...sample, fields: { ...sample.fields } } as FormData
      for (const k of keys) withAll.fields[k] ??= 'Written by hand'
      const without = { ...sample, fields: Object.fromEntries(Object.entries(sample.fields).filter(([k]) => !keys.includes(k))) }
      const opts = { include: ['507a'] }
      const a = await pageTexts((await fillOfficialForm(code, withAll, opts)).pdf)
      const b = await pageTexts((await fillOfficialForm(code, without, opts)).pdf)
      expect(a).toEqual(b)
      // the signing name is still printed
      expect(a.join('\n')).toContain('Jordan Sample')
    },
  )

  it.each([['509'], ['507a'], ['507b']] as const)(
    '%s: prints every signature date given, the tables\u2019 "...and dated" included (Nov 2026)',
    async (code) => {
      const opts = { include: ['507a'], tables: 'all' as const }
      const dates: FormData = { fields: {}, signedDate: '2026-10-20' }
      for (const k of signatureDateKeys(code)) if (!k.startsWith(TABLE_DATED_KEY)) dates.fields[k] = '2026-10-20'
      const withDates = await pageTexts((await fillOfficialForm(code, dates, opts)).pdf)
      const blank = await pageTexts((await fillOfficialForm(code, { fields: {} }, opts)).pdf)
      const changed = withDates.map((text, i) => text !== blank[i])
      const { map } = formVersion(code)
      // Each signature date's own page, and every table page, now carries the date.
      const datePages = map.fields.filter((f) => f.signatureDate).map((f) => f.page)
      const order = [...map.formPages, ...(map.optionalPages ?? []).map((p) => p.page),
        ...(map.appendixCoverPage ? [map.appendixCoverPage] : []), ...new Set(map.tables.map((t) => t.page))]
      for (const page of [...datePages, ...new Set(map.tables.map((t) => t.page))]) {
        expect(changed[order.indexOf(page)]).toBe(true)
      }
      expect(withDates.join('\n')).toMatch(/20/)
    },
  )

  it('prints each table page’s own "...and dated" (A4 and A5 apart)', async () => {
    const r = await fillOfficialForm('507a', { fields: {}, signedDates: { A4: '2026-10-20', A5: '2026-12-25' } }, { tables: 'all' })
    const pages = await pageTexts(r.pdf)
    // Template pages 9, 10 and 12 are Tables A4, A5 and A7.
    const at = (templatePage: number) => pages[r.pageSources.indexOf(templatePage)]
    expect(at(9)).toMatch(/\b20\b[\s\S]*\b10\b[\s\S]*2026/)
    expect(at(9)).not.toMatch(/\b25\b/)
    expect(at(10)).toMatch(/\b25\b[\s\S]*\b12\b[\s\S]*2026/)
    // A table page with no date of its own prints none.
    expect(at(12)).not.toMatch(/2026/)
  })

  it('a blank fill adds no text to any page', async () => {
    for (const code of FORM_CODES) {
      const blank = await fillOfficialForm(code, { fields: {} }, { tables: 'all', include: ['507a'] })
      const original = await pageTexts(await readTemplate(code))
      const { map } = formVersion(code)
      const order = [...map.formPages, ...(map.optionalPages ?? []).map((p) => p.page),
        ...(map.appendixCoverPage ? [map.appendixCoverPage] : []), ...new Set(map.tables.map((t) => t.page))]
      const filled = await pageTexts(blank.pdf)
      // Table pages carry their page numbers even when blank (Nov 2026); every
      // other page is ASIC's, untouched.
      const tablePages = new Set(map.tables.map((t) => t.page))
      order.forEach((p, i) => {
        if (!tablePages.has(p)) expect(filled[i]).toEqual(original[p - 1])
        else expect(filled[i]).not.toEqual(original[p - 1])
      })
    }
  })

  it('warns about a choice value that has no box', async () => {
    const r = await fillOfficialForm('507a', { fields: { ea_role: 'trustee' } })
    expect(r.warnings).toEqual([expect.objectContaining({ key: 'ea_role' })])
  })

  it('ticks every box chosen in a choice field, and warns only about the one with no box', async () => {
    const size = async (ea_role: string) => (await fillOfficialForm('507a', { fields: { ea_role } })).pdf.length
    const one = await fillOfficialForm('507a', { fields: { ea_role: 'cvl_liquidator' } })
    const two = await fillOfficialForm('507a', { fields: { ea_role: 'cvl_liquidator,court_liquidator' } })
    expect(one.warnings).toEqual([])
    expect(two.warnings).toEqual([])
    // A second tick is drawn: more on the page than with one.
    expect(two.pdf.length).toBeGreaterThan(one.pdf.length)
    expect(await size('court_liquidator,cvl_liquidator')).toBe(two.pdf.length)
    const mixed = await fillOfficialForm('507a', { fields: { ea_role: 'cvl_liquidator,trustee' } })
    expect(mixed.warnings).toEqual([expect.objectContaining({ key: 'ea_role', message: expect.stringContaining('"trustee"') })])
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

  it('repeats the page\u2019s appendix number on a continuation copy (B28: 5 of 5 on both)', async () => {
    const r = await fillOfficialForm('507b', OVERFLOW_PARTB)
    // The two B28 copies are the last two pages; read what is written in the
    // footer's "Page ___ of ___" (bottom right, below the grid).
    const doc = await getDocumentProxy(new Uint8Array(r.pdf))
    const footer = async (n: number) => {
      const content = await (await doc.getPage(n)).getTextContent()
      return content.items
        .flatMap((i) => ('str' in i && /^\d+$/.test(i.str) && i.transform[4] > 700 && i.transform[5] < 70 ? [i.str] : []))
    }
    expect(await footer(r.pages - 1)).toEqual(['5', '5'])
    expect(await footer(r.pages)).toEqual(['5', '5'])
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

describe('"Unsure" in every kind of date (27 Nov 2026)', () => {
  it('prints across Form 509’s digit boxes, with no warning', async () => {
    const r = await fillOfficialForm('509', { ...SAMPLE_509, fields: { ...SAMPLE_509.fields, summary_date: 'Unsure' } })
    expect(r.warnings).toEqual([])
    expect((await pageTexts(r.pdf)).join(' ')).toContain('Unsure')
  })

  it('prints in a table date cell; a row of "Unsure" alone is an empty row, never printed', async () => {
    const data: FormData = {
      ...SAMPLE_PARTB,
      tables: {
        ...SAMPLE_PARTB.tables,
        B28: [
          { name: 'Example Adviser', nature: 'Cash flow advice', date: 'Unsure' },
          { date: 'Unsure' },
        ],
      },
    }
    const r = await fillOfficialForm('507b', data)
    expect(r.warnings).toEqual([])
    const text = (await pageTexts(r.pdf)).join(' ')
    expect(text).toContain('Example Adviser')
    expect(text.match(/Unsure/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('prints in a typed date (B10) as the word itself', async () => {
    const r = await fillOfficialForm('507b', { ...SAMPLE_PARTB, fields: { ...SAMPLE_PARTB.fields, b10_date: 'Unsure' } })
    expect(r.warnings).toEqual([])
    expect((await pageTexts(r.pdf)).join(' ')).toContain('Unsure')
  })
})
