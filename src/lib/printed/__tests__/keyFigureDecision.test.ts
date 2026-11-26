import { describe, it, expect } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import { autoMapping } from '../autoMapping'
import { decideKeyFigures, loanSide } from '../keyFigureDecision'
import { comparisonDocumentIds, reopenReason, type StoredDecision } from '../mappingStore'
import { LabelMasker } from '@/lib/ai/maskLabels'
import { keyFigurePrompt, maskedLines, parseKeyFigureAnswer, type AiKeyFigureAnswer, type KeyFigureChoice } from '@/lib/ai/keyFigureChoice'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'
import type { Meaning } from '../meanings'

/** The key-figure decision: Claude's choice with the rules on top (item 9b/9c). Synthetic statements only. */

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], amount: number | null): PrintedRow => ({ page: 1, path, label, style, amounts: [amount], text: label })
const st = (kind: PrintedStatement['kind'], rows: PrintedRow[]): PrintedStatement => ({ kind, title: kind, pages: [1], columns: [fy(2025)], rows, wholeDollars: false })

const CA = ['Assets', 'Current Assets']
const EQ = ['Equity']
const NAMES = { directors: ['Jane Example'], parties: ['Example Earthworks Pty Ltd'] }

function comparison() {
  const doc: ComparisonDocument = {
    documentId: 'doc-fy25',
    filename: 'fy25.pdf',
    uploadedAt: '',
    read: {
      status: 'read',
      pageCount: 2,
      issues: [],
      statements: [
        st('profit_and_loss', [r([], 'Sales', 'line', 1000), r([], 'Net Profit', 'total', 100)]),
        st('balance_sheet', [
          r([], 'Assets', 'heading', null),
          r(CA, 'Business Account', 'line', 900),
          r(CA, 'Loan - Jane Example', 'line', 5000),
          r(CA, 'Total Current Assets', 'subtotal', 5900),
          r(['Assets'], 'Total Assets', 'subtotal', 5900),
          r([], 'Equity', 'heading', null),
          r(EQ, 'Owner A Drawings', 'line', 44952.22),
          r(EQ, 'Matthew Nobody - Drawings', 'line', 1200),
          r(EQ, 'Retained Earnings', 'line', 100),
          r([], 'Net Assets', 'total', 5900),
        ]),
      ],
    },
  }
  return buildPrintedComparison([doc])
}

const key = (c: ReturnType<typeof comparison>, label: string) => c.tables.flatMap((t) => t.rows).find((x) => x.label === label)!.key
const OPEN: Meaning[] = ['loan_receivable', 'loan_payable', 'net_profit', 'total_current_assets', 'total_assets']
const choiceOf = (c: ReturnType<typeof comparison>, answer: AiKeyFigureAnswer): KeyFigureChoice => ({
  answer,
  unknownPersonLines: new Set([key(c, 'Matthew Nobody - Drawings')]),
  model: 'anthropic/test',
})
const decide = (answer: AiKeyFigureAnswer | null) => {
  const c = comparison()
  const rules = autoMapping(c, [], NAMES, { meanings: OPEN })
  return { c, rules, out: decideKeyFigures(c, OPEN, rules, NAMES, answer ? choiceOf(c, answer) : null) }
}
const of = (out: ReturnType<typeof decideKeyFigures>, m: Meaning) => out.find((d) => d.meaning === m)

describe('decideKeyFigures', () => {
  it('AI off: the rules alone, exactly as autoMapping decides', () => {
    const { rules, out } = decide(null)
    for (const d of out) {
      expect(d.chosenBy).toBe('rule')
      const ruleKeys = rules.entries.filter((e) => e.meaning === d.meaning).map((e) => `${e.rowKey}|${e.nonePrinted}`)
      expect(d.entries.map((e) => `${e.rowKey}|${e.nonePrinted}`)).toEqual(ruleKeys)
    }
  })

  it('AI and rules agree: the line, ⓘ "Chosen by AI: <reason>"', () => {
    const c = comparison()
    const { out } = decide({ net_profit: { kind: 'lines', rowKeys: [key(c, 'Net Profit')], reason: 'The net profit line the profit and loss prints.' } })
    const d = of(out, 'net_profit')!
    expect(d.outcome).toBe('lines')
    expect(d.chosenBy).toBe('ai')
    expect(d.entries[0].autoRule).toBe('Chosen by AI: The net profit line the profit and loss prints.')
  })

  it('AI unclear: nothing chosen, the lines wait for staff', () => {
    const c = comparison()
    const { out } = decide({ total_assets: { kind: 'unclear', rowKeys: [key(c, 'Total Assets')], reason: 'Not sure.' } })
    const d = of(out, 'total_assets')!
    expect(d.outcome).toBe('possible')
    expect(d.entries).toEqual([])
    expect(d.possible.map((p) => p.label)).toContain('Total Assets')
  })

  it('AI and rules disagree: possible lines, never auto-chosen', () => {
    const c = comparison()
    const { out } = decide({ net_profit: { kind: 'lines', rowKeys: [key(c, 'Sales')], reason: 'Wrong line.' } })
    const d = of(out, 'net_profit')!
    expect(d.outcome).toBe('possible')
    expect(d.possible.map((p) => p.label).sort()).toEqual(['Net Profit', 'Sales'])
  })

  it('a line naming a [person n] is only ever a possible line', () => {
    const c = comparison()
    const lines = [key(c, 'Loan - Jane Example'), key(c, 'Owner A Drawings'), key(c, 'Matthew Nobody - Drawings')]
    const { out } = decide({ related_loans: { kind: 'lines', rowKeys: lines, reason: 'The director and owner accounts.' } })
    for (const m of ['loan_receivable', 'loan_payable'] as const) {
      const d = of(out, m)
      expect(d?.entries.some((e) => e.label === 'Matthew Nobody - Drawings') ?? false).toBe(false)
    }
    expect(out.some((d) => d.possible.some((p) => p.label === 'Matthew Nobody - Drawings'))).toBe(true)
  })

  it('a line the rules reject never voids the lines agreed on: it is offered instead', () => {
    const c = comparison()
    const { rules, out } = decide({ net_profit: { kind: 'lines', rowKeys: [key(c, 'Net Profit'), key(c, 'Sales')], reason: 'Net profit.' } })
    expect(rules.entries.some((e) => e.meaning === 'net_profit')).toBe(true)
    const d = of(out, 'net_profit')!
    expect(d.outcome).toBe('lines')
    expect(d.entries.map((e) => e.label)).toEqual(['Net Profit'])
    expect(d.possible.map((p) => p.label)).toEqual(['Sales'])
    const loans = decide({ related_loans: { kind: 'lines', rowKeys: [key(c, 'Loan - Jane Example'), key(c, 'Retained Earnings')], reason: 'x' } }).out
    const debit = of(loans, 'loan_receivable')!
    expect(debit.outcome).toBe('lines')
    expect(debit.entries.map((e) => e.label)).toEqual(['Loan - Jane Example'])
    expect(loans.some((x) => x.possible.some((p) => p.label === 'Retained Earnings'))).toBe(true)
  })

  it('loans: the sign rule splits the AI\'s lines into Debit and Credit', () => {
    const c = comparison()
    expect(loanSide(c.tables[1].rows.find((x) => x.label === 'Loan - Jane Example')!, c)).toBe('loan_receivable')
    expect(loanSide(c.tables[1].rows.find((x) => x.label === 'Owner A Drawings')!, c)).toBe('loan_payable')
  })
})

describe('the prompt and the answer', () => {
  it('sends labels and headings only, names masked; restores names in the reason', () => {
    const c = comparison()
    const masker = new LabelMasker({ client: ['Example Earthworks Pty Ltd'], directors: ['Jane Example'], relatedCompanies: [], beneficiaries: [] })
    const lines = maskedLines(c, masker)
    const prompt = keyFigurePrompt(['related_loans', 'net_profit'], lines)
    expect(prompt).not.toContain('Jane Example')
    expect(prompt).not.toContain('Matthew Nobody')
    expect(prompt).not.toMatch(/44,?952/)
    expect(prompt).not.toContain('fy25.pdf')
    expect(prompt).toContain('Loan - [director 1]')
    const loan = lines.find((l) => l.text.endsWith('Loan - [director 1]'))!
    const np = lines.find((l) => l.text.includes('Net Profit'))!
    const parsed = parseKeyFigureAnswer(
      JSON.stringify({ related_loans: { lines: [loan.id], reason: '[director 1] owes the company.' }, net_profit: { lines: [np.id, loan.id], reason: 'x' } }),
      ['related_loans', 'net_profit'],
      lines,
      masker,
    )
    expect(parsed.related_loans).toEqual({ kind: 'lines', rowKeys: [loan.row.key], reason: 'Jane Example owes the company.' })
    // A balance sheet line for a profit and loss figure: not offered there, so unclear.
    expect(parsed.net_profit?.kind).toBe('unclear')
  })
})

describe('stored decisions (9c)', () => {
  const stored = (over: Partial<StoredDecision> = {}): StoredDecision => ({
    meaning: 'net_profit',
    outcome: 'lines',
    chosenBy: 'ai',
    decidedBy: 'auto',
    decidedAt: '2026-11-26T00:00:00Z',
    rule: 'Chosen by AI: x',
    aiReason: 'x',
    rowKeys: ['k1'],
    possible: [],
    documentIds: ['doc-fy25'],
    ...over,
  })
  it('stand until the documents change, a chosen line is gone, or staff clear their choice', () => {
    const rows = new Set(['k1'])
    expect(reopenReason(stored(), ['doc-fy25'], rows)).toBeNull()
    expect(reopenReason(undefined, ['doc-fy25'], rows)).toBe('not decided yet')
    expect(reopenReason(stored(), ['doc-fy25', 'doc-fy26'], rows)).toBe('the documents changed')
    expect(reopenReason(stored(), ['doc-fy25'], new Set())).toBe('a chosen line is no longer printed')
    expect(reopenReason(stored({ chosenBy: 'staff' }), ['doc-fy25'], rows)).toBe('staff cleared their choice')
  })
  it('the documents are the ones the figures come from', () => {
    expect(comparisonDocumentIds(comparison())).toEqual(['doc-fy25'])
  })
})
