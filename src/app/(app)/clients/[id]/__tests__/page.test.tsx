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
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}))
// The rest of the page is not what is under test here.
vi.mock('@/components/admin/DocumentStatusGrid', () => ({ DocumentStatusGrid: () => null }))
vi.mock('@/components/admin/CompletenessBar', () => ({ CompletenessBar: () => null }))
vi.mock('@/components/admin/ClientActions', () => ({ ClientActions: () => null }))
vi.mock('@/components/cvl/ConvertToCvlButton', () => ({ ConvertToCvlButton: () => null }))
vi.mock('@/components/admin/ArchivedClientActions', () => ({ ArchivedClientActions: () => null }))
vi.mock('@/components/admin/PredictOutcomeButton', () => ({ PredictOutcomeButton: () => null }))
vi.mock('@/components/leads/LeadOriginLink', () => ({ LeadOriginLink: () => null }))
vi.mock('@/components/admin/ComparisonJobStatus', () => ({ ComparisonJobStatus: () => null }))
vi.mock('@/lib/financials/jobLiveness', () => ({ findLiveComparisonJob: vi.fn(async () => null) }))
vi.mock('@/components/admin/ReadinessChecklist', () => ({ ReadinessChecklist: () => null }))
vi.mock('@/lib/sbr/loadReadiness', () => ({
  loadReadiness: vi.fn(async () => ({ items: [], canPredict: false, waitingFor: [], dpn: null })),
}))
// The ATO accounts panel's data (atoAccount/store.ts): none, unless a test says otherwise.
vi.mock('@/lib/analysis/atoAccount/store', () => ({
  loadAtoAccounts: vi.fn(async () => ({ accounts: [], totalDebt: null })),
  hasUnanalysedAtoAccounts: vi.fn(async () => false),
}))
vi.mock('@/lib/analysis/autoRun', () => ({
  scheduleClientAnalysis: vi.fn(async () => ({ jobId: 'job-1', started: true })),
}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadReadiness } from '@/lib/sbr/loadReadiness'
import { scheduleClientAnalysis } from '@/lib/analysis/autoRun'
import { hasUnanalysedAtoAccounts } from '@/lib/analysis/atoAccount/store'
import ClientDetailPage from '../page'
import ArchivedClientPage from '@/app/(app)/sbr/archive/[id]/page'
import CvlClientPage from '@/app/(app)/cvl/[id]/page'

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

function mockDb(client: Record<string, unknown>, company: Record<string, unknown> | null, cvlCase: Record<string, unknown> | null = null) {
  const rows: Record<string, unknown> = {
    cvl_cases: cvlCase,
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

describe('Client detail page — waiting analysis', () => {
  const waiting = { items: [{ status: 'not_started' }], canPredict: false, waitingFor: [], dpn: null }
  const quiet = { items: [{ status: 'ready' }], canPredict: true, waitingFor: [], dpn: true }

  it('starts work that is waiting, so nobody has to press Run now', async () => {
    vi.mocked(scheduleClientAnalysis).mockClear()
    vi.mocked(loadReadiness).mockClear()
    mockDb(CLIENT, COMPANY)
    vi.mocked(loadReadiness).mockResolvedValueOnce(waiting as never).mockResolvedValueOnce(quiet as never)
    await renderPage()
    expect(scheduleClientAnalysis).toHaveBeenCalledWith(expect.anything(), 'cl_1', expect.any(Function))
    // Read again, so the checklist shows the run.
    expect(loadReadiness).toHaveBeenCalledTimes(2)
  })

  it('starts a run for an ATO account CSV with no analysis yet', async () => {
    vi.mocked(scheduleClientAnalysis).mockClear()
    mockDb(CLIENT, COMPANY)
    vi.mocked(loadReadiness).mockResolvedValue(quiet as never)
    vi.mocked(hasUnanalysedAtoAccounts).mockResolvedValueOnce(true)
    await renderPage()
    expect(scheduleClientAnalysis).toHaveBeenCalledWith(expect.anything(), 'cl_1', expect.any(Function))
  })

  it('starts nothing when nothing is waiting', async () => {
    vi.mocked(scheduleClientAnalysis).mockClear()
    vi.mocked(loadReadiness).mockClear()
    mockDb(CLIENT, COMPANY)
    vi.mocked(loadReadiness).mockResolvedValueOnce(quiet as never)
    await renderPage()
    expect(scheduleClientAnalysis).not.toHaveBeenCalled()
  })
})

describe('Client page, Archive page and CVL page — files in CVL (migration 0039)', () => {
  const PARAMS = { params: Promise.resolve({ id: 'cl_1' }) }
  const IN_CVL = { ...CLIENT, archived_at: null, workflow: 'cvl' }
  const CASE = {
    id: 'case-1',
    client_id: 'cl_1',
    origin: 'sbr_client',
    status: 'forms_prepared',
    forms_prepared_at: '2026-10-25T00:00:00.000Z',
    printed_at: null,
    sbr_archived_at: '2026-10-20T00:00:00.000Z',
    sbr_archived_by: 'Gabby',
    created_by: 'Gabby',
    created_at: '2026-10-20T00:00:00.000Z',
  }
  const FROM_LEAD = { ...CASE, origin: 'lead', sbr_archived_at: null, sbr_archived_by: null }

  it('sends a file moved to CVL from the SBR client page to its read-only SBR record', async () => {
    mockDb(IN_CVL, COMPANY, CASE)
    await expect(ClientDetailPage(PARAMS)).rejects.toThrow('redirect:/sbr/archive/cl_1')
  })

  it('sends a CVL file that came straight from a lead to the CVL page: it has no SBR record', async () => {
    mockDb(IN_CVL, COMPANY, FROM_LEAD)
    await expect(ClientDetailPage(PARAMS)).rejects.toThrow('redirect:/cvl/cl_1')
    await expect(ArchivedClientPage(PARAMS)).rejects.toThrow('redirect:/cvl/cl_1')
  })

  it('sends an SBR file from the CVL page to the SBR client page', async () => {
    mockDb({ ...CLIENT, workflow: 'sbr' }, COMPANY)
    await expect(CvlClientPage(PARAMS)).rejects.toThrow('redirect:/clients/cl_1')
  })

  it('shows the SBR record of a moved file read-only, pointing to the CVL file', async () => {
    mockDb(IN_CVL, COMPANY, CASE)
    render(await ArchivedClientPage(PARAMS))
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('Moved to CVL')
    expect(banner.textContent).toContain('by Gabby')
    expect(within(banner).getByRole('link', { name: 'Open the CVL file' }).getAttribute('href')).toBe('/cvl/cl_1')
    expect(screen.queryByRole('link', { name: /Continue intake/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Mark printed/ })).toBeNull()
  })

  it('shows the CVL page: the forms per director, the analyses as tiles inside CVL, no status bar', async () => {
    mockDb(IN_CVL, COMPANY, CASE)
    render(await CvlClientPage(PARAMS))
    expect(screen.getByRole('heading', { level: 1, name: 'Dean Whitlock' })).toBeTruthy()
    // No status controls on this page.
    expect(screen.queryByRole('button', { name: 'Mark printed' })).toBeNull()
    // Form 509 and Part A for the company, a Part B for each director, each to fill in or preview.
    const fillIn = screen.getAllByRole('link', { name: /Fill in/ }).map((l) => l.getAttribute('href'))
    expect(fillIn).toEqual([
      '/cvl/cl_1/forms/509?subject=company',
      '/cvl/cl_1/forms/507a?subject=company',
      '/cvl/cl_1/forms/507b?subject=director%3A1',
      '/cvl/cl_1/forms/507b?subject=director%3A2',
    ])
    expect(screen.getByText('— Jane Sample')).toBeTruthy()
    expect(screen.getByText('— Raj Example')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Preview$/ })[0].getAttribute('href')).toBe('/api/admin/cvl/case-1/preview?form=509&subject=company')
    // Each form's line says only where it stands: no ASIC version, no who saved it.
    expect(screen.queryByText(/ASIC version/)).toBeNull()
    expect(screen.queryByText(/Draft saved .* by /)).toBeNull()
    // No print page: each form downloads from its own row.
    expect(screen.queryByRole('link', { name: /Preview and print/ })).toBeNull()
    const download = screen.getByRole('link', { name: 'Download Form 507 Part B — Raj Example' })
    expect(download.getAttribute('href')).toBe('/api/admin/cvl/case-1/preview?form=507b&subject=director%3A2&download=1')
    expect(download.hasAttribute('download')).toBe(true)
    // Each analysis says what is on file.
    const tile = within(screen.getByRole('region', { name: 'Analyses' })).getByRole('link', { name: /Director penalty notices/ })
    expect(tile.textContent).toMatch(/None uploaded|on file|confirmed/)
    expect(screen.queryByRole('link', { name: /Form 509 values/ })).toBeNull()
    // Each form: Fill in first, then Preview, then Download.
    const row = screen.getAllByRole('link', { name: /Fill in/ })[0].parentElement as HTMLElement
    expect([...row.querySelectorAll('a')].map((a) => a.textContent?.trim())).toEqual(['Fill in', 'Preview', 'Download'])
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    // No director's personal risk section on this page.
    expect(screen.queryByText('Director’s personal risk')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Analyses' })).getByRole('link', { name: /Director penalty notices/ }).getAttribute('href')).toBe(
      '/cvl/cl_1/director-penalty-notices',
    )
    expect(screen.getByRole('link', { name: /Edit details/ }).getAttribute('href')).toBe('/cvl/cl_1/intake')
    expect(screen.getByRole('link', { name: /CVL clients/ }).getAttribute('href')).toBe('/cvl')
    // SBR only: no prediction checklist, no Continue intake.
    expect(screen.queryByRole('link', { name: /Continue intake/ })).toBeNull()
  })
})
