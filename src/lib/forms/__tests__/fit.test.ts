// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { fillOfficialForm } from '../fill'
import { FORM_CODES, formVersion } from '../registry'
import { cellRoomOf, measureHelvetica, overflowOf, roomOf, type Room } from '../fit'
import type { FormCode, FormData, TableRow } from '../types'

// Synthetic text only: made-up words, never client data.
const WORDS = ['Lorem', 'ipsum', 'dolor', 'sit', 'amet', 'Pty', 'Ltd', 'Street', 'Wollongong', 'NSW', '2500', 'WWW']
function text(len: number, seed: number): string {
  let s = ''
  for (let i = seed; s.length < len; i++) s += (s ? ' ' : '') + WORDS[(i * 7) % WORDS.length]
  return s.slice(0, len).trim()
}
const SAMPLES = [
  ...[6, 30, 60, 100, 180, 400].map((n, i) => text(n, i)),
  'averyveryverylongemailaddress.withnospaces@example-company-name.com.au',
  'Zoë   Ngụyễn — “Example” Holdings',
  'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW WWWWWWWWWWWWWWWWWWWW',
  // Amounts: formatted before measuring ("1,250,000"), and a very long one.
  '1250000',
  '-98765432109876.55',
]

describe('measuring as pdf-lib does', () => {
  it('matches pdf-lib Helvetica widths, kerning included', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    for (const s of ['AVAWAY To. Ty', 'Hello, World! 123', 'yÿ âêî «»', ...SAMPLES.map((x) => x.replace(/[^\x20-\x7e]/g, 'e'))]) {
      expect(measureHelvetica(s, 9)).toBeCloseTo(font.widthOfTextAtSize(s, 9), 6)
    }
  })
})

describe('overflow predicted on screen = cut on the printout', () => {
  it.each(FORM_CODES.map((c) => [c] as [FormCode]))('%s: every free-text and amount box, and every table cell', async (code) => {
    const { map } = formVersion(code)
    const rooms = new Map<string, Room>()
    for (const f of map.fields) {
      const r = f.handwritten ? null : roomOf(f)
      if (r) rooms.set(f.key, r)
    }
    for (const t of map.tables) for (const c of t.columns) {
      const r = cellRoomOf(c)
      if (r) rooms.set(`${t.id}.${c.key}`, r)
    }
    expect(rooms.size).toBeGreaterThan(0)

    for (const [i, sample] of SAMPLES.entries()) {
      const data: FormData = { fields: {}, tables: {} }
      const expected = new Set<string>()
      for (const [k, room] of rooms) {
        // Each box a slightly different sample, so boxes of the same width are tested at different lengths.
        const value = SAMPLES[(i + k.length) % SAMPLES.length] ?? sample
        if (overflowOf(room, value) > 0) expected.add(k)
        const [tableId, col] = k.includes('.') ? k.split('.') : [null, null]
        if (tableId && col) {
          const rows = (data.tables![tableId] ??= [{}] as TableRow[])
          rows[0][col] = value
        } else data.fields[k] = value
      }
      // Optional pages too (Part A's Form 507A page), so every box is drawn.
      const r = await fillOfficialForm(code, data, { include: (map.optionalPages ?? []).map((p) => p.id) })
      const warned = new Set(r.warnings.map((w) => w.key).filter((k) => rooms.has(k)))
      expect([...warned].sort(), `sample set ${i}`).toEqual([...expected].sort())
    }
  }, 180_000)

  it('counts the characters that won’t print', () => {
    const room: Room = { kind: 'line', maxW: 100, size: 9 }
    expect(overflowOf(room, 'Short')).toBe(0)
    expect(overflowOf(room, '   ')).toBe(0)
    const long = text(200, 3)
    const over = overflowOf(room, long)
    expect(over).toBeGreaterThan(0)
    // What is left fits at the smallest size; one more character would not.
    const kept = long.slice(0, long.length - over)
    expect(measureHelvetica(kept, 6)).toBeLessThanOrEqual(100.5)
    expect(measureHelvetica(long.slice(0, kept.length + 1), 6)).toBeGreaterThan(100.5)
  })

  it('lines: wraps over every printed line before anything is lost', () => {
    const room: Room = { kind: 'lines', wrapW: 200, lineWs: [200, 200] }
    expect(overflowOf(room, text(60, 1))).toBe(0)
    expect(overflowOf(room, text(400, 1))).toBeGreaterThan(0)
  })
})
