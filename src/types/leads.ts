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

export type AuState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT'

export interface Lead {
  id: string
  name: string
  email: string
  phone: string
  /** Integer cents. These figures drive insolvency decisions — never a float. */
  debtAmount: number
  state: AuState
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
