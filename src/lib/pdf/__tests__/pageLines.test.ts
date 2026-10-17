import { describe, it, expect } from 'vitest'
import type { StructuredTextItem } from 'unpdf'
import { groupIntoCells, groupIntoLines } from '../pageLines'

/** Line and cell grouping on hand-made text items. */

/** Width defaults to Helvetica at 9pt, roughly. */
function item(x: number, y: number, str: string, width = str.length * 4.5): StructuredTextItem {
  return {
    str,
    x,
    y,
    width,
    height: 9,
    fontSize: 9,
    fontName: 'F1',
    fontFamily: 'sans-serif',
    dir: 'ltr',
    hasEOL: false,
  } as unknown as StructuredTextItem
}

describe('groupIntoCells', () => {
  it('splits a line where the gap is wider than a space', () => {
    const [line] = groupIntoCells([
      item(57, 700, 'MR JANE SAMPLE'),
      item(387, 700, 'Our reference:'),
      item(462, 700, '1234567890123'),
    ])
    expect(line.cells.map((cell) => cell.text)).toEqual([
      'MR JANE SAMPLE',
      'Our reference:',
      '1234567890123',
    ])
    expect(line.text).toBe('MR JANE SAMPLE Our reference: 1234567890123')
  })

  it('joins a word pdf.js split into pieces, and words a space apart', () => {
    const [line] = groupIntoCells([item(60, 700, 'Col', 15), item(75, 700, 'umn', 20), item(97, 700, '2', 5)])
    expect(line.cells).toEqual([{ x: 60, right: 102, text: 'Column 2' }])
  })

  it('keeps the right edge, where right-aligned figures line up', () => {
    const [line] = groupIntoCells([item(220, 700, '12,345.67', 40)])
    expect(line.cells[0]).toEqual({ x: 220, right: 260, text: '12,345.67' })
  })

  it('reads rows top to bottom, as groupIntoLines does', () => {
    const items = [item(60, 600, 'second'), item(60, 700, 'first')]
    expect(groupIntoCells(items).map((line) => line.text)).toEqual(groupIntoLines(items))
  })
})
