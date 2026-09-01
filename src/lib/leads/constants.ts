import type { LeadStage, LeadSource, LeadActivityType, AuState } from '@/types/leads'
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
