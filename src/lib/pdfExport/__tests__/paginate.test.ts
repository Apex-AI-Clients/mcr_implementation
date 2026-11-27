import { describe, expect, it } from 'vitest'
import { measureBlocks, normaliseBlocks, paginate } from '../paginate'

/** Where Export PDF cuts a page region into pages. Heights in CSS pixels; a page holds 1000. */

describe('paginate', () => {
  it('a short heading and a long card cut into its blocks: the first page is full, not nearly blank', () => {
    // Heading 0–80; the card's own blocks 100–600, 600–1100, 1100–1500.
    const pages = paginate(
      [
        { top: 0, bottom: 80 },
        { top: 100, bottom: 600 },
        { top: 600, bottom: 1100 },
        { top: 1100, bottom: 1500 },
      ],
      1000,
    )
    expect(pages).toEqual([
      { top: 0, bottom: 600 },
      { top: 600, bottom: 1500 },
    ])
  })

  it('a heading, then one block taller than a page that cannot be cut: the first page is filled, the block sliced from there', () => {
    const pages = paginate(
      [
        { top: 0, bottom: 80 },
        { top: 100, bottom: 2300 },
      ],
      1000,
    )
    expect(pages).toEqual([
      { top: 0, bottom: 1000 },
      { top: 1000, bottom: 2000 },
      { top: 2000, bottom: 2300 },
    ])
  })

  it('the rest of a sliced block shares its page with the blocks after it', () => {
    expect(
      paginate(
        [
          { top: 0, bottom: 1500 },
          { top: 1500, bottom: 1700 },
          { top: 1700, bottom: 2600 },
        ],
        1000,
      ),
    ).toEqual([
      { top: 0, bottom: 1000 },
      { top: 1000, bottom: 1700 },
      { top: 1700, bottom: 2600 },
    ])
  })

  it('the two top cards, then a panel just shorter than a page: page 1 is filled, not left with the cards alone', () => {
    // The lodgement page (Aziz Hoque, 20 Nov 2026 export): cards 0–150, then a 900-high panel measured whole.
    const pages = paginate(
      [
        { top: 0, bottom: 150 },
        { top: 170, bottom: 1070 },
        { top: 1090, bottom: 1500 },
      ],
      1000,
    )
    expect(pages[0]).toEqual({ top: 0, bottom: 1000 })
    expect(pages.every((p) => p.bottom - p.top <= 1000)).toBe(true)
    expect(pages.at(-1)!.bottom).toBe(1500)
  })

  it('a page more than a third full may still end before a block that does not fit', () => {
    expect(
      paginate(
        [
          { top: 0, bottom: 500 },
          { top: 520, bottom: 1300 },
        ],
        1000,
      ),
    ).toEqual([
      { top: 0, bottom: 500 },
      { top: 520, bottom: 1300 },
    ])
  })

  it('blocks side by side in a row are one block; every block is on a page', () => {
    expect(normaliseBlocks([{ top: 50, bottom: 120 }, { top: 0, bottom: 40 }, { top: 50, bottom: 100 }])).toEqual([
      { top: 0, bottom: 40 },
      { top: 50, bottom: 120 },
    ])
    const blocks = Array.from({ length: 30 }, (_, i) => ({ top: i * 90, bottom: i * 90 + 80 }))
    const pages = paginate(blocks, 1000)
    for (const b of blocks) expect(pages.some((p) => p.top <= b.top && b.bottom <= p.bottom)).toBe(true)
    expect(pages.every((p) => p.bottom - p.top <= 1000)).toBe(true)
  })
})

describe('measureBlocks', () => {
  const box = (top: number, bottom: number, children: HTMLElement[] = []) => {
    const el = document.createElement('div')
    children.forEach((c) => el.appendChild(c))
    el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
    return el
  }

  it('looks inside a section taller than a page; keeps a shorter one whole; skips hidden ones', () => {
    const hidden = box(0, 50)
    hidden.style.display = 'none'
    const root = box(0, 2400, [
      box(0, 80, [box(0, 40), box(40, 80)]),
      hidden,
      box(100, 2300, [box(100, 200), box(220, 1200), box(1200, 2280)]),
    ])
    expect(measureBlocks(root, 0, 1000)).toEqual([
      { top: 0, bottom: 80 },
      { top: 100, bottom: 200 },
      { top: 220, bottom: 1200 },
      // The card's own bottom padding goes with its last block.
      { top: 1200, bottom: 2300 },
    ])
  })

  it('looks inside a section taller than a quarter of a page, so a page can end between its rows', () => {
    const panel = box(170, 1070, [box(170, 400), box(400, 700), box(700, 1070)])
    const root = box(0, 1500, [box(0, 150), panel])
    expect(measureBlocks(root, 0, 1000)).toEqual([
      { top: 0, bottom: 150 },
      { top: 170, bottom: 400 },
      { top: 400, bottom: 700 },
      { top: 700, bottom: 1070 },
    ])
  })
})
