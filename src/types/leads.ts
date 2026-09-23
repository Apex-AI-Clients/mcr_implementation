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
  /**
   * What the lead said about their state when it did not come down to one.
   * Only ever set when `state` is null:
   *   - a grouped option ("NSW, VIC, ACT, TAS"), as display labels — some Meta
   *     forms offer regions as single options, and a lead who picks one could
   *     be in any of them;
   *   - an answer that did not resolve, exactly as it arrived.
   */
  metaStateRaw: string | null
  /**
   * The states a grouped answer resolved to. Null unless there were several.
   * The state filter matches on these, so a grouped lead appears under each of
   * its states — shown with the group label, because the match is uncertain.
   */
  metaStateOptions: AuState[] | null
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
  /**
   * Meta ad attribution, captured at delivery because it cannot be recovered
   * afterwards. Null on every non-Facebook lead, and null on Meta's test leads
   * for everything but the form and Page — no ad delivered those. Nothing reads
   * these yet.
   */
  metaFormId: string | null
  metaAdId: string | null
  /** Meta's spelling for the ad set. */
  metaAdgroupId: string | null
  metaPageId: string | null
  /**
   * Resolved from the ad at ingest and stored denormalised, so a dashboard
   * reads campaign names from our own table instead of calling Meta. Null as a
   * group when no ad delivered the lead or the lookup failed — the raw ids
   * above still identify it either way.
   */
  metaCampaignId: string | null
  metaCampaignName: string | null
  metaAdName: string | null
  metaAccountId: string | null
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
