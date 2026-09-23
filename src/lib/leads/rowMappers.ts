import type { Database } from '@/types/database'
import type {
  AuState,
  EntityType,
  Lead,
  LeadActivity,
  LeadActivityType,
  LeadSource,
  LeadStage,
} from '@/types/leads'

/**
 * snake_case database rows to the app's camelCase shape.
 *
 * Kept apart from queries.ts so it is pure and testable — this mapping is
 * exactly where a renamed column fails silently, producing `undefined` rather
 * than an error.
 *
 * The narrowing casts are safe because every one of these columns is
 * CHECK-constrained in migration 0014 to the same set as its TypeScript union.
 * If the two ever drift, this is the one place to fix.
 */

export type LeadRow = Database['public']['Tables']['leads']['Row']
export type LeadActivityRow = Database['public']['Tables']['lead_activities']['Row']

export function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    debtMin: row.debt_min,
    debtMax: row.debt_max,
    state: row.state as AuState | null,
    metaStateRaw: row.meta_state_raw,
    metaStateOptions: row.meta_state_options as AuState[] | null,
    entityType: row.entity_type as EntityType | null,
    message: row.message,
    preferredCallTime: row.preferred_call_time,
    stage: row.stage as LeadStage,
    source: row.source as LeadSource,
    company: row.company,
    nextStep: row.next_step,
    stageSince: row.stage_since,
    lastActionAt: row.last_action_at,
    convertedClientId: row.converted_client_id,
    metaFormId: row.meta_form_id,
    metaAdId: row.meta_ad_id,
    metaAdgroupId: row.meta_adgroup_id,
    metaPageId: row.meta_page_id,
    metaCampaignId: row.meta_campaign_id,
    metaCampaignName: row.meta_campaign_name,
    metaAdName: row.meta_ad_name,
    metaAccountId: row.meta_account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toLeadActivity(row: LeadActivityRow): LeadActivity {
  return {
    id: row.id,
    leadId: row.lead_id,
    type: row.type as LeadActivityType,
    body: row.body,
    author: row.author,
    createdAt: row.created_at,
  }
}
