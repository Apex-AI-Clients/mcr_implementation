import type { Lead, LeadStage } from '@/types/leads'

/**
 * Follow-up rule.
 *
 * A lead needs chasing when it is still open and nothing has been recorded
 * against it for FOLLOW_UP_DAYS. The clock is reset by actions that prove a
 * human did something — saving a note, logging a call or email, setting a next
 * step, changing stage. It is NOT reset by opening the record, hovering,
 * filtering, exporting or dismissing: opening a record proves nothing.
 *
 * Closed stages never flag. There is nothing to chase.
 */

export const FOLLOW_UP_DAYS = 30

const DAY_MS = 86_400_000

/** Stages still in play. Exported so the stage select groups them as "Pipeline". */
export const OPEN_STAGES: LeadStage[] = ['lead', 'prospect', 'client']

export function needsFollowUp(lead: Lead, now: Date = new Date()): boolean {
  if (!OPEN_STAGES.includes(lead.stage)) return false
  const elapsed = now.getTime() - new Date(lead.lastActionAt).getTime()
  return elapsed > FOLLOW_UP_DAYS * DAY_MS
}

/** Open leads — the "47 open" figure on the workspace chooser. */
export function countOpenLeads(leads: Lead[]): number {
  return leads.filter((lead) => OPEN_STAGES.includes(lead.stage)).length
}

/** Open leads that have gone quiet past the threshold. */
export function countNeedingFollowUp(leads: Lead[], now: Date = new Date()): number {
  return leads.filter((lead) => needsFollowUp(lead, now)).length
}
