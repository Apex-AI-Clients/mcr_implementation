import { describe, it, expect } from 'vitest'
import { toLead, toLeadActivity, type LeadRow, type LeadActivityRow } from '../rowMappers'
import { formatDebtRange } from '../format'

/**
 * The snake_case → camelCase boundary. A renamed or mistyped column fails
 * silently here — it produces `undefined`, not an error — so every field is
 * asserted rather than spot-checked.
 */

function row(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Dean Whitlock',
    email: 'dean@whitlockcivil.com.au',
    phone: '0407552118',
    debt_min: 150_000,
    debt_max: null,
    state: 'QLD',
    entity_type: 'company',
    message: 'Civil contracting, mostly PAYG.',
    preferred_call_time: 'After 6pm',
    stage: 'prospect',
    source: 'website',
    company: 'Whitlock Civil',
    next_step: 'Book director meeting',
    stage_since: '2026-08-20T00:00:00.000Z',
    last_action_at: '2026-08-30T00:00:00.000Z',
    converted_client_id: null,
    external_id: 'abc123',
    meta_form_id: '1785284235823017',
    meta_ad_id: '23859402118830412',
    meta_adgroup_id: '23859402118820412',
    meta_page_id: '102030405060708',
    meta_campaign_id: '23859402118800412',
    meta_campaign_name: 'MCR26 | SBR | Prospecting',
    meta_ad_name: 'SBR_Verified_Static_A',
    meta_account_id: '1029384756',
    meta_state_raw: null,
    meta_state_options: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-30T00:00:00.000Z',
    ...overrides,
  }
}

describe('toLead', () => {
  it('maps every column, leaving nothing undefined', () => {
    const lead = toLead(row())
    expect(lead).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Dean Whitlock',
      email: 'dean@whitlockcivil.com.au',
      phone: '0407552118',
      debtMin: 150_000,
      debtMax: null,
      state: 'QLD',
      entityType: 'company',
      message: 'Civil contracting, mostly PAYG.',
      preferredCallTime: 'After 6pm',
      stage: 'prospect',
      source: 'website',
      company: 'Whitlock Civil',
      nextStep: 'Book director meeting',
      stageSince: '2026-08-20T00:00:00.000Z',
      lastActionAt: '2026-08-30T00:00:00.000Z',
      convertedClientId: null,
      metaFormId: '1785284235823017',
      metaAdId: '23859402118830412',
      metaAdgroupId: '23859402118820412',
      metaPageId: '102030405060708',
      metaCampaignId: '23859402118800412',
      metaCampaignName: 'MCR26 | SBR | Prospecting',
      metaAdName: 'SBR_Verified_Static_A',
      metaAccountId: '1029384756',
      metaStateRaw: null,
      metaStateOptions: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    })
    // external_id is a Stage 5 idempotency key, deliberately not on the model.
    expect('externalId' in lead).toBe(false)
  })

  it('carries nulls through rather than coercing them', () => {
    const lead = toLead(
      row({
        debt_min: null,
        debt_max: null,
        entity_type: null,
        message: null,
        preferred_call_time: null,
        company: null,
        next_step: null,
        converted_client_id: null,
        // Every non-Facebook lead has these unset, as do Meta's test leads.
        meta_form_id: null,
        meta_ad_id: null,
        meta_adgroup_id: null,
        meta_page_id: null,
        meta_campaign_id: null,
        meta_campaign_name: null,
        meta_ad_name: null,
        meta_account_id: null,
      }),
    )
    expect(lead.debtMin).toBeNull()
    expect(lead.debtMax).toBeNull()
    expect(lead.entityType).toBeNull()
    expect(lead.message).toBeNull()
    expect(lead.preferredCallTime).toBeNull()
    expect(lead.nextStep).toBeNull()
    expect(lead.convertedClientId).toBeNull()
    expect(lead.metaFormId).toBeNull()
    expect(lead.metaAdId).toBeNull()
    expect(lead.metaAdgroupId).toBeNull()
    expect(lead.metaPageId).toBeNull()
    expect(lead.metaCampaignId).toBeNull()
    expect(lead.metaCampaignName).toBeNull()
    expect(lead.metaAdName).toBeNull()
    expect(lead.metaAccountId).toBeNull()
  })

  it('preserves an open-ended range so the display stays honest', () => {
    const lead = toLead(row({ debt_min: 150_000, debt_max: null }))
    expect(formatDebtRange(lead.debtMin, lead.debtMax)).toBe('$150k+')
  })

  it('does not confuse a zero floor with an unknown one', () => {
    const lead = toLead(row({ debt_min: 0, debt_max: 49_999 }))
    expect(lead.debtMin).toBe(0)
    expect(formatDebtRange(lead.debtMin, lead.debtMax)).toBe('Under $50k')
  })
})

describe('toLeadActivity', () => {
  it('maps every column', () => {
    const activityRow: LeadActivityRow = {
      id: '22222222-2222-4222-8222-222222222222',
      lead_id: '11111111-1111-4111-8111-111111111111',
      type: 'call',
      body: 'Spoke to the director.',
      author: 'Gabby',
      created_at: '2026-08-30T01:00:00.000Z',
    }
    expect(toLeadActivity(activityRow)).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      leadId: '11111111-1111-4111-8111-111111111111',
      type: 'call',
      body: 'Spoke to the director.',
      author: 'Gabby',
      createdAt: '2026-08-30T01:00:00.000Z',
    })
  })
})
