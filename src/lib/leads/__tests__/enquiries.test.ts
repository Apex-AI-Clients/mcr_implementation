import { describe, it, expect } from 'vitest'
import type { LeadSubmission } from '@/types/leads'
import {
  describeEnquirySource,
  describeLatestEnquiry,
  enquiryCountLabel,
  enquiryFields,
  reenquiryMarkerLabel,
  showsReenquiryMarker,
} from '../enquiries'

describe('showsReenquiryMarker', () => {
  const REENQUIRED = '2026-09-10T00:00:00.000Z'

  it('is off when the lead has not enquired again after closing', () => {
    expect(showsReenquiryMarker({ reenquiredAfterCloseAt: null, reenquiryDismissedAt: null })).toBe(
      false,
    )
  })

  it('shows once a closed lead enquires again', () => {
    expect(
      showsReenquiryMarker({ reenquiredAfterCloseAt: REENQUIRED, reenquiryDismissedAt: null }),
    ).toBe(true)
  })

  it('hides after a dismissal', () => {
    expect(
      showsReenquiryMarker({
        reenquiredAfterCloseAt: REENQUIRED,
        reenquiryDismissedAt: '2026-09-11T00:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('comes back when the lead enquires again after that dismissal', () => {
    // The dismissal is kept, but it is now older than the enquiry.
    expect(
      showsReenquiryMarker({
        reenquiredAfterCloseAt: '2026-09-12T00:00:00.000Z',
        reenquiryDismissedAt: '2026-09-11T00:00:00.000Z',
      }),
    ).toBe(true)
  })
})

describe('reenquiryMarkerLabel', () => {
  it('says conversion when a client file exists, whatever the stage', () => {
    expect(reenquiryMarkerLabel({ convertedClientId: 'client-1', stage: 'client' })).toBe(
      'New enquiry after conversion',
    )
  })

  it('says conversion for the converted stage', () => {
    expect(reenquiryMarkerLabel({ convertedClientId: null, stage: 'converted' })).toBe(
      'New enquiry after conversion',
    )
  })

  it.each(['non_proceeding', 'do_not_contact'] as const)('says closure for %s', (stage) => {
    expect(reenquiryMarkerLabel({ convertedClientId: null, stage })).toBe(
      'New enquiry after closure',
    )
  })
})

describe('enquiry count and tooltip', () => {
  it('counts enquiries', () => {
    expect(enquiryCountLabel(3)).toBe('3 enquiries')
  })

  it('names the latest source and date', () => {
    expect(
      describeLatestEnquiry({
        lastEnquiryAt: '2026-09-10T02:00:00.000Z',
        latestEnquirySource: 'website',
      }),
    ).toBe('Latest from Website, 10 Sept 2026')
  })

  it('gives the date alone when the source was not loaded', () => {
    expect(
      describeLatestEnquiry({ lastEnquiryAt: '2026-09-10T02:00:00.000Z', latestEnquirySource: null }),
    ).toBe('Latest 10 Sept 2026')
  })
})

describe('enquiryFields', () => {
  const enquiry = (overrides: Partial<LeadSubmission> = {}): LeadSubmission => ({
    id: 'sub',
    leadId: 'ld_1',
    receivedAt: '2026-09-10T00:00:00.000Z',
    afterClose: false,
    name: 'Test Person',
    email: 'test@example.test',
    phone: '0400000001',
    debtMin: 100_000,
    debtMax: 124_999,
    state: 'QLD',
    metaStateRaw: null,
    metaStateOptions: null,
    entityType: 'company',
    message: null,
    preferredCallTime: null,
    source: 'website',
    metaFormId: null,
    metaAdId: null,
    metaCampaignName: null,
    metaAdName: null,
    ...overrides,
  })
  const byLabel = (fields: ReturnType<typeof enquiryFields>) =>
    Object.fromEntries(fields.map((f) => [f.label, f]))

  it('highlights nothing on the oldest enquiry', () => {
    expect(enquiryFields(enquiry(), undefined).some((f) => f.changed)).toBe(false)
  })

  it('highlights what differs from the enquiry before', () => {
    const fields = byLabel(
      enquiryFields(enquiry({ debtMin: 250_000, debtMax: 499_999, state: 'NSW' }), enquiry()),
    )
    expect(fields.Debt.changed).toBe(true)
    expect(fields.State).toMatchObject({ value: 'NSW', changed: true })
    expect(fields.Name.changed).toBe(false)
  })

  it('shows a blank as not given and never highlights it', () => {
    // Blank overwrote nothing on the lead, so there is no change to point at.
    const fields = byLabel(
      enquiryFields(enquiry({ debtMin: null, debtMax: null, entityType: null }), enquiry()),
    )
    expect(fields.Debt).toMatchObject({ value: null, changed: false })
    expect(fields['Business type']).toMatchObject({ value: null, changed: false })
  })

  it('does not call a reformatted phone number or a re-cased email a change', () => {
    const fields = byLabel(
      enquiryFields(
        enquiry({ phone: '0400 000 001', email: 'Test@Example.test' }),
        enquiry(),
      ),
    )
    expect(fields.Phone.changed).toBe(false)
    expect(fields.Email.changed).toBe(false)
  })

  it('describes a grouped state answer the way the record does', () => {
    const fields = byLabel(
      enquiryFields(
        enquiry({ state: null, metaStateRaw: 'NT, SA', metaStateOptions: ['NT', 'SA'] }),
        undefined,
      ),
    )
    expect(fields.State.value).toBe('One of NT, SA')
  })

  it('highlights a field given now that was not given before', () => {
    const fields = byLabel(
      enquiryFields(enquiry({ message: 'Now behind on super.' }), enquiry({ message: null })),
    )
    expect(fields.Message).toMatchObject({ value: 'Now behind on super.', changed: true })
  })
})

describe('describeEnquirySource', () => {
  const base = {
    id: 'sub',
    leadId: 'ld_1',
    receivedAt: '2026-09-10T00:00:00.000Z',
    afterClose: false,
    name: 'Test Person',
    email: 'test@example.test',
    phone: '0400000001',
    debtMin: null,
    debtMax: null,
    state: null,
    metaStateRaw: null,
    metaStateOptions: null,
    entityType: null,
    message: null,
    preferredCallTime: null,
  } as const

  it('gives the source alone for a website enquiry', () => {
    expect(
      describeEnquirySource({
        ...base,
        source: 'website',
        metaFormId: null,
        metaAdId: null,
        metaCampaignName: null,
        metaAdName: null,
      }),
    ).toEqual(['Website'])
  })

  it('names the campaign, ad and form for a Facebook enquiry', () => {
    expect(
      describeEnquirySource({
        ...base,
        source: 'facebook',
        metaFormId: 'form-1',
        metaAdId: 'ad-1',
        metaCampaignName: 'Test campaign',
        metaAdName: 'Test ad',
      }),
    ).toEqual(['Facebook', 'Campaign: Test campaign', 'Ad: Test ad', 'Form form-1'])
  })

  it('falls back to the ad id when Meta did not resolve its name', () => {
    expect(
      describeEnquirySource({
        ...base,
        source: 'facebook',
        metaFormId: null,
        metaAdId: 'ad-1',
        metaCampaignName: null,
        metaAdName: null,
      }),
    ).toEqual(['Facebook', 'Ad ad-1'])
  })
})
