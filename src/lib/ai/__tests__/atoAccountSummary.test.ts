import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyseAtoAccount } from '@/lib/analysis/atoAccount'

/** The income tax and super guarantee summaries, with Claude mocked. Synthetic figures only. */

const askClaude = vi.fn()
vi.mock('../openrouterClient', () => ({ askClaude: (...args: unknown[]) => askClaude(...args) }))

// Import AFTER mock registration
const { generateAtoAccountSummary, incomeTaxSummaryPrompt, superGuaranteeSummaryPrompt } = await import('../atoAccountSummary')

const MODEL = 'anthropic/claude-sonnet-5.5'
const reply = (text: string) => ({ text, model: MODEL, generationId: 'gen-1' })

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
const INCOME_TAX = analyseAtoAccount(
  [
    '"Income tax 001"',
    '"EXAMPLE TRADING PTY LTD"',
    HEADER,
    `"01 Oct 2026","01 Oct 2026","'General interest charge calculated from 01 Sep 26 to 30 Sep 26","$100.00","","$20,100.00 DR"`,
    `"16 Apr 2026","15 May 2026","' Tax return Companies - Income Tax for the period from 01 Jul 24 to 30 Jun 25","$20,000.00","","$20,000.00 DR"`,
    `"01 Apr 2026","01 Apr 2026","'Payment received","","$0.00","$0.00"`,
  ].join('\n'),
)
const SG = analyseAtoAccount(
  [
    '"Superannuation guarantee employer 005"',
    '"EXAMPLE TRADING PTY LTD"',
    HEADER,
    `"17 Sep 2026","04 Nov 2026","'SG Part 7 penalty - remission","","$600.00","$5,900.00 DR"`,
    `"17 Sep 2026","04 Nov 2026","'SG Part 7 penalty","$1,000.00","","$6,500.00 DR"`,
    `"16 Sep 2026","16 Sep 2026","'SGC Statement (Liability) - SG Administration Fee for the period from 01 Jan 26 to 31 Mar 26","$500.00","","$5,500.00 DR"`,
    `"16 Sep 2026","16 Sep 2026","'SGC Statement (Liability) - SG Shortfall for the period from 01 Jan 26 to 31 Mar 26","$5,000.00","","$5,000.00 DR"`,
    `"16 Sep 2026","16 Sep 2026","'Default SGC Statement (Liability) - Superannuation Guarantee (Quarterly) for the period from 01 Jan 26 to 31 Mar 26","","$0.00","$0.00"`,
  ].join('\n'),
)

beforeEach(() => askClaude.mockReset())

describe('the prompts', () => {
  it('give an income tax account its balance, each assessment and its unpaid days, and no lodgement lateness', () => {
    if (INCOME_TAX.kind !== 'income_tax') throw new Error('kind')
    const prompt = incomeTaxSummaryPrompt(INCOME_TAX, INCOME_TAX.summary)
    expect(prompt).toContain('Balance owing: $20,100 owed to the ATO, as at 1 Oct 2026')
    expect(prompt).toContain('1 Jul 2024 to 30 Jun 2025: $20,000, assessed 16 Apr 2026, payment due 15 May 2026; $20,000 unpaid 139 days past the payment due date')
    expect(prompt).toContain('never say a return was lodged late')
    expect(prompt).not.toMatch(/\{\w+\}/)
  })

  it('give a super guarantee account its charge, how it was raised, and Part 7, without saying who lodged', () => {
    if (SG.kind !== 'super_guarantee') throw new Error('kind')
    const prompt = superGuaranteeSummaryPrompt(SG, SG.summary)
    expect(prompt).toContain('SG shortfall: $5,000; nominal interest: $0; administration fees: $500; together: $5,500')
    expect(prompt).toContain('with an ATO default assessment: 1')
    expect(prompt).toContain('Part 7 penalty: $1,000 charged, $600 remitted, $400 net')
    expect(prompt).toContain('Never write "lodged by the company"')
    expect(prompt).not.toMatch(/\{\w+\}/)
  })
})

describe('the checks', () => {
  it('keeps a summary whose figures are all given', async () => {
    if (INCOME_TAX.kind !== 'income_tax') throw new Error('kind')
    askClaude.mockResolvedValueOnce(reply('The account shows $20,100 owed at 1 Oct 2026, from a $20,000 assessment unpaid for 139 days.'))
    const out = await generateAtoAccountSummary({ ...INCOME_TAX, kind: 'income_tax', summary: INCOME_TAX.summary })
    expect(out.model).toBe(MODEL)
    expect(askClaude).toHaveBeenCalledTimes(1)
    expect(askClaude.mock.calls[0][0]).toMatchObject({ purpose: 'summary', label: 'income-tax-summary' })
  })

  it('writes it again once when a figure was made up, then withholds the figures', async () => {
    if (INCOME_TAX.kind !== 'income_tax') throw new Error('kind')
    askClaude.mockResolvedValueOnce(reply('The company owes $55,555.')).mockResolvedValueOnce(reply('The company owes $66,666.'))
    const out = await generateAtoAccountSummary({ ...INCOME_TAX, kind: 'income_tax', summary: INCOME_TAX.summary })
    expect(askClaude).toHaveBeenCalledTimes(2)
    expect(out.model).toBe(`${MODEL} (figures withheld)`)
    expect(out.text).not.toMatch(/\$/)
  })

  it('never lets a super guarantee summary say the company lodged a statement', async () => {
    if (SG.kind !== 'super_guarantee') throw new Error('kind')
    askClaude
      .mockResolvedValueOnce(reply('One SGC statement was lodged by the company. The balance is $5,900.'))
      .mockResolvedValueOnce(reply('The quarter was lodged by the company. The balance owing is $5,900.'))
    const out = await generateAtoAccountSummary({ ...SG, kind: 'super_guarantee', summary: SG.summary })
    // Asked again, naming the phrase; the sentence still using it is taken out.
    expect(askClaude.mock.calls[1][0].prompt).toMatch(/"lodged by the company"/)
    expect(out.text).toBe('The balance owing is $5,900.')
  })

  it('holds to the banned words as every summary does', async () => {
    if (SG.kind !== 'super_guarantee') throw new Error('kind')
    askClaude
      .mockResolvedValueOnce(reply('The business is insolvent. It owes $5,900.'))
      .mockResolvedValueOnce(reply('It owes $5,900 at 22 Sep 2026.'))
    const out = await generateAtoAccountSummary({ ...SG, kind: 'super_guarantee', summary: SG.summary })
    expect(out.text).toBe('It owes $5,900 at 22 Sep 2026.')
  })
})
