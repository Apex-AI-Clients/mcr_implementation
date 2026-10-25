import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '@/lib/printed/compare'
import { MEANINGS } from '@/lib/printed/meanings'
import { printedFingerprint } from '@/lib/printed/review'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '@/lib/printed/types'

/**
 * The comparison summary: written only from the confirmed key figures, as
 * printed; not while a failed total is unticked; checked figures, written
 * again once, then without figures. The AI is mocked. Synthetic statements.
 */

const askClaude = vi.fn()
const enabled = vi.fn(() => true)
vi.mock('../openrouterClient', () => ({
  askClaude: (...args: unknown[]) => askClaude(...args),
  aiSummariesEnabled: () => enabled(),
}))
const { comparisonSummaryPrompt, generateComparisonSummary, summaryBlock, summaryWithoutFigures } = await import('../financialsComparisonSummary')

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })
const st = (kind: PrintedStatement['kind'], rows: PrintedRow[]): PrintedStatement => ({ kind, title: kind, pages: [1], columns: [fy(2025), fy(2024)], rows, wholeDollars: true })

function comparison({ assetsTotal = 140 } = {}) {
  const doc: ComparisonDocument = {
    documentId: 'fy25',
    filename: 'fy25.pdf',
    uploadedAt: '',
    read: {
      status: 'read',
      pageCount: 2,
      issues: [],
      statements: [
        st('profit_and_loss', [
          r([], 'Income', 'heading', null, null),
          r(['Income'], 'Sales', 'line', 900_000, 800_000),
          r(['Income'], 'Total Income', 'subtotal', 900_000, 800_000),
          r([], 'Expenses', 'heading', null, null),
          r(['Expenses'], 'Wages', 'line', 844_200, 747_900),
          r(['Expenses'], 'Total Expenses', 'subtotal', 844_200, 747_900),
          r([], 'Net Profit', 'total', 55_800, 52_100),
        ]),
        st('balance_sheet', [
          r([], 'Assets', 'heading', null, null),
          r(['Assets'], 'Cash', 'line', 100, 80),
          r(['Assets'], 'Loan - Related Parties', 'line', 40, 30),
          r(['Assets'], 'Total Assets', 'subtotal', assetsTotal, 110),
          r([], 'Liabilities', 'heading', null, null),
          r(['Liabilities'], 'BAS Payable', 'line', 65_000, 70_000),
          r(['Liabilities'], 'Total Liabilities', 'subtotal', 65_000, 70_000),
        ]),
      ],
    },
  }
  return buildPrintedComparison([doc], { comparativeYears: true })
}

function confirmed(c: ReturnType<typeof comparison>, picks: Record<string, string[] | 'none'>): MappingEntry[] {
  const rows = c.tables.flatMap((t) => t.rows)
  return MEANINGS.flatMap((m): MappingEntry[] => {
    const p = picks[m.key]
    if (p === undefined) return []
    if (p === 'none') return [{ meaning: m.key, rowKey: '', label: null, nonePrinted: true, confirmedBy: 'Test Staff', confirmedAt: '2026-10-25T00:00:00Z' }]
    return p.map((label) => ({ meaning: m.key, rowKey: rows.find((x) => x.label === label)!.key, label, nonePrinted: false, confirmedBy: 'Test Staff', confirmedAt: '2026-10-25T00:00:00Z' }))
  })
}

const reply = (text: string) => ({ text, model: 'anthropic/claude-sonnet-5.5', generationId: 'gen-1' })

beforeEach(() => {
  askClaude.mockReset()
  enabled.mockReturnValue(true)
})

describe('the prompt', () => {
  it('gives only the confirmed figures, as printed, per year, and what is confirmed as not printed', () => {
    const c = comparison()
    const prompt = comparisonSummaryPrompt(c, confirmed(c, { revenue: ['Sales'], net_profit: ['Net Profit'], ato_debt: ['BAS Payable'], loan_payable: 'none' }))!
    expect(prompt).toContain('- FY2024 (1 Jul 2023 – 30 Jun 2024): ATO-related debt: $70,000; Revenue: $800,000; Net profit: $52,100')
    expect(prompt).toContain('- FY2025 (1 Jul 2024 – 30 Jun 2025): ATO-related debt: $65,000; Revenue: $900,000; Net profit: $55,800')
    expect(prompt).toMatch(/Not printed in these statements: Loan account — owed BY the company/)
    // Nothing unconfirmed: wages and cash are printed but not confirmed key figures.
    expect(prompt).not.toContain('844,200')
    expect(prompt).not.toMatch(/\$100\b/)
    // The sum of the years' profits is not given.
    expect(prompt).not.toContain('107,900')
    expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/)
  })

  it('is not written from suggestions: nothing confirmed, no prompt', () => {
    expect(comparisonSummaryPrompt(comparison(), [])).toBeNull()
  })
})

describe('when a summary may be written', () => {
  const c = comparison()
  const mapping = confirmed(c, { revenue: ['Sales'] })

  it('not while the AI features are off', () => {
    enabled.mockReturnValue(false)
    expect(summaryBlock({ comparison: c, mapping, builtAt: '2026-10-25T00:00:00Z', checked: null })).toBe('ai_off')
  })

  it('not while a total that does not add up is unticked; yes once ticked', () => {
    const failing = comparison({ assetsTotal: 999 })
    expect(failing.failures.length).toBeGreaterThan(0)
    const m = confirmed(failing, { revenue: ['Sales'] })
    const builtAt = '2026-10-25T00:00:00Z'
    expect(summaryBlock({ comparison: failing, mapping: m, builtAt, checked: null })).toBe('needs_review')
    const tick = { fingerprint: printedFingerprint(failing, builtAt)!, by: 'Test Staff', at: builtAt }
    expect(summaryBlock({ comparison: failing, mapping: m, builtAt, checked: tick })).toBeNull()
  })

  it('not before a key figure is confirmed', () => {
    expect(summaryBlock({ comparison: c, mapping: [], builtAt: null, checked: null })).toBe('no_confirmed_figures')
  })
})

describe('generateComparisonSummary', () => {
  const c = comparison()
  const mapping = confirmed(c, { revenue: ['Sales'], net_profit: ['Net Profit'] })

  it('keeps a summary whose figures check out', async () => {
    askClaude.mockResolvedValueOnce(reply('Revenue rose from $800,000 to $900,000, up $100,000.'))
    const result = await generateComparisonSummary(c, mapping)
    expect(result).toEqual({ text: 'Revenue rose from $800,000 to $900,000, up $100,000.', model: 'anthropic/claude-sonnet-5.5' })
    expect(askClaude).toHaveBeenCalledTimes(1)
    expect(askClaude.mock.calls[0][0]).toMatchObject({ purpose: 'summary' })
  })

  it('writes again once when a figure does not check out, naming it', async () => {
    askClaude.mockResolvedValueOnce(reply('Profits added up to $107,900.')).mockResolvedValueOnce(reply('Revenue rose to $900,000.'))
    const result = await generateComparisonSummary(c, mapping)
    expect(result.text).toBe('Revenue rose to $900,000.')
    expect(askClaude.mock.calls[1][0].prompt).toContain('$107,900')
  })

  it('falls back to a summary without figures when the second try fails too', async () => {
    askClaude.mockResolvedValue(reply('Profits added up to $107,900.'))
    const result = await generateComparisonSummary(c, mapping)
    expect(result.text).not.toMatch(/\$/)
    expect(result.text).toMatch(/Revenue rose between FY2024 and FY2025/)
    expect(result.model).toBe('anthropic/claude-sonnet-5.5 (figures withheld)')
  })

  it('writes again when a banned word is used, then removes the sentence', async () => {
    askClaude.mockResolvedValueOnce(reply('The business is insolvent.')).mockResolvedValueOnce(reply('Revenue rose. The trust appears solvent.'))
    const result = await generateComparisonSummary(c, mapping)
    expect(result.text).toBe('Revenue rose.')
    expect(askClaude.mock.calls[1][0].prompt).toContain('"insolvent"')
  })

  it('lets an AI failure through, for the caller to show none', async () => {
    askClaude.mockRejectedValueOnce(new Error('AI unavailable'))
    await expect(generateComparisonSummary(c, mapping)).rejects.toThrow('AI unavailable')
  })
})

describe('summaryWithoutFigures', () => {
  it('states directions only', () => {
    const c = comparison()
    const text = summaryWithoutFigures(c, confirmed(c, { revenue: ['Sales'], ato_debt: ['BAS Payable'] }))
    expect(text).toContain('Revenue rose between FY2024 and FY2025.')
    expect(text).toContain('fell between FY2024 and FY2025.')
    expect(text).not.toMatch(/\$|\d{3},\d{3}/)
  })
})
