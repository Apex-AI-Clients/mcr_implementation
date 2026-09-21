/**
 * Page-number arithmetic for the leads list.
 *
 * Pure and separate from the control that renders it, because the interesting
 * part is the ellipsis logic and that is far easier to assert as an array than
 * to read off the DOM.
 */

/** Rows per page. One place, so the server range and the UI cannot disagree. */
export const LEADS_PAGE_SIZE = 10

/** A gap in the run of page numbers, rendered as an ellipsis. */
export const GAP = 'gap' as const

export type PageItem = number | typeof GAP

/** Total pages for a row count. Always at least 1, so an empty list is page 1 of 1. */
export function pageCountFor(total: number, pageSize: number = LEADS_PAGE_SIZE): number {
  if (total <= 0) return 1
  return Math.ceil(total / pageSize)
}

/** A page number that is in range, whatever arrived in the URL. */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(pageCount, 1))
}

/** Zero-based row range for a page, inclusive — what Supabase `.range()` wants. */
export function rangeFor(page: number, pageSize: number = LEADS_PAGE_SIZE): [number, number] {
  const from = (page - 1) * pageSize
  return [from, from + pageSize - 1]
}

/**
 * The page numbers to show, with gaps.
 *
 *   pageItems(5, 10, 1) -> [1, gap, 4, 5, 6, gap, 10]
 *   pageItems(1, 10, 1) -> [1, 2, gap, 10]
 *   pageItems(5, 10, 0) -> [1, gap, 5, gap, 10]        (the narrow layout)
 *
 * First and last are always present, so the ends of the list stay one click
 * away however deep you are. `siblings` is how many neighbours flank the
 * current page — the only thing the responsive layouts vary.
 *
 * A gap is only emitted where it actually saves a slot: with a single page
 * hidden, the ellipsis and the number take the same room, so the number is
 * shown instead and the run stays contiguous.
 */
export function pageItems(current: number, pageCount: number, siblings: number = 1): PageItem[] {
  if (pageCount <= 1) return pageCount === 1 ? [1] : []

  const page = clampPage(current, pageCount)

  // The ends are always reachable, whatever the window is doing.
  const shown = new Set<number>([1, pageCount])
  for (let p = page - siblings; p <= page + siblings; p += 1) {
    if (p >= 1 && p <= pageCount) shown.add(p)
  }

  const sorted = [...shown].sort((a, b) => a - b)
  const items: PageItem[] = []

  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0) {
      const distance = sorted[i] - sorted[i - 1]
      // A gap that hides exactly one page is a worse deal than the page: same
      // width on screen, one fewer place to click.
      if (distance === 2) items.push(sorted[i] - 1)
      else if (distance > 2) items.push(GAP)
    }
    items.push(sorted[i])
  }

  return items
}

/** "11–20 of 47" — the count line beside the control. */
export function pageRangeLabel(page: number, pageSize: number, total: number): string {
  if (total <= 0) return 'No leads'
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return `${from}–${to} of ${total}`
}
