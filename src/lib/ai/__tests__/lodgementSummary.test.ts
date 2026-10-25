import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LODGEMENT_SUMMARY_PROMPT_TEMPLATE } from '../prompts'
import type { DpnRiskBreakdown, DebtBreakdown } from '@/lib/analysis/types'

/** The lodgement summary, with Claude mocked. Synthetic figures only. */

const askClaude = vi.fn()
vi.mock('../openrouterClient', () => ({ askClaude: (...args: unknown[]) => askClaude(...args) }))

// Import AFTER mock registration
const { generateLodgementAiSummary, isClaudeSummary, lodgementSummaryPrompt, lodgementSummaryWithoutFigures } = await import('../lodgementSummary')

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

function makeDebtBreakdown(overrides: Partial<DebtBreakdown> = {}): DebtBreakdown {
  return {
    principalDebits: 400000,
    principalCredits: 20000,
    principalNet: 380000,
    interestDebits: 60000,
    interestCredits: 5000,
    interestNet: 55000,
    penaltyDebits: 0,
    penaltyCredits: 0,
    penaltyNet: 0,
    auditDebits: 0,
    auditCredits: 0,
    auditNet: 0,
    paymentsReceived: 350000,
    paymentsCount: 40,
    firstPaymentDate: null,
    lastPaymentDate: null,
    governmentCredits: 0,
    otherCredits: 30000,
    totalAtoDebt: 435000,
    refundsPaid: 0,
    openingBalance: 0,
    composedBalance: 55000,
    atoBalance: null,
    atoBalanceDate: null,
    unexplainedDifference: null,
    currentBalance: 55000,
    ...overrides,
  }
}

const input = {
  dpnRisk: makeDpnRisk(),
  debtBreakdown: makeDebtBreakdown(),
  summary: { numberOfLateLodgements: 6, cumulativeDaysLate: 1320 },
}

beforeEach(() => askClaude.mockReset())

describe('LODGEMENT_SUMMARY_PROMPT_TEMPLATE', () => {
  it('contains all expected placeholders', () => {
    for (const p of [
      '{periodStart}',
      '{periodEnd}',
      '{numberOfLateLodgements}',
      '{cumulativeDaysLate}',
      '{dpnSection}',
      '{principalNet}',
      '{auditNet}',
      '{bannedWordsInstruction}',
      '{interestNet}',
      '{penaltyNet}',
      '{paymentsReceived}',
    ]) {
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

describe('DPN figures in the prompt', () => {
  const notices = {
    unpaid: 228_000,
    removable: 110_000,
    staysWithDirector: 118_000,
    deadline: '2026-10-21',
    daysLeft: 3,
    issuedOn: '2026-09-30',
    byType: [],
    notices: 2,
  }

  it("uses the notices' own figures when notices are on file, not the estimate", () => {
    const prompt = lodgementSummaryPrompt({
      ...input,
      dpnRisk: makeDpnRisk({ totalGrossLate: 90_000, totalReducedByAmendments: 90_000, totalNetAtRisk: 0 }),
      notices,
    })
    expect(prompt).toContain("source: the ATO's director penalty notices")
    expect(prompt).toContain('Unpaid: $228,000')
    expect(prompt).toContain('Stays with the director unless paid: $118,000')
    expect(prompt).toContain('21 Oct 2026')
    expect(prompt).not.toContain('Estimate from the ATO account')
    expect(prompt).not.toContain('90,000')
  })

  it('labels the estimate as one, and never calls an amendment a payment', () => {
    const prompt = lodgementSummaryPrompt({ ...input, debtBreakdown: makeDebtBreakdown({ paymentsReceived: 0, paymentsCount: 0 }) })
    expect(prompt).toContain("Estimate from the ATO account (not the ATO's figures)")
    expect(prompt).toContain('Reduced by later amendments for the same periods: $2,150')
    expect(prompt).toContain('Payments received: none (no payments found in the ATO account)')
    expect(prompt).not.toMatch(/paid since|reversed/i)
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
