/**
 * The test every SBR page runs: no dollar amount is shown without its source.
 *
 * A text node that is an amount on its own ("$43,504", "($1,200)",
 * "$91,591.70 DR", "−$500") must sit inside a SourcedAmount (data-sourced="yes").
 * Amounts inside sentences — explanations, the calculation steps — are the
 * explanation themselves and are not checked; nor are the ATO's own rows as
 * printed (data-source-rows), which ARE the source, nor the calculation steps
 * shown in full (data-explanation), which are the working itself.
 */
const AMOUNT = /^[−+-]?\(?[−-]?\$\s?[\d,]+(\.\d+)?\)?(\s?(DR|CR))?$/

export function unsourcedAmounts(container: HTMLElement): string[] {
  const out: string[] = []
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim()
    if (!AMOUNT.test(text)) continue
    if (node.parentElement?.closest('[data-source-rows], [data-explanation]')) continue
    const sourced = node.parentElement?.closest('[data-sourced]')
    if (!sourced || sourced.getAttribute('data-sourced') !== 'yes') out.push(text)
  }
  return out
}
