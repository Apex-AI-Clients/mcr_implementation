import type {
  LeadStage,
  LeadSource,
  LeadActivityType,
  AuState,
  EntityType,
} from '@/types/leads'
import { OPEN_STAGES } from './followUp'

/** The follow-up threshold. Defined in followUp.ts; re-exported here so callers
 *  have one obvious place to look for lead constants. */
export { FOLLOW_UP_DAYS } from './followUp'

// ============================================================
// Stages
// ============================================================

export type StageGroup = 'pipeline' | 'closed'

interface StageMeta {
  label: string
  group: StageGroup
  badge: 'success' | 'warning' | 'destructive' | 'muted' | 'accent'
}

export const STAGE_META: Record<LeadStage, StageMeta> = {
  lead: { label: 'Lead', group: 'pipeline', badge: 'muted' },
  prospect: { label: 'Prospect', group: 'pipeline', badge: 'accent' },
  client: { label: 'Client', group: 'pipeline', badge: 'success' },
  converted: { label: 'Converted', group: 'closed', badge: 'success' },
  non_proceeding: { label: 'Non-proceeding', group: 'closed', badge: 'muted' },
  do_not_contact: { label: 'Do not contact', group: 'closed', badge: 'destructive' },
}

export const CLOSED_STAGES: LeadStage[] = (Object.keys(STAGE_META) as LeadStage[]).filter(
  (stage) => STAGE_META[stage].group === 'closed',
)

/** Pipeline mirrors OPEN_STAGES exactly — the follow-up rule and the select
 *  must never disagree about which stages are still in play. */
export const STAGE_GROUPS: { label: string; stages: LeadStage[] }[] = [
  { label: 'Pipeline', stages: OPEN_STAGES },
  { label: 'Closed', stages: CLOSED_STAGES },
]

export const ALL_STAGES: LeadStage[] = [...OPEN_STAGES, ...CLOSED_STAGES]

/**
 * The stages a lead passes through when everything goes right, in order.
 *
 * This is the track the progress stepper draws. It is NOT every stage: the two
 * below are exits, not steps, and putting them on a line implying progress
 * would read as though "Do not contact" were something to work towards.
 */
export const STAGE_PATH: LeadStage[] = ['lead', 'prospect', 'client', 'converted']

/** Terminal stages that end the track rather than advance it. */
export const OFF_RAMP_STAGES: LeadStage[] = ['non_proceeding', 'do_not_contact']

// ============================================================
// Screens
// ============================================================

/**
 * The tabs in the Leads page header, one table and one count each (Gabby,
 * 21–22 Oct). The page opens on Leads, which holds only the working stage;
 * a lead moves to its tab when its stage changes. Every stage is in exactly
 * one tab (a test holds this). `tab` is the URL value, so a tab can be
 * bookmarked; Leads has none.
 */
export type LeadView = 'leads' | 'prospects' | 'clients' | 'non_proceeding' | 'do_not_contact'

export const LEAD_VIEWS: Record<LeadView, { label: string; tab: string; stages: LeadStage[] }> = {
  leads: { label: 'Leads', tab: 'leads', stages: ['lead'] },
  prospects: { label: 'Prospects', tab: 'prospects', stages: ['prospect'] },
  clients: { label: 'Clients', tab: 'clients', stages: ['client', 'converted'] },
  non_proceeding: { label: 'Non-proceeding', tab: 'non-proceeding', stages: ['non_proceeding'] },
  do_not_contact: { label: 'Do not contact', tab: 'do-not-contact', stages: ['do_not_contact'] },
}

/** The tab a URL names, or null for none or an unknown one. */
export function viewForTab(tab: string | null): LeadView | null {
  return (Object.keys(LEAD_VIEWS) as LeadView[]).find((view) => LEAD_VIEWS[view].tab === tab) ?? null
}

export const ALL_VIEWS = Object.keys(LEAD_VIEWS) as LeadView[]

/** The screen a lead in this stage is listed on. */
export function viewForStage(stage: LeadStage): LeadView {
  return ALL_VIEWS.find((view) => LEAD_VIEWS[view].stages.includes(stage)) ?? 'leads'
}

// ============================================================
// Sources
// ============================================================

export const SOURCE_META: Record<LeadSource, { label: string; short: string }> = {
  facebook: { label: 'Facebook', short: 'FB' },
  website: { label: 'Website', short: 'Web' },
  google_form: { label: 'Google Form', short: 'Form' },
  manual: { label: 'Added manually', short: 'Manual' },
}

export const ALL_SOURCES = Object.keys(SOURCE_META) as LeadSource[]

/**
 * A lead's source as the Source filter lists it: what staff typed when they
 * typed one, else the delivered source's label. The filter's options are
 * built from the data (queries.ts), so a typed "Referral" is offered, and a
 * typed "Facebook" sits with the Facebook leads.
 */
export function sourceName(lead: { source: LeadSource; sourceLabel?: string | null }): string {
  return lead.sourceLabel?.trim() || SOURCE_META[lead.source].label
}

/** Delivered sources whose label is this name (case-insensitive). */
export function sourcesNamed(name: string): LeadSource[] {
  const wanted = name.trim().toLowerCase()
  return ALL_SOURCES.filter((source) => SOURCE_META[source].label.toLowerCase() === wanted)
}

// ============================================================
// Lead-gen partners
// ============================================================

export interface PartnerRule {
  /** Tested against `meta_campaign_name`. Never anchored to a whole name. */
  pattern: RegExp
  /** Short name, as it should read beside the source. */
  name: string
}

/**
 * Campaign-name patterns to the partner who runs the campaign.
 *
 * MAINTAINED BY HAND. Every entry is added when a partner is confirmed — there
 * is no feed to derive this from, and Meta does not know who we contract with.
 * Add a row here when a new partner starts running campaigns; nothing else in
 * the app needs touching.
 *
 * Patterns rather than exact names, because a campaign name carries the things
 * that change — a quarter, a month, a creative round ("Q4", "Apr24") — around a
 * marker that does not. Matching the whole name would need a new entry every
 * quarter and would quietly stop attributing the moment one was missed.
 *
 * First match wins, so order these most specific first if two could ever
 * overlap. Keep the flags to `i`: a `g` regex carries lastIndex between calls
 * and would match every other lead.
 */
export const PARTNERS: readonly PartnerRule[] = [
  { pattern: /\bEPICDM\b/i, name: 'EPIC DM' },
  // Running, but nobody has confirmed who runs it. 'TBC' is shown rather than
  // nothing, so the gap is visible on the record instead of looking like an
  // organic lead — replace the name here once the client says.
  { pattern: /^C-COLD-MCR\b/i, name: 'TBC' },
]

// ============================================================
// Debt
// ============================================================

export interface DebtPreset {
  label: string
  min: number | null
  max: number | null
}

/**
 * Editing is a dropdown; the range underneath is storage, not UI. Covers both
 * scales seen in the wild — the website's consumer-debt brackets ($30k-$150k+)
 * and the larger business brackets the client described.
 *
 * `$150k+` and the narrower brackets above it deliberately coexist: a website
 * lead that only said "$150,000 or +" must never be presented as though it had
 * said $250k-$500k.
 */
export const DEBT_PRESETS: DebtPreset[] = [
  { label: 'Not given', min: null, max: null },
  { label: 'Under $50k', min: 0, max: 49_999 },
  { label: '$50k – $75k', min: 50_000, max: 74_999 },
  { label: '$75k – $100k', min: 75_000, max: 99_999 },
  { label: '$100k – $125k', min: 100_000, max: 124_999 },
  { label: '$125k – $150k', min: 125_000, max: 149_999 },
  { label: '$150k+', min: 150_000, max: null },
  { label: '$150k – $250k', min: 150_000, max: 250_000 },
  { label: '$250k – $500k', min: 250_000, max: 500_000 },
  { label: '$500k+', min: 500_000, max: null },
]

/**
 * The filter offers floors, not brackets — Gabby wants "show me the big ones",
 * not "show me exactly this bracket".
 */
export const DEBT_FLOORS: { value: string; label: string; floor: number }[] = [
  { value: '50000', label: '$50k+', floor: 50_000 },
  { value: '100000', label: '$100k+', floor: 100_000 },
  { value: '150000', label: '$150k+', floor: 150_000 },
  { value: '250000', label: '$250k+', floor: 250_000 },
  { value: '500000', label: '$500k+', floor: 500_000 },
]

// ============================================================
// Entity type
// ============================================================

/** Trust is amber: it cannot take the SBR path, so it should catch the eye. */
export const ENTITY_TYPE_META: Record<
  EntityType,
  { label: string; badge: 'muted' | 'warning' }
> = {
  company: { label: 'Company', badge: 'muted' },
  trust: { label: 'Trust', badge: 'warning' },
}

export const ALL_ENTITY_TYPES = Object.keys(ENTITY_TYPE_META) as EntityType[]

// ============================================================
// Sort
// ============================================================

export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'recent', label: 'Newest first' },
  { value: 'debt', label: 'Largest debt first' },
]

// ============================================================
// States
// ============================================================

export const AU_STATES: AuState[] = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']

// ============================================================
// Activity types
// ============================================================

interface ActivityTypeMeta {
  label: string
  /** Composer save button label — follows the selected type. */
  saveLabel: string
  /** Confirmation shown after saving. Plain past tense. */
  toast: string
}

export const ACTIVITY_TYPE_META: Record<LeadActivityType, ActivityTypeMeta> = {
  note: { label: 'Note', saveLabel: 'Save note', toast: 'Note saved.' },
  call: { label: 'Call', saveLabel: 'Log call', toast: 'Call logged.' },
  email: { label: 'Email', saveLabel: 'Log email', toast: 'Email logged.' },
  next_step: { label: 'Next step', saveLabel: 'Set next step', toast: 'Next step set.' },
  stage_change: { label: 'Stage change', saveLabel: 'Save', toast: 'Stage updated.' },
}

/** The four types a person can compose. `stage_change` is written by the system. */
export const COMPOSER_TYPES: LeadActivityType[] = ['note', 'call', 'email', 'next_step']

// ============================================================
// Filters
// ============================================================

export const DATE_RANGES: { value: string; label: string; days: number | null }[] = [
  { value: 'any', label: 'Any date', days: null },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
]

/**
 * The timeline entry a conversion leaves. One wording, because it is written
 * from two places: the create-client route, which links the lead in the same
 * request, and the store, which links a lead to a file that already existed.
 */
export const CONVERSION_ACTIVITY_BODY = 'Converted to a client file in the restructuring workspace.'
