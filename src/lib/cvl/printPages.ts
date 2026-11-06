import type { FillOptions, FormMap } from '@/lib/forms/types'

/**
 * The pages a CVL form prints: every page of the official PDF, as Gabby asked
 * (6 Nov 2026): its optional pages (Part A's page 7, Form 507A), and every
 * appendix table page whether it has rows or not (A4, A5, A6 and A7; Part B's
 * B2, B3, B21 and B28), with more copies of a page when its rows run over. So
 * the printout, the preview and the screen's questions are the whole form,
 * page for page. Pure.
 */
export function cvlFillOptions(map: Pick<FormMap, 'optionalPages'>): FillOptions {
  return { include: (map.optionalPages ?? []).map((p) => p.id), tables: 'all' }
}
