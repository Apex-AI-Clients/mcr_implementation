import type {
  BuiltInStage,
  CustomStage,
  CustomStageKey,
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

/**
 * The built-in stages. Staff can add more (lead_stages, migration 0042); those
 * are read from the database and described by stageMeta() below.
 */
export const STAGE_META: Record<BuiltInStage, StageMeta> = {
  lead: { label: 'Lead', group: 'pipeline', badge: 'muted' },
  prospect: { label: 'Prospect', group: 'pipeline', badge: 'accent' },
  client: { label: 'Client', group: 'pipeline', badge: 'success' },
  // Still in play: somebody calls them again when the 30 days are up.
  contact_in_30_days: { label: 'Contact in 30 days', group: 'pipeline', badge: 'warning' },
  unresponsive: { label: 'Unresponsive', group: 'closed', badge: 'muted' },
  converted: { label: 'Converted', group: 'closed', badge: 'success' },
  non_proceeding: { label: 'Non-proceeding – other', group: 'closed', badge: 'muted' },
  do_not_contact: { label: 'Do not contact again', group: 'closed', badge: 'destructive' },
}

/**
 * What two stages were called before migration 0042. Activity entries written
 * then still say "Stage before: Non-proceeding.", and clientDeleted.ts reads
 * the stage back out of them by its label.
 */
export const FORMER_STAGE_LABELS: Partial<Record<BuiltInStage, string>> = {
  non_proceeding: 'Non-proceeding',
  do_not_contact: 'Do not contact',
}

/** A stage staff added, rather than one that ships with the app. */
export function isCustomStage(stage: string): stage is CustomStageKey {
  return stage.startsWith('custom_')
}

/** Any stage, built-in or one staff added: name, group and badge. */
export function stageMeta(stage: LeadStage, custom: readonly CustomStage[] = []): StageMeta {
  if (!isCustomStage(stage)) return STAGE_META[stage]
  // Closed: a stage staff invent is a place to park leads, so it never flags
  // for follow-up. Muted, so it reads as neither good nor bad news.
  return { label: custom.find((c) => c.key === stage)?.label ?? 'Custom stage', group: 'closed', badge: 'muted' }
}

export function stageLabel(stage: LeadStage, custom: readonly CustomStage[] = []): string {
  return stageMeta(stage, custom).label
}

/** The custom stages that have a tab and are offered, in tab order. */
export function visibleCustomStages(custom: readonly CustomStage[]): CustomStage[] {
  return custom
    .filter((stage) => !stage.hiddenAt)
    .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, 'en-AU'))
}

export const CLOSED_STAGES: BuiltInStage[] = (Object.keys(STAGE_META) as BuiltInStage[]).filter(
  (stage) => STAGE_META[stage].group === 'closed',
)

/** Pipeline mirrors OPEN_STAGES exactly — the follow-up rule and the select
 *  must never disagree about which stages are still in play. */
export const STAGE_GROUPS: { label: string; stages: LeadStage[] }[] = [
  { label: 'Pipeline', stages: OPEN_STAGES },
  { label: 'Closed', stages: CLOSED_STAGES },
]

/** STAGE_GROUPS, with the stages staff added as a group of their own. */
export function stageGroups(custom: readonly CustomStage[]): { label: string; stages: LeadStage[] }[] {
  const added = visibleCustomStages(custom).map((stage) => stage.key)
  return added.length > 0 ? [...STAGE_GROUPS, { label: 'Added by staff', stages: added }] : STAGE_GROUPS
}

export const ALL_STAGES: BuiltInStage[] = [...OPEN_STAGES, ...CLOSED_STAGES]

/**
 * The stages a lead passes through when everything goes right, in order.
 *
 * This is the track the progress stepper draws. It is NOT every stage: the
 * others are exits or pauses, not steps, and putting them on a line implying
 * progress would read as though "Do not contact again" were something to work
 * towards.
 */
export const STAGE_PATH: LeadStage[] = ['lead', 'prospect', 'client', 'converted']

/** Built-in stages that end the track rather than advance it. Custom stages do too. */
export const OFF_RAMP_STAGES: LeadStage[] = ['unresponsive', 'non_proceeding', 'do_not_contact']

/** How long "Contact in 30 days" parks a lead before it is due a call. */
export const CONTACT_AGAIN_DAYS = 30

/**
 * When a lead in "Contact in 30 days" is due a call: 30 days from when it was
 * put there (stage_since). Null in any other stage. Nothing moves the lead
 * when the day comes; the table and the record say it is due.
 */
export function contactAgainBy(lead: { stage: LeadStage; stageSince: string }): Date | null {
  if (lead.stage !== 'contact_in_30_days') return null
  return new Date(new Date(lead.stageSince).getTime() + CONTACT_AGAIN_DAYS * 86_400_000)
}

/** contactAgainBy(), and whether that day has come. Null in any other stage. */
export function contactAgain(
  lead: { stage: LeadStage; stageSince: string },
  now: Date = new Date(),
): { by: Date; due: boolean } | null {
  const by = contactAgainBy(lead)
  return by ? { by, due: by.getTime() <= now.getTime() } : null
}

// ============================================================
// Screens
// ============================================================

/**
 * The tabs in the Leads page header, one table and one count each (Gabby,
 * 21–22 Oct; the new stages 3 Nov). The page opens on Leads, which holds only
 * the working stage; a lead moves to its tab when its stage changes. Every
 * stage is in exactly one tab (a test holds this). `tab` is the URL value, so
 * a tab can be bookmarked; Leads has none.
 *
 * A stage staff added is its own tab, after these, keyed and bookmarked by its
 * stage key (viewDef).
 */
export type BuiltInView =
  | 'leads'
  | 'prospects'
  | 'clients'
  | 'unresponsive'
  | 'do_not_contact'
  | 'contact_in_30_days'
  | 'non_proceeding'
  | 'converted'

export type LeadView = BuiltInView | CustomStageKey

interface ViewDef {
  label: string
  tab: string
  stages: LeadStage[]
}

export const LEAD_VIEWS: Record<BuiltInView, ViewDef> = {
  leads: { label: 'Leads', tab: 'leads', stages: ['lead'] },
  prospects: { label: 'Prospects', tab: 'prospects', stages: ['prospect'] },
  clients: { label: 'Clients', tab: 'clients', stages: ['client'] },
  unresponsive: { label: 'Unresponsive', tab: 'unresponsive', stages: ['unresponsive'] },
  do_not_contact: { label: 'Do not contact again', tab: 'do-not-contact', stages: ['do_not_contact'] },
  contact_in_30_days: { label: 'Contact in 30 days', tab: 'contact-in-30-days', stages: ['contact_in_30_days'] },
  non_proceeding: { label: 'Non-proceeding – other', tab: 'non-proceeding', stages: ['non_proceeding'] },
  converted: { label: 'Converted', tab: 'converted', stages: ['converted'] },
}

export const BUILT_IN_VIEWS = Object.keys(LEAD_VIEWS) as BuiltInView[]

/** Any tab, built-in or a custom stage's. A custom stage's tab is its key. */
export function viewDef(view: LeadView, custom: readonly CustomStage[] = []): ViewDef {
  if (!isCustomStage(view)) return LEAD_VIEWS[view]
  return { label: stageLabel(view, custom), tab: view, stages: [view] }
}

/** The stages a tab lists. Needs no custom list: a custom tab lists its own stage. */
export function viewStages(view: LeadView): LeadStage[] {
  return isCustomStage(view) ? [view] : LEAD_VIEWS[view].stages
}

/** Every tab, in order: the built-in ones, then each visible custom stage. */
export function allViews(custom: readonly CustomStage[] = []): LeadView[] {
  return [...BUILT_IN_VIEWS, ...visibleCustomStages(custom).map((stage) => stage.key)]
}

/** The tab a URL names, or null for none or an unknown one. */
export function viewForTab(tab: string | null, custom: readonly CustomStage[] = []): LeadView | null {
  if (tab === null) return null
  return allViews(custom).find((view) => viewDef(view, custom).tab === tab) ?? null
}

/** The screen a lead in this stage is listed on. */
export function viewForStage(stage: LeadStage): LeadView {
  if (isCustomStage(stage)) return stage
  return BUILT_IN_VIEWS.find((view) => LEAD_VIEWS[view].stages.includes(stage)) ?? 'leads'
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
