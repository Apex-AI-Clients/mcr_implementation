import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '@/lib/printed/compare'
import { suggestMapping } from '@/lib/printed/dictionary'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '@/lib/printed/types'

/**
 * Claude's label suggestions for the key figures the dictionary found no
 * line for. The AI is mocked. Synthetic statements: an unusual loan label
 * the dictionary does not know.
 */

const askClaude = vi.fn()
vi.mock('../openrouterClient', () => ({ askClaude: (...args: unknown[]) => askClaude(...args) }))
const { labelSuggestionPrompt, offeredLines, parseLabelSuggestions, suggestUnknownLabels, unknownMeanings } = await import('../labelSuggestions')

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })
const st = (kind: PrintedStatement['kind'], rows: PrintedRow[]): PrintedStatement => ({ kind, title: kind, pages: [1], columns: [fy(2025), fy(2024)], rows, wholeDollars: true })

function comparison() {
  const doc: ComparisonDocument = {
    documentId: 'fy25',
    filename: 'fy25.pdf',
    uploadedAt: '',
    read: {
      status: 'read',
      pageCount: 2,
      issues: [],
      statements: [
        st('profit_and_loss', [r([], 'Sales', 'line', 500, 400), r([], 'Net Profit', 'total', 200, 50)]),
        st('balance_sheet', [
          r([], 'Assets', 'heading', null, null),
          r(['Assets'], 'Cash', 'line', 123_456, 80),
          r(['Assets'], 'Amount due from K & J Smith', 'line', 40, 30),
          r(['Assets'], 'Total Assets', 'subtotal', 123_496, 110),
        ]),
      ],
    },
  }
  return buildPrintedComparison([doc], { comparativeYears: true })
}

const c = comparison()
const suggestions = suggestMapping(c)
const rowKey = (label: string) => c.tables.flatMap((t) => t.rows).find((x) => x.label === label)!.key

beforeEach(() => askClaude.mockReset())

describe('what is asked', () => {
  it('only about meanings the dictionary found nothing for and staff have not confirmed', () => {
    const unknown = unknownMeanings([], suggestions)
    expect(suggestions.revenue.length).toBeGreaterThan(0)
    expect(unknown).not.toContain('revenue')
    expect(unknown).toContain('loan_receivable')
    const confirmed: MappingEntry = { meaning: 'loan_receivable', rowKey: '', label: null, nonePrinted: true, confirmedBy: 'Test Staff', confirmedAt: '2026-10-25T00:00:00Z' }
    expect(unknownMeanings([confirmed], suggestions)).not.toContain('loan_receivable')
  })

  it('sends labels and headings only: no figure', () => {
    const meanings = unknownMeanings([], suggestions)
    const prompt = labelSuggestionPrompt(meanings, offeredLines(c, meanings, [], suggestions))
    expect(prompt).toContain('Balance sheet › Assets › Amount due from K & J Smith')
    expect(prompt).not.toContain('123,456')
    expect(prompt).not.toContain('123456')
    expect(prompt).not.toMatch(/\{[a-z]+\}/)
  })
})

describe('the answer, checked', () => {
  const meanings = unknownMeanings([], suggestions)
  const lines = offeredLines(c, meanings, [], suggestions)
  const idOf = (label: string) => lines.find((l) => l.row.label === label)!.id

  it('takes offered lines in the right statement', () => {
    const answer = JSON.stringify({ loan_receivable: [idOf('Amount due from K & J Smith')] })
    expect(parseLabelSuggestions(answer, meanings, lines)).toEqual({ loan_receivable: [rowKey('Amount due from K & J Smith')] })
  })

  it('drops ids never offered, several lines for a one-line meaning, and non-JSON', () => {
    expect(parseLabelSuggestions(JSON.stringify({ loan_receivable: [999] }), meanings, lines)).toEqual({})
    const two = [idOf('Cash'), idOf('Amount due from K & J Smith')]
    expect(parseLabelSuggestions(JSON.stringify({ net_assets: two }), meanings, lines)).toEqual({})
    expect(parseLabelSuggestions('I think it is the loan.', meanings, lines)).toEqual({})
  })
})

describe('suggestUnknownLabels', () => {
  it('asks the label model, and returns only checked suggestions', async () => {
    const meanings = unknownMeanings([], suggestions)
    const id = offeredLines(c, meanings, [], suggestions).find((l) => l.row.label === 'Amount due from K & J Smith')!.id
    askClaude.mockResolvedValueOnce({ text: `{"loan_receivable": [${id}], "ato_debt": []}`, model: 'anthropic/claude-haiku-5.5', generationId: 'g' })
    expect(await suggestUnknownLabels(c, [], suggestions)).toEqual({ loan_receivable: [rowKey('Amount due from K & J Smith')] })
    expect(askClaude.mock.calls[0][0]).toMatchObject({ purpose: 'labels' })
  })

  it('asks nothing when every meaning is suggested or confirmed', async () => {
    const all = Object.fromEntries(Object.keys(suggestions).map((k) => [k, ['x']])) as typeof suggestions
    expect(await suggestUnknownLabels(c, [], all)).toEqual({})
    expect(askClaude).not.toHaveBeenCalled()
  })
})
