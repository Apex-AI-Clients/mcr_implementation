import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LODGEMENT_SUMMARY_PROMPT_TEMPLATE, OPENROUTER_NARRATIVE_MODEL } from '../prompts'
import type { DpnRiskBreakdown, DebtBreakdown } from '@/lib/analysis/types'

// Track the mock create function so we can configure it per test
const mockCreate = vi.fn()

vi.mock('../openrouterClient', () => ({
  getOpenRouterClient: () => ({
    chat: { completions: { create: mockCreate } },
  }),
}))

// Import AFTER mock registration
const { generateLodgementAiSummary, lodgementSummaryPrompt } = await import('../lodgementSummary')

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

describe('LODGEMENT_SUMMARY_PROMPT_TEMPLATE', () => {
  it('contains all expected placeholders', () => {
    const placeholders = [
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
    ]
    for (const p of placeholders) {
      expect(LODGEMENT_SUMMARY_PROMPT_TEMPLATE).toContain(p)
    }
  })
})

describe('generateLodgementAiSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { text, model } on success', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'This is the AI summary.' } }],
      model: OPENROUTER_NARRATIVE_MODEL,
    })

    const result = await generateLodgementAiSummary({
      dpnRisk: makeDpnRisk(),
      debtBreakdown: makeDebtBreakdown(),
      summary: { numberOfLateLodgements: 6, cumulativeDaysLate: 1320 },
    })

    expect(result.text).toBe('This is the AI summary.')
    expect(result.model).toBe(OPENROUTER_NARRATIVE_MODEL)
  })

  it('throws on API error so caller can handle it', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limit'))

    await expect(
      generateLodgementAiSummary({
        dpnRisk: makeDpnRisk(),
        debtBreakdown: makeDebtBreakdown(),
        summary: { numberOfLateLodgements: 6, cumulativeDaysLate: 1320 },
      }),
    ).rejects.toThrow('API rate limit')
  })

  it('prompt substitution replaces all placeholders — no {var} strings leak through', async () => {
    let capturedPrompt = ''
    mockCreate.mockImplementationOnce(
      async ({ messages }: { messages: Array<{ content: string }> }) => {
        capturedPrompt = messages[0].content
        return {
          choices: [{ message: { content: 'ok' } }],
          model: OPENROUTER_NARRATIVE_MODEL,
        }
      },
    )

    await generateLodgementAiSummary({
      dpnRisk: makeDpnRisk(),
      debtBreakdown: makeDebtBreakdown(),
      summary: { numberOfLateLodgements: 6, cumulativeDaysLate: 1320 },
    })

    // No unreplaced placeholders
    expect(capturedPrompt).not.toMatch(/\{[a-zA-Z]+\}/)
  })

  it('currency values in prompt use comma-formatted integers (no decimals)', async () => {
    let capturedPrompt = ''
    mockCreate.mockImplementationOnce(
      async ({ messages }: { messages: Array<{ content: string }> }) => {
        capturedPrompt = messages[0].content
        return {
          choices: [{ message: { content: 'ok' } }],
          model: OPENROUTER_NARRATIVE_MODEL,
        }
      },
    )

    await generateLodgementAiSummary({
      dpnRisk: makeDpnRisk({ totalGrossLate: 12345, totalNetAtRisk: 0 }),
      debtBreakdown: makeDebtBreakdown({ principalNet: 10000 }),
      summary: { numberOfLateLodgements: 6, cumulativeDaysLate: 1320 },
    })

    // Should contain comma-formatted value like "12,345" not "12345.00"
    expect(capturedPrompt).toContain('12,345')
    expect(capturedPrompt).not.toContain('12345.00')
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
      dpnRisk: makeDpnRisk({ totalGrossLate: 90_000, totalReducedByAmendments: 90_000, totalNetAtRisk: 0 }),
      debtBreakdown: makeDebtBreakdown(),
      summary: { numberOfLateLodgements: 6, cumulativeDaysLate: 1320 },
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
    const prompt = lodgementSummaryPrompt({
      dpnRisk: makeDpnRisk(),
      debtBreakdown: makeDebtBreakdown({ paymentsReceived: 0, paymentsCount: 0 }),
      summary: { numberOfLateLodgements: 6, cumulativeDaysLate: 1320 },
    })
    expect(prompt).toContain("Estimate from the ATO account (not the ATO's figures)")
    expect(prompt).toContain('Reduced by later amendments for the same periods: $2,150')
    expect(prompt).toContain('Payments received: none (no payments found in the ATO account)')
    expect(prompt).not.toMatch(/paid since|reversed/i)
  })
})

describe('banned words in the summary', () => {
  beforeEach(() => vi.clearAllMocks())
  const input = {
    dpnRisk: makeDpnRisk(),
    debtBreakdown: makeDebtBreakdown(),
    summary: { numberOfLateLodgements: 6, cumulativeDaysLate: 1320 },
  }
  const reply = (content: string) => ({ choices: [{ message: { content } }], model: OPENROUTER_NARRATIVE_MODEL })

  it('asks again when the summary uses "solvency", and keeps the clean rewrite', async () => {
    mockCreate
      .mockResolvedValueOnce(reply('Six lodgements were late, implying ongoing solvency concerns.'))
      .mockResolvedValueOnce(reply('Six lodgements were late.'))
    const result = await generateLodgementAiSummary(input)
    expect(result.text).toBe('Six lodgements were late.')
    const retry = (mockCreate.mock.calls[1][0] as { messages: { content: string }[] }).messages[0].content
    expect(retry).toContain('"solvency"')
  })

  it('removes the offending sentences when the rewrite still uses one', async () => {
    mockCreate
      .mockResolvedValueOnce(reply('The business is insolvent.'))
      .mockResolvedValueOnce(reply('Six lodgements were late. The company appears solvent. Interest was charged.'))
    const result = await generateLodgementAiSummary(input)
    expect(result.text).toBe('Six lodgements were late. Interest was charged.')
  })
})
