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
const { generateLodgementAiSummary } = await import('../lodgementSummary')

function makeDpnRisk(overrides: Partial<DpnRiskBreakdown> = {}): DpnRiskBreakdown {
  return {
    thresholdDays: 90,
    contributingDebits: [],
    totalGrossLate: 9408,
    totalPaidSince: 9408,
    totalNetAtRisk: 0,
    periodStart: '2019-02-21T00:00:00.000Z',
    periodEnd: '2026-04-15T00:00:00.000Z',
    ...overrides,
  }
}

function makeDebtBreakdown(overrides: Partial<DebtBreakdown> = {}): DebtBreakdown {
  return {
    principalDebits: 416420,
    principalCredits: 24396,
    principalNet: 392024,
    interestDebits: 67494,
    interestCredits: 3047,
    interestNet: 64447,
    penaltyDebits: 0,
    penaltyCredits: 0,
    penaltyNet: 0,
    paymentsReceived: 362335,
    governmentCredits: 0,
    otherCredits: 32999,
    totalAtoDebt: 456471,
    currentBalance: 61137,
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
      '{totalGrossLate}',
      '{totalReversed}',
      '{totalNetAtRisk}',
      '{principalNet}',
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
