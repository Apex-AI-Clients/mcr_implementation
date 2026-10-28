import { formatShortDate } from './format'

/** A note staff wrote on a lead, as the leads list shows it. */
export interface LeadNote {
  body: string
  author: string
  createdAt: string
}

/** The line over each note in the tooltip: when, and who wrote it. */
export function noteHeading(note: LeadNote): string {
  return `${formatShortDate(note.createdAt)} · ${note.author}`
}
