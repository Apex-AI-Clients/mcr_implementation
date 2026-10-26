import { formatShortDate } from './format'
import type { LeadView } from './constants'

/** The tabs with a notes column: the leads that went nowhere, and those not to contact. */
export const NOTES_VIEWS: readonly LeadView[] = ['non_proceeding', 'do_not_contact']

/** A note staff wrote on a lead, as the leads list shows it. */
export interface LeadNote {
  body: string
  author: string
  createdAt: string
}

/** Notes shown in the tooltip before "and N more on the record". */
export const NOTES_SHOWN = 5

/**
 * The tooltip text for a lead's notes, newest first: the date and who wrote
 * each, then the note. Long lists stop at NOTES_SHOWN — the record has them all.
 */
export function notesTooltip(notes: readonly LeadNote[]): string {
  const shown = notes.slice(0, NOTES_SHOWN).map((n) => `${formatShortDate(n.createdAt)} · ${n.author}\n${n.body.trim()}`)
  const more = notes.length - NOTES_SHOWN
  return [...shown, ...(more > 0 ? [`…and ${more} more on the record`] : [])].join('\n\n')
}
