import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  mapLead,
  readWebsiteDebt,
  unmappedWebsiteKeys,
  websiteFieldKeys,
  websiteFormId,
  websitePageUrl,
} from '../ingest'
import { describeDebt, DEBT_AS_TYPED } from '../format'

/**
 * Website debt from any of its forms, typed or picked (migration 0053), and
 * the form/page/key names a website enquiry now carries. Synthetic data only.
 */

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8'))
}

afterEach(() => vi.restoreAllMocks())

describe('readWebsiteDebt', () => {
  it.each([
    ['200,000', 200_000],
    ['$200,000', 200_000],
    ['200k', 200_000],
    ['200K', 200_000],
    ['80000', 80_000],
    ['1.2m', 1_200_000],
    ['$1.2M', 1_200_000],
    ['  $45,000  ', 45_000],
  ])('reads a typed %s as that amount, keeping the words', (raw, amount) => {
    expect(readWebsiteDebt(raw)).toEqual({ kind: 'typed', amount, text: raw.trim() })
  })

  it.each([
    ['3', 100_000, 124_999],
    ['-1', 30_000, 49_999],
    ['5', 150_000, null],
    ['100k_125k', 100_000, 124_999],
    ['$100,000 - $124,999', 100_000, 124_999],
    ['$150,000 or +', 150_000, null],
  ])('reads the dropdown answer %s as its range', (raw, min, max) => {
    expect(readWebsiteDebt(raw)).toEqual({ kind: 'dropdown', min, max })
  })

  it.each(['about two hundred grand', 'not sure', 'between 50k and 100k', '200'])(
    'keeps %s as text, with no amount',
    (raw) => {
      expect(readWebsiteDebt(raw)).toEqual({ kind: 'unrecognised', text: raw })
    },
  )

  it.each([null, '', '   '])('treats %s as no answer', (raw) => {
    expect(readWebsiteDebt(raw)).toEqual({ kind: 'absent' })
  })

  it('never applies a dropdown code on a form known to be free text', () => {
    expect(readWebsiteDebt('3', 'free_text')).toEqual({ kind: 'unrecognised', text: '3' })
    expect(readWebsiteDebt('200,000', 'free_text')).toEqual({ kind: 'typed', amount: 200_000, text: '200,000' })
  })
})

describe('mapLead — website debt, whichever form sent it (0053)', () => {
  // The results-page form: a typed debt in debt_code, and no business type question.
  const typedForm = (debt: string) => {
    const { biz_type: _drop, ...rest } = fixture('website_results_120k')
    void _drop
    return { ...rest, debt_code: debt }
  }

  it('stores a typed "200,000" as the amount, with the words, with no form key given', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = mapLead(typedForm('200,000'), 'website', 'w1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(200_000)
    expect(result.lead.debtMax).toBe(200_000)
    expect(result.lead.debtText).toBe('200,000')
    // Read cleanly: nothing to warn about, and the message is left as written.
    expect(warn).not.toHaveBeenCalled()
    expect(result.lead.message).toBe('Freight hire, behind on GST.')
  })

  it('still reads a dropdown form as a range, with no typed text', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const result = mapLead(fixture('website_lead'), 'website', 'w2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBe(100_000)
    expect(result.lead.debtMax).toBe(124_999)
    expect(result.lead.debtText).toBeNull()
  })

  it('keeps unreadable text as the debt and warns, naming the key and form but never the answer', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = mapLead(typedForm('about two hundred grand'), 'website', 'w3', { formId: 'website_results' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.debtMin).toBeNull()
    expect(result.lead.debtMax).toBeNull()
    expect(result.lead.debtText).toBe('about two hundred grand')
    const lines = warn.mock.calls.map((c) => String(c[0]))
    expect(lines).toContain('[webhooks/leads] website debt unrecognised key=debt_code form_id=website_results')
    expect(lines.join('\n')).not.toContain('two hundred')
  })

  it('warns when the debt was sent blank, or not sent at all', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mapLead(typedForm(''), 'website', 'w4')
    const { debt_code: _gone, ...noDebt } = typedForm('')
    void _gone
    mapLead(noDebt, 'website', 'w5')
    const lines = warn.mock.calls.map((c) => String(c[0]))
    expect(lines).toContain('[webhooks/leads] website debt blank key=debt_code form_id=unknown')
    expect(lines).toContain('[webhooks/leads] website debt not sent keys=debt_code,debt form_id=unknown')
  })

  it('notes a business type the form did not ask, without warning', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = mapLead(typedForm('200,000'), 'website', 'w6', { formId: 'website_results' })
    expect(result.ok && result.lead.entityType).toBeNull()
    expect(info.mock.calls.map((c) => String(c[0]))).toContain(
      '[webhooks/leads] website business type not asked keys=biz_type form_id=website_results',
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns on a business type it cannot read, without the value', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = mapLead({ ...fixture('website_lead'), biz_type: 'Sole trader' }, 'website', 'w7')
    expect(result.ok && result.lead.entityType).toBeNull()
    const lines = warn.mock.calls.map((c) => String(c[0]))
    expect(lines).toContain('[webhooks/leads] website business type unrecognised value key=biz_type form_id=unknown')
    expect(lines.join('\n')).not.toContain('Sole trader')
  })

  it('carries the form id, page and key names handed in', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const result = mapLead(fixture('website_lead'), 'website', 'w8', {
      formId: 'website_home',
      pageUrl: 'https://example.test/debt-help',
      fieldKeys: ['name', 'email'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.metaFormId).toBe('website_home')
    expect(result.lead.pageUrl).toBe('https://example.test/debt-help')
    expect(result.lead.metaFieldKeys).toEqual(['name', 'email'])
  })
})

describe('website form, page and key names (0053)', () => {
  it('reads the form id, and nothing that is not one', () => {
    expect(websiteFormId({ form_id: ' website_results ' })).toBe('website_results')
    expect(websiteFormId({ form_id: '' })).toBeNull()
    expect(websiteFormId({ form_id: 7 })).toBeNull()
    expect(websiteFormId({})).toBeNull()
    expect(websiteFormId({ form_id: 'x'.repeat(101) })).toBeNull()
  })

  it('keeps the page without its query string or fragment', () => {
    expect(websitePageUrl({ page_url: 'https://example.test/results?email=a@b.test&gclid=1#form' })).toBe(
      'https://example.test/results',
    )
    expect(websitePageUrl({ page_url: '/results' })).toBe('/results')
    expect(websitePageUrl({ page_url: '' })).toBeNull()
    expect(websitePageUrl({})).toBeNull()
  })

  it('keeps key names only, never values', () => {
    const keys = websiteFieldKeys({ name: 'Test Person', email: 'test@example.test', debt_code: '200,000' })
    expect(keys).toEqual(['name', 'email', 'debt_code'])
    expect(JSON.stringify(keys)).not.toContain('Test Person')
  })

  it('reports keys the website map does not read, not its own ids', () => {
    expect(
      unmappedWebsiteKeys(['name', 'email', 'phone', 'debt_code', 'biz_type', 'form_id', 'page_url', 'external_id', 'debt_label', 'website_url', 'company_size']),
    ).toEqual(['company_size'])
  })
})

describe('describeDebt — what staff see (0053)', () => {
  it('shows a typed amount in full, as typed, even where the table abbreviates', () => {
    expect(describeDebt({ debtMin: 200_000, debtMax: 200_000, debtText: '200,000' })).toEqual({
      text: '$200,000',
      typed: true,
      empty: false,
    })
    expect(describeDebt({ debtMin: 1_200_000, debtMax: 1_200_000, debtText: '1.2m' }, 'full').text).toBe('$1,200,000')
  })

  it('shows unreadable typed text exactly as sent', () => {
    expect(describeDebt({ debtMin: null, debtMax: null, debtText: 'about two hundred grand' })).toEqual({
      text: 'about two hundred grand',
      typed: true,
      empty: false,
    })
  })

  it('shows a dropdown answer as its range, not as typed', () => {
    expect(describeDebt({ debtMin: 100_000, debtMax: 124_999, debtText: null })).toEqual({
      text: '$100k – $125k',
      typed: false,
      empty: false,
    })
    expect(describeDebt({ debtMin: 150_000, debtMax: null }, 'full').text).toBe('$150,000+')
  })

  it('shows a debt staff entered as before, with no hint', () => {
    expect(describeDebt({ debtMin: 200_000, debtMax: 200_000, debtText: null })).toEqual({
      text: '$200k',
      typed: false,
      empty: false,
    })
  })

  it('is empty when nothing is known', () => {
    expect(describeDebt({ debtMin: null, debtMax: null, debtText: null }).empty).toBe(true)
  })

  it('labels the hint "as typed"', () => {
    expect(DEBT_AS_TYPED).toBe('as typed')
  })
})
