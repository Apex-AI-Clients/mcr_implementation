import { describe, it, expect } from 'vitest'
import {
  GAP,
  LEADS_PAGE_SIZE,
  clampPage,
  pageCountFor,
  pageItems,
  pageRangeLabel,
  rangeFor,
} from '../pagination'

describe('pageCountFor', () => {
  it('rounds a partial last page up', () => {
    expect(pageCountFor(10, 10)).toBe(1)
    expect(pageCountFor(11, 10)).toBe(2)
    expect(pageCountFor(47, 10)).toBe(5)
  })

  it('calls an empty list one page, not zero', () => {
    // Page 0 of 0 would make the control render nothing and the URL ?page=0
    // legal. An empty list is page 1 of 1 with no rows on it.
    expect(pageCountFor(0, 10)).toBe(1)
  })
})

describe('clampPage', () => {
  it('pulls an out-of-range page back into range', () => {
    // ?page=999 is a bookmark to a page that has since emptied, or a typed URL.
    expect(clampPage(999, 5)).toBe(5)
    expect(clampPage(0, 5)).toBe(1)
    expect(clampPage(-3, 5)).toBe(1)
  })

  it('survives junk in the URL', () => {
    expect(clampPage(Number.NaN, 5)).toBe(1)
    expect(clampPage(2.7, 5)).toBe(2)
  })
})

describe('rangeFor', () => {
  it('is inclusive at both ends, as Supabase .range() expects', () => {
    expect(rangeFor(1, 10)).toEqual([0, 9])
    expect(rangeFor(2, 10)).toEqual([10, 19])
    expect(rangeFor(5, 10)).toEqual([40, 49])
  })
})

describe('pageItems', () => {
  it('keeps the ends reachable from the middle', () => {
    expect(pageItems(5, 10, 1)).toEqual([1, GAP, 4, 5, 6, GAP, 10])
  })

  it('needs no leading gap near the start', () => {
    expect(pageItems(1, 10, 1)).toEqual([1, 2, GAP, 10])
    expect(pageItems(2, 10, 1)).toEqual([1, 2, 3, GAP, 10])
    expect(pageItems(3, 10, 1)).toEqual([1, 2, 3, 4, GAP, 10])
  })

  it('needs no trailing gap near the end', () => {
    expect(pageItems(10, 10, 1)).toEqual([1, GAP, 9, 10])
    expect(pageItems(9, 10, 1)).toEqual([1, GAP, 8, 9, 10])
  })

  it('shows the page rather than a gap when only one would be hidden', () => {
    // An ellipsis standing in for a single number is the same width and one
    // fewer destination, so page 2 is shown instead.
    expect(pageItems(4, 10, 1)).toEqual([1, 2, 3, 4, 5, GAP, 10])
  })

  it('stays contiguous when everything fits', () => {
    expect(pageItems(3, 5, 1)).toEqual([1, 2, 3, 4, 5])
    expect(pageItems(1, 3, 1)).toEqual([1, 2, 3])
    expect(pageItems(1, 2, 1)).toEqual([1, 2])
  })

  it('collapses hard for the narrow layout', () => {
    // siblings = 0 is what the phone breakpoint uses: the ends, the current
    // page, and nothing else.
    expect(pageItems(5, 10, 0)).toEqual([1, GAP, 5, GAP, 10])
    // No neighbours at all, so the ends carry the whole control and Prev/Next
    // do the walking — two numbers, which is the point on a phone.
    expect(pageItems(1, 10, 0)).toEqual([1, GAP, 10])
    expect(pageItems(10, 10, 0)).toEqual([1, GAP, 10])
    // Page 3 is two from the start, so the single hidden page is shown rather
    // than elided.
    expect(pageItems(3, 10, 0)).toEqual([1, 2, 3, GAP, 10])
  })

  it('renders a single page as itself and nothing for none', () => {
    expect(pageItems(1, 1, 1)).toEqual([1])
    expect(pageItems(1, 0, 1)).toEqual([])
  })

  it('never emits a duplicate or an out-of-order page', () => {
    for (let pageCount = 1; pageCount <= 24; pageCount += 1) {
      for (let page = 1; page <= pageCount; page += 1) {
        for (const siblings of [0, 1, 2]) {
          const items = pageItems(page, pageCount, siblings)
          const numbers = items.filter((item): item is number => item !== GAP)
          expect(new Set(numbers).size).toBe(numbers.length)
          expect([...numbers].sort((a, b) => a - b)).toEqual(numbers)
          expect(numbers).toContain(page)
          expect(numbers[0]).toBe(1)
          expect(numbers[numbers.length - 1]).toBe(pageCount)
          // Two gaps never touch, and a gap never sits at either end.
          expect(items[0]).not.toBe(GAP)
          expect(items[items.length - 1]).not.toBe(GAP)
        }
      }
    }
  })

  it('clamps a current page that is out of range', () => {
    expect(pageItems(99, 10, 1)).toEqual(pageItems(10, 10, 1))
  })
})

describe('pageRangeLabel', () => {
  it('describes the slice on screen', () => {
    expect(pageRangeLabel(1, 10, 47)).toBe('1–10 of 47')
    expect(pageRangeLabel(2, 10, 47)).toBe('11–20 of 47')
    // The last page stops at the total, not at the page boundary.
    expect(pageRangeLabel(5, 10, 47)).toBe('41–47 of 47')
  })

  it('says so when there is nothing', () => {
    expect(pageRangeLabel(1, 10, 0)).toBe('No leads')
  })
})

describe('LEADS_PAGE_SIZE', () => {
  it('is 10', () => {
    expect(LEADS_PAGE_SIZE).toBe(10)
  })
})
