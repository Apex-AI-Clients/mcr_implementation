/**
 * Where the "Export PDF" button cuts a page region into A4 pages (ExportPdfButton.tsx). Pure.
 *
 * The region is measured as blocks (vertical spans, in the same unit as `pageHeight`): its
 * sections, and inside any section taller than a page, that section's own blocks (a card's
 * parts, a table's rows). Each page starts at a block and takes every following block that
 * fits whole; a single block still taller than a page is sliced. So a short heading followed
 * by a long card no longer leaves the first page nearly blank (the card used to move to page
 * two whole, then be sliced there).
 */

export interface Span {
  top: number
  bottom: number
}

/** Blocks sorted, and any that overlap (side by side in a row) merged into one. */
export function normaliseBlocks(blocks: Span[]): Span[] {
  const sorted = blocks.filter((b) => b.bottom > b.top).sort((a, b) => a.top - b.top || a.bottom - b.bottom)
  const out: Span[] = []
  for (const b of sorted) {
    const last = out[out.length - 1]
    if (last && b.top < last.bottom) last.bottom = Math.max(last.bottom, b.bottom)
    else out.push({ ...b })
  }
  return out
}

/**
 * The pages, as spans of the region. Each page takes every block that fits whole; when the next
 * block is taller than a page on its own (it cannot fit any page whole), the page is filled to the
 * bottom and that block is sliced from there, so no page is left short before it.
 */
export function paginate(blocks: Span[], pageHeight: number): Span[] {
  const b = normaliseBlocks(blocks)
  const pages: Span[] = []
  let cursor = b.length ? b[0].top : 0
  let i = 0
  while (i < b.length) {
    const top = Math.max(cursor, b[i].top)
    let j = i
    while (j < b.length && b[j].bottom - top <= pageHeight) j++
    if (j < b.length && b[j].bottom - b[j].top > pageHeight) {
      // The next block is sliced anyway: fill this page with its first part.
      pages.push({ top, bottom: top + pageHeight })
      cursor = top + pageHeight
      i = j
      continue
    }
    pages.push({ top, bottom: b[j - 1].bottom })
    cursor = b[j - 1].bottom
    i = j
  }
  return pages
}

/**
 * The blocks of an element, relative to `originTop`: each visible child, and inside a child
 * taller than `pageHeight`, its own children (to `maxDepth` levels). DOM only.
 */
export function measureBlocks(el: Element, originTop: number, pageHeight: number, maxDepth = 6): Span[] {
  const out: Span[] = []
  for (const child of Array.from(el.children)) {
    const html = child as HTMLElement
    if (getComputedStyle(html).display === 'none') continue
    const r = html.getBoundingClientRect()
    if (r.height === 0) continue
    const span = { top: r.top - originTop, bottom: r.bottom - originTop }
    if (span.bottom - span.top > pageHeight && maxDepth > 0 && html.children.length > 0) {
      const inner = measureBlocks(html, originTop, pageHeight, maxDepth - 1)
      if (inner.length > 0) {
        // The section's own padding goes with its first and last blocks.
        inner[0].top = Math.min(inner[0].top, span.top)
        inner[inner.length - 1].bottom = Math.max(inner[inner.length - 1].bottom, span.bottom)
        out.push(...inner)
        continue
      }
    }
    out.push(span)
  }
  return out
}
