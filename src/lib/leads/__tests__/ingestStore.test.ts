import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IngestedLead } from '../ingest'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { ROW_ATTRIBUTION, storeIngestedLead, toSubmissionPayload } from '../ingestStore'

/**
 * The TypeScript side of ingestion: what is sent to ingest_lead_submission and
 * how its answer is read. The merge, retry and closed-lead rules live in the
 * function itself and are tested against a real database in
 * supabase/tests/ingest_lead_submission.test.ts.
 *
 * Synthetic data only.
 */

const LEAD: IngestedLead = {
  name: 'Test Person',
  email: '  Test.Person@Example.test ',
  phone: '0400000001',
  debtMin: 100_000,
  debtMax: 124_999,
  state: null,
  metaStateRaw: 'NSW, VIC, ACT, TAS',
  metaStateOptions: ['NSW', 'VIC', 'ACT', 'TAS'],
  entityType: 'company',
  message: 'Behind on BAS.',
  preferredCallTime: 'After 6pm',
  source: 'facebook',
  externalId: 'leadgen-1',
  metaFormId: 'form-1',
  metaAdId: 'ad-1',
  metaAdgroupId: 'adset-1',
  metaPageId: 'page-1',
  metaCampaignId: 'campaign-1',
  metaCampaignName: 'Test campaign',
  metaAdName: 'Test ad',
  metaAccountId: 'act_1',
}

const rpc = vi.fn()

beforeEach(() => {
  rpc.mockReset()
  vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('toSubmissionPayload', () => {
  it("uses lead_submissions' column names for every field", () => {
    expect(toSubmissionPayload(LEAD)).toEqual({
      name: 'Test Person',
      email: 'test.person@example.test',
      phone: '0400000001',
      debt_min: 100_000,
      debt_max: 124_999,
      state: null,
      meta_state_raw: 'NSW, VIC, ACT, TAS',
      meta_state_options: ['NSW', 'VIC', 'ACT', 'TAS'],
      entity_type: 'company',
      message: 'Behind on BAS.',
      preferred_call_time: 'After 6pm',
      source: 'facebook',
      external_id: 'leadgen-1',
      meta_form_id: 'form-1',
      meta_ad_id: 'ad-1',
      meta_adgroup_id: 'adset-1',
      meta_page_id: 'page-1',
      meta_campaign_id: 'campaign-1',
      meta_campaign_name: 'Test campaign',
      meta_ad_name: 'Test ad',
      meta_account_id: 'act_1',
    })
  })

  it('sends blanks as null, never as a missing key', () => {
    // A missing key and a null read the same to the function, but an explicit
    // null makes the payload say what the form did not supply.
    const payload = toSubmissionPayload({ ...LEAD, debtMin: null, debtMax: null, message: null })
    expect(payload).toHaveProperty('debt_min', null)
    expect(payload).toHaveProperty('debt_max', null)
    expect(payload).toHaveProperty('message', null)
  })
})

describe('storeIngestedLead', () => {
  it('makes one call carrying the enquiry, the timeline note and the attribution rule', async () => {
    rpc.mockResolvedValue({ data: [{ outcome: 'created', lead_id: 'lead-1' }], error: null })

    await storeIngestedLead(LEAD)

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('ingest_lead_submission', {
      p_submission: toSubmissionPayload(LEAD),
      p_note_body:
        'New enquiry from the facebook form.\n\nBehind on BAS.\n\nPreferred call time: After 6pm',
      p_note_author: 'Facebook',
      p_latest_touch: false,
    })
  })

  it('keeps first-touch attribution on the leads row', () => {
    // Gabby has not confirmed this yet. If it flips, the database tests for
    // p_latest_touch already cover the other behaviour.
    expect(ROW_ATTRIBUTION).toBe('first_touch')
  })

  it.each([
    ['created', 'lead-1'],
    ['appended', 'lead-2'],
    ['duplicate', 'lead-3'],
  ] as const)('passes through %s with its lead id', async (outcome, leadId) => {
    rpc.mockResolvedValue({ data: [{ outcome, lead_id: leadId }], error: null })
    await expect(storeIngestedLead(LEAD)).resolves.toEqual({ outcome, leadId })
  })

  it('reports a database error as an error, so the webhook logs the payload', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } })
    await expect(storeIngestedLead(LEAD)).resolves.toEqual({ outcome: 'error', leadId: null })
  })

  it('treats an empty or unrecognised answer as an error rather than guessing', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })
    await expect(storeIngestedLead(LEAD)).resolves.toEqual({ outcome: 'error', leadId: null })

    rpc.mockResolvedValueOnce({ data: [{ outcome: 'merged', lead_id: 'lead-1' }], error: null })
    await expect(storeIngestedLead(LEAD)).resolves.toEqual({ outcome: 'error', leadId: null })
  })

  it('leaves message and call time out of the note when the enquiry had neither', async () => {
    rpc.mockResolvedValue({ data: [{ outcome: 'appended', lead_id: 'lead-1' }], error: null })
    await storeIngestedLead({ ...LEAD, source: 'website', message: null, preferredCallTime: null })
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_note_body: 'New enquiry from the website form.',
      p_note_author: 'Website',
    })
  })
})
