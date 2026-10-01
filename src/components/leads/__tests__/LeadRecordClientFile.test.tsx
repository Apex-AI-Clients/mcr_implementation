import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { LeadRecordClient } from '../LeadRecordClient'
import { LeadsStoreProvider } from '../LeadsStore'
import { ToastProvider } from '@/components/ui/Toast'
import type { ConvertedClientDetails, Lead } from '@/types/leads'

/**
 * The "Client file" card on a converted lead's record: what the client file
 * holds, including what came off the ASIC extract. Synthetic data only.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/leads/ld_1',
}))

afterEach(() => cleanup())

const LEAD = {
  id: 'ld_1',
  name: 'Dean Whitlock',
  email: 'dean@example.test',
  phone: '0400000001',
  debtMin: null,
  debtMax: null,
  state: null,
  metaStateRaw: null,
  metaStateOptions: null,
  entityType: 'company',
  message: null,
  preferredCallTime: null,
  stage: 'client',
  source: 'manual',
  company: null,
  nextStep: null,
  stageSince: '2026-09-01T00:00:00.000Z',
  lastActionAt: '2026-09-01T00:00:00.000Z',
  lastEnquiryAt: '2026-09-01T00:00:00.000Z',
  enquiryCount: 1,
  latestEnquirySource: null,
  reenquiredAfterCloseAt: null,
  reenquiryDismissedAt: null,
  reenquiryDismissedBy: null,
  convertedClientId: 'cl_1',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
} as unknown as Lead

const CLIENT: ConvertedClientDetails = {
  id: 'cl_1',
  name: 'Dean Whitlock',
  email: 'dean@example.test',
  phone: '0400000001',
  entityType: 'company',
  companyName: 'Sample Trading Pty Ltd',
  acnNumber: '123456780',
  abnNumber: '11123456780',
  trustName: null,
  trustAbnNumber: null,
  companyPhone: null,
  companyEmail: null,
  registeredOfficeAddress: 'Unit 1, 10 Sample Road, North Melbourne VIC 3051',
  principalPlaceOfBusiness: 'Level 2, 20 Example Street, Sampleton NSW 2000',
  directors: [
    { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
    { name: 'Raj Example', dateOfBirth: null },
  ],
  asicExtractDate: '2026-09-23T14:07:38+10:00',
  companyDetailsSource: 'asic_pdf',
}

function renderRecord(client: ConvertedClientDetails) {
  render(
    <ToastProvider>
      <LeadsStoreProvider author="Tester" persistence={{}}>
        <LeadRecordClient
          leadId={LEAD.id}
          initialLead={LEAD}
          initialActivities={[]}
          enquiries={[]}
          convertedClient={client}
        />
      </LeadsStoreProvider>
    </ToastProvider>,
  )
  // The card is the block headed "Client file".
  return screen.getByText('Client file').closest('div.rounded-xl') as HTMLElement
}

/** The value under a label in the card's definition list. */
function valueOf(card: HTMLElement, label: string) {
  const term = within(card).getByText(label, { selector: 'dt' })
  return term.nextElementSibling?.textContent ?? null
}

describe('Client file card on the lead record', () => {
  it('shows both addresses and each director with their date of birth', () => {
    const card = renderRecord(CLIENT)

    expect(valueOf(card, 'Registered office')).toBe('Unit 1, 10 Sample Road, North Melbourne VIC 3051')
    expect(valueOf(card, 'Principal place of business')).toBe(
      'Level 2, 20 Example Street, Sampleton NSW 2000',
    )
    const directors = within(card).getByText('Directors', { selector: 'dt' }).nextElementSibling!
    expect(Array.from(directors.querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'Jane Sample · born 14/03/1970',
      'Raj Example',
    ])
  })

  it("keeps the lead's own name as the name — a director never replaces it", () => {
    const card = renderRecord(CLIENT)
    expect(valueOf(card, 'Name')).toBe('Dean Whitlock')
  })

  it('does not say where the details came from — that line lives on the intake form only', () => {
    for (const source of ['asic_pdf', 'asic_pdf_edited']) {
      const card = renderRecord({ ...CLIENT, companyDetailsSource: source })
      expect(within(card).queryByText(/From ASIC extract/)).toBeNull()
      cleanup()
    }
  })

  it('uses the singular for one director, and shows both addresses even when identical', () => {
    const same = 'Unit 1, 10 Sample Road, North Melbourne VIC 3051'
    const card = renderRecord({
      ...CLIENT,
      principalPlaceOfBusiness: same,
      directors: [CLIENT.directors[0]],
    })
    expect(within(card).getByText('Director', { selector: 'dt' })).toBeTruthy()
    expect(valueOf(card, 'Registered office')).toBe(same)
    expect(valueOf(card, 'Principal place of business')).toBe(same)
  })

  it('lists nothing extra for a client file with none of these recorded', () => {
    const card = renderRecord({
      ...CLIENT,
      registeredOfficeAddress: null,
      principalPlaceOfBusiness: null,
      directors: [],
      asicExtractDate: null,
      companyDetailsSource: null,
    })
    expect(within(card).queryByText('Registered office')).toBeNull()
    expect(within(card).queryByText(/^Directors?$/)).toBeNull()
    expect(within(card).queryByText(/From ASIC extract/)).toBeNull()
  })
})

describe('Client file card — company and trust', () => {
  it('a Company: its own ABN under Company, and no Trust group', () => {
    const card = renderRecord(CLIENT)
    const company = within(card).getByRole('region', { name: 'Company' })
    expect(valueOf(company, 'Company name')).toBe('Sample Trading Pty Ltd')
    expect(valueOf(company, 'ACN')).toBe('123456780')
    expect(valueOf(company, 'Company ABN')).toBe('11123456780')
    expect(within(card).queryByRole('region', { name: 'Trust' })).toBeNull()
  })

  it('a trustee with no ABN of its own: says so, and shows the trust with its ABN', () => {
    const card = renderRecord({
      ...CLIENT,
      entityType: 'trust',
      abnNumber: '',
      trustName: 'Sample Family Trust',
      trustAbnNumber: '51824753556',
    })
    const company = within(card).getByRole('region', { name: 'Company' })
    const trust = within(card).getByRole('region', { name: 'Trust' })
    expect(valueOf(company, 'Company ABN')).toBe('No ABN of its own')
    expect(valueOf(trust, 'Trust name')).toBe('Sample Family Trust')
    expect(valueOf(trust, 'Trust ABN')).toBe('51824753556')
  })

  it('a trustee with its own ABN: both ABNs, each in its own group', () => {
    const card = renderRecord({
      ...CLIENT,
      entityType: 'trust',
      trustName: 'Sample Family Trust',
      trustAbnNumber: '51824753556',
    })
    expect(valueOf(within(card).getByRole('region', { name: 'Company' }), 'Company ABN')).toBe(
      '11123456780',
    )
    expect(valueOf(within(card).getByRole('region', { name: 'Trust' }), 'Trust ABN')).toBe(
      '51824753556',
    )
  })
})
