import type { FillOptions, FormMap } from '@/lib/forms/types'

/**
 * The pages a CVL form prints: every page of the official PDF, its optional
 * pages included (Part A's page 7, Form 507A), so the printout, the preview
 * and the screen's questions are the whole form, page for page. Pure.
 */
export function cvlFillOptions(map: Pick<FormMap, 'optionalPages'>): FillOptions {
  return { include: (map.optionalPages ?? []).map((p) => p.id) }
}
