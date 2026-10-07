import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/leads/queries', () => ({ getLeadIdForClient: vi.fn(async () => null) }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound')
  },
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))
// The rest of the page is not what is under test here.
vi.mock('@/components/admin/DocumentStatusGrid', () => ({ DocumentStatusGrid: () => null }))
vi.mock('@/components/admin/CompletenessBar', () => ({ CompletenessBar: () => null }))
vi.mock('@/components/admin/ClientActions', () => ({ ClientActions: () => null }))
vi.mock('@/components/admin/ArchivedClientActions', () => ({ ArchivedClientActions: () => null }))
vi.mock('@/components/admin/PredictOutcomeButton', () => ({ PredictOutcomeButton: () => null }))
vi.mock('@/components/leads/LeadOriginLink', () => ({ LeadOriginLink: () => null }))
vi.mock('@/components/admin/ComparisonJobStatus', () => ({ ComparisonJobStatus: () => null }))
vi.mock('@/lib/financials/jobLiveness', () => ({ findLiveComparisonJob: vi.fn(async () => null) }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import ClientDetailPage from '../page'
import ArchivedClientPage from '@/app/(app)/sbr/archive/[id]/page'

/**
 * The SBR client page: the client's phone in the header, and the ASIC fields in
 * the Company and Trust Details card. Synthetic data only.
 */

afterEach(() => cleanup())

const CLIENT = {
  id: 'cl_1',
  name: 'Dean Whitlock',
  email: 'dean@example.test',
  phone: '0400000001',
  status: 'in_progress',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-02T00:00:00.000Z',
}

const COMPANY = {
  id: 'cd_1',
  client_id: 'cl_1',
  entity_type: 'company',
  company_name: 'Sample Trading Pty Ltd',
  acn_number: '123456780',
  abn_number: '11123456780',
  trust_name: null,
  trust_abn_number: null,
  phone_number: '0390000000',
  email_address: 'accounts@example.test',
  registered_office_address: 'Unit 1, 10 Sample Road, North Melbourne VIC 3051',
  principal_place_of_business: 'Level 2, 20 Example Street, Sampleton NSW 2000',
  directors: [
    { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
    { name: 'Raj Example', dateOfBirth: '1981' },
  ],
  asic_extract_date: '2026-09-23T04:07:38+00:00',
  company_details_source: 'asic_pdf_edited',
}

function mockDb(client: Record<string, unknown>, company: Record<string, unknown> | null) {
  const rows: Record<string, unknown> = {
    clients: client,
    company_details: company,
    accountant_details: null,
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) => {
      const result = { data: table === 'documents' ? [] : rows[table], error: null }
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve(result),
        single: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
      }
      return chain
    },
  } as never)
}

async function renderPage() {
  render(await ClientDetailPage({ params: Promise.resolve({ id: 'cl_1' }) }))
  return screen.getByText('Company and Trust Details').closest('div.mb-6') as HTMLElement
}

/** The value under a label in the card's grid. */
function valueOf(card: HTMLElement, label: string) {
  return within(card).getByText(label).nextElementSibling?.textContent ?? null
}

describe('Client detail page', () => {
  it("shows the client's phone in the header, under the email", async () => {
    mockDb(CLIENT, COMPANY)
    await renderPage()

    const heading = screen.getByRole('heading', { level: 1, name: 'Dean Whitlock' })
    const header = heading.parentElement as HTMLElement
    expect(within(header).getByText('dean@example.test')).toBeTruthy()
    expect(within(header).getByText('0400 000 001')).toBeTruthy()
  })

  it('shows no phone line for a client without one', async () => {
    mockDb({ ...CLIENT, phone: null }, COMPANY)
    await renderPage()
    const header = screen.getByRole('heading', { level: 1 }).parentElement as HTMLElement
    expect(header.querySelectorAll('p')).toHaveLength(1)
  })

  it('shows the addresses and each director, without a source line', async () => {
    mockDb(CLIENT, COMPANY)
    const card = await renderPage()

    expect(valueOf(card, 'Registered Office')).toBe(
      'Unit 1, 10 Sample Road, North Melbourne VIC 3051',
    )
    expect(valueOf(card, 'Principal Place of Business')).toBe(
      'Level 2, 20 Example Street, Sampleton NSW 2000',
    )
    const directors = within(card).getByText('Directors').nextElementSibling!
    expect(Array.from(directors.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'Jane Sample · born 14/03/1970',
      'Raj Example · born 1981',
    ])
    // Where they came from is shown on the intake form, not here.
    expect(within(card).queryByText(/From ASIC extract/)).toBeNull()
    // The company's own line — not the client's.
    expect(valueOf(card, 'Company Phone')).toBe('0390000000')
  })

  it('shows dashes for a record saved before these existed', async () => {
    mockDb(CLIENT, {
      ...COMPANY,
      registered_office_address: null,
      principal_place_of_business: null,
      directors: [],
      asic_extract_date: null,
      company_details_source: null,
    })
    const card = await renderPage()

    expect(valueOf(card, 'Registered Office')).toBe('—')
    expect(valueOf(card, 'Principal Place of Business')).toBe('—')
    expect(valueOf(card, 'Director')).toBe('—')
    expect(within(card).queryByText(/From ASIC extract/)).toBeNull()
  })
})

describe('Client detail page — company and trust', () => {
  it('a Company: its own ABN, and no Trust section', async () => {
    mockDb(CLIENT, COMPANY)
    const card = await renderPage()

    expect(valueOf(card, 'Company name')).toBe('Sample Trading Pty Ltd')
    expect(valueOf(card, 'ACN')).toBe('123456780')
    expect(valueOf(card, 'Company ABN')).toBe('11123456780')
    expect(within(card).queryByText('Trust')).toBeNull()
    expect(within(card).queryByText('Trust ABN')).toBeNull()
  })

  it('a trustee with no ABN of its own: says so, and shows the trust and its ABN', async () => {
    mockDb(CLIENT, {
      ...COMPANY,
      entity_type: 'trust',
      abn_number: '',
      trust_name: 'Sample Family Trust',
      trust_abn_number: '51824753556',
    })
    const card = await renderPage()

    expect(valueOf(card, 'Company ABN')).toBe('No ABN of its own')
    expect(within(card).getByText('Trust')).toBeTruthy()
    expect(valueOf(card, 'Trust name')).toBe('Sample Family Trust')
    expect(valueOf(card, 'Trust ABN')).toBe('51824753556')
  })
})

describe('Client page and Archive page', () => {
  const ARCHIVED = {
    ...CLIENT,
    archived_at: '2026-10-01T02:30:00.000Z',
    archived_by: 'Gabby',
    archived_reason: 'lead_deleted',
  }

  it('sends an archived file from the client page to the Archive', async () => {
    mockDb(ARCHIVED, COMPANY)
    await expect(ClientDetailPage({ params: Promise.resolve({ id: 'cl_1' }) })).rejects.toThrow(
      'redirect:/sbr/archive/cl_1',
    )
  })

  it('sends an active file from the Archive page to the client page', async () => {
    mockDb(CLIENT, COMPANY)
    await expect(ArchivedClientPage({ params: Promise.resolve({ id: 'cl_1' }) })).rejects.toThrow(
      'redirect:/clients/cl_1',
    )
  })

  it('shows an archived file the same way, with who archived it and why', async () => {
    mockDb(ARCHIVED, COMPANY)
    render(await ArchivedClientPage({ params: Promise.resolve({ id: 'cl_1' }) }))

    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('Archived')
    expect(banner.textContent).toContain('by Gabby')
    expect(banner.textContent).toContain('Its lead was deleted')
    // The same file view as the client page.
    expect(screen.getByText('Company and Trust Details')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Archive/ }).getAttribute('href')).toBe('/sbr/archive')
    // No editing from the Archive.
    expect(screen.queryByRole('link', { name: /Continue intake/ })).toBeNull()
  })
})
