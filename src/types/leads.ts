/**
 * CRM lead types.
 *
 * Introduced in Stage 1 so the workspace chooser can report real lead counts.
 * The list and record UI arrive in Stage 2; persistence in Stage 4.
 */

export type LeadStage =
  | 'lead'
  | 'prospect'
  | 'client'
  | 'converted'
  | 'non_proceeding'
  | 'do_not_contact'

export type LeadSource = 'facebook' | 'website' | 'google_form' | 'manual'

export type LeadActivityType = 'note' | 'call' | 'email' | 'next_step' | 'stage_change'

/**
 * Superset of what the website form offers (it has no NT) — Facebook and manual
 * entry may still supply it.
 */
export type AuState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT'

/**
 * A qualifying question, not metadata: SBR is available to incorporated
 * companies, and a Trust is a different path.
 */
export type EntityType = 'company' | 'trust'

export interface Lead {
  id: string
  name: string
  email: string
  phone: string
  /**
   * Debt as a range in whole dollars, because every capture form asks for one.
   * Null min means unknown; null max means open-ended ("$150,000 or +"). Storing
   * a range rather than an enum lets forms with different bracket sets map
   * without losing information.
   */
  debtMin: number | null
  debtMax: number | null
  /**
   * Null when the capture form's state select was left on its default — it
   * posts the literal string "state", which must never be stored. Manual entry
   * still requires one.
   */
  state: AuState | null
  /** Null when the form didn't ask, or posted its unselected sentinel. */
  entityType: EntityType | null
  /** What the lead wrote on the capture form. Their words, not ours. */
  message: string | null
  /** Free text, e.g. "after 6pm". Record only — too variable for a column. */
  preferredCallTime: string | null
  stage: LeadStage
  source: LeadSource
  /** Optional on the record, deliberately absent from the capture form. */
  company: string | null
  nextStep: string | null
  /** ISO — when the lead entered its current stage. */
  stageSince: string
  /** ISO — the follow-up clock. Reset only by a recorded human action. */
  lastActionAt: string
  convertedClientId: string | null
  createdAt: string
  updatedAt: string
}

export interface LeadActivity {
  id: string
  leadId: string
  type: LeadActivityType
  body: string
  author: string
  createdAt: string
}
