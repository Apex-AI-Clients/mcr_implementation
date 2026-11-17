import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LODGEMENT_SUMMARY_PROMPT_TEMPLATE } from '../prompts'
import type { DpnRiskBreakdown } from '@/lib/analysis/types'
import { computeLateLodgement } from '@/lib/analysis/computeLateLodgement'
import { parseActivityStatementCsv } from '@/lib/analysis/parseActivityStatement'
import { icaViewOf } from '@/lib/ica/view'

/** The lodgement summary, with Claude mocked. Synthetic figures only. */

const askClaude = vi.fn()
vi.mock('../openrouterClient', () => ({ askClaude: (...args: unknown[]) => askClaude(...args) }))

// Import AFTER mock registration
// Fresh modules: checkedSummary.ts, shared with the other summary tests, must bind to THIS file's mock
// (in a single worker it would otherwise keep the first test file's).
vi.resetModules()
const { canSummarise, generateLodgementAiSummary, isClaudeSummary, lodgementSummaryPrompt, lodgementSummaryWithoutFigures } = await import('../lodgementSummary')

const MODEL = 'anthropic/claude-sonnet-5.5'
const reply = (text: string) => ({ text, model: MODEL, generationId: 'gen-1' })

function makeDpnRisk(overrides: Partial<DpnRiskBreakdown> = {}): DpnRiskBreakdown {
  return {
    thresholdDays: 90,
    contributingDebits: [],
    totalGrossLate: 8150,
    totalReducedByAmendments: 2150,
    totalNetAtRisk: 6000,
    periodStart: '2019-02-21T00:00:00.000Z',
    periodEnd: '2026-04-15T00:00:00.000Z',
    ...overrides,
  }
}

// A verified ATO account (synthetic rows): GST 380,000 lodged, interest 55,000, payments 350,000; balance 85,000.
const ACCOUNT_CSV = [
  '"Activity statement 001"',
  '"TEST ENTITY"',
  'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance',
  '"05 Mar 2026","05 Mar 2026","\'Payment received","","$350,000.00","$85,000.00 DR"',
  '"01 Feb 2026","01 Feb 2026","\'General interest charge calculated from 01 Jan 26 to 31 Jan 26","$55,000.00","","$435,000.00 DR"',
  '"10 Jan 2026","28 Oct 2025","\'Original Activity Statement for the period ending 30 Sep 25","","","$380,000.00 DR"',
  '"10 Jan 2026","28 Oct 2025","\'- GST","$380,000.00","","$380,000.00 DR"',
  '"01 Jan 2026","01 Jan 2026","\'Payment received","","$0.00","$0.00"',
].join('\r\n')
const ACCOUNT = icaViewOf({ rows: computeLateLodgement(parseActivityStatementCsv(ACCOUNT_CSV)).rows, label: 'Activity statement 001', ica_status: 'verified' })

const input = {
  dpnRisk: makeDpnRisk(),
  account: ACCOUNT,
  summary: { numberOfLateLodgements: 6, cumulativeDaysLate: 1320 },
}

beforeEach(() => askClaude.mockReset())

describe('LODGEMENT_SUMMARY_PROMPT_TEMPLATE', () => {
  it('contains all expected placeholders', () => {
    for (const p of ['{periodStart}', '{periodEnd}', '{numberOfLateLodgements}', '{cumulativeDaysLate}', '{dpnSection}', '{accountSection}', '{bannedWordsInstruction}']) {
      expect(LODGEMENT_SUMMARY_PROMPT_TEMPLATE).toContain(p)
    }
  })

  it('leaves no placeholder unfilled, and formats amounts with commas, no decimals', () => {
    const prompt = lodgementSummaryPrompt({ ...input, dpnRisk: makeDpnRisk({ totalGrossLate: 12345, totalNetAtRisk: 0 }) })
    expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/)
    expect(prompt).toContain('12,345')
    expect(prompt).not.toContain('12345.00')
  })
})

describe('generateLodgementAiSummary', () => {
  it('asks Claude for a summary from the computed figures, and keeps one that checks out', async () => {
    askClaude.mockResolvedValueOnce(reply('Six lodgements were late. Payments of $350,000 were received.'))
    const result = await generateLodgementAiSummary(input)
    expect(result).toEqual({ text: 'Six lodgements were late. Payments of $350,000 were received.', model: MODEL })
    expect(askClaude.mock.calls[0][0]).toMatchObject({ purpose: 'summary', label: 'lodgement-summary' })
  })

  it('lets an AI failure through, so the caller stores none', async () => {
    askClaude.mockRejectedValueOnce(new Error('AI unavailable'))
    await expect(generateLodgementAiSummary(input)).rejects.toThrow('AI unavailable')
  })

  it('writes again once when a figure is not one given, then without figures', async () => {
    askClaude.mockResolvedValue(reply('The ATO is owed $999,999.'))
    const result = await generateLodgementAiSummary(input)
    expect(askClaude).toHaveBeenCalledTimes(2)
    expect(askClaude.mock.calls[1][0].prompt).toContain('$999,999')
    expect(result.text).not.toMatch(/\$/)
    expect(result.text).toContain('6 BAS lodgements were filed late, 1320 days late in total.')
    expect(result.model).toBe(`${MODEL} (figures withheld)`)
  })

  it('asks again when the summary uses "solvency", and keeps the clean rewrite', async () => {
    askClaude
      .mockResolvedValueOnce(reply('Six lodgements were late, implying ongoing solvency concerns.'))
      .mockResolvedValueOnce(reply('Six lodgements were late.'))
    const result = await generateLodgementAiSummary(input)
    expect(result.text).toBe('Six lodgements were late.')
    expect(askClaude.mock.calls[1][0].prompt).toContain('"solvency"')
  })

  it('removes the offending sentences when the rewrite still uses one', async () => {
    askClaude
      .mockResolvedValueOnce(reply('The business is insolvent.'))
      .mockResolvedValueOnce(reply('Six lodgements were late. The company appears solvent. Interest was charged.'))
    expect((await generateLodgementAiSummary(input)).text).toBe('Six lodgements were late. Interest was charged.')
  })
})

describe('only proven figures, the ones the page shows', () => {
  const notices = {
    unpaid: 228_000,
    removable: 110_000,
    staysWithDirector: 118_000,
    deadline: '2026-10-21',
    daysLeft: 3,
    issuedOn: '2026-09-30',
    byType: [],
    notices: 2,
    items: [],
    heldBack: false,
    badges: ['Notice adds up', 'Matches the ATO account'],
  }

  it("gives the notices' Unpaid and the account's lodgements more than 90 days late since nil; never the removed figures", () => {
    const prompt = lodgementSummaryPrompt({ ...input, notices })
    expect(prompt).toContain("Unpaid on the ATO's director penalty notices")
    expect(prompt).toContain('$228,000')
    expect(prompt).toContain('Notice adds up, Matches the ATO account')
    expect(prompt).toMatch(/Lodged more than 90 days late .*from the ATO account: \$8,150/)
    expect(prompt).not.toMatch(/Stays with the director|Removed if|Estimated still owing|Reduced by later amendments|110,000|118,000/)
  })

  it("gives the ATO account's verified lines in its words, and the ATO's balance", () => {
    const prompt = lodgementSummaryPrompt(input)
    expect(prompt).toContain('- ATO account, GST lodged: $380,000')
    expect(prompt).toContain('- ATO account, Payments: $350,000 (reduces the balance)')
    expect(prompt).toContain("- The ATO's own balance at 5 Mar 2026: $85,000")
    expect(prompt).not.toMatch(/unexplained/i)
  })

  it('is written only when the account is verified and every current notice proven', () => {
    expect(canSummarise(ACCOUNT, notices)).toBe(true)
    expect(canSummarise(ACCOUNT, null)).toBe(true)
    expect(canSummarise(ACCOUNT, { ...notices, heldBack: true })).toBe(false)
    expect(canSummarise({ ...ACCOUNT, verified: false }, notices)).toBe(false)
    expect(canSummarise(null, notices)).toBe(false)
  })

  it('the summary without figures says where the DPN figures are', () => {
    expect(lodgementSummaryWithoutFigures({ ...input, notices })).toMatch(/Director penalty notices are on file/)
    expect(lodgementSummaryWithoutFigures(input)).toMatch(/No director penalty notices are on file/)
  })
})

describe('isClaudeSummary', () => {
  it('only a summary written by Claude under the checks', () => {
    expect(isClaudeSummary('anthropic/claude-sonnet-5.5')).toBe(true)
    expect(isClaudeSummary('anthropic/claude-sonnet-5.5 (figures withheld)')).toBe(true)
    expect(isClaudeSummary('google/gemini-2.5-flash')).toBe(false)
    expect(isClaudeSummary(null)).toBe(false)
  })
})
